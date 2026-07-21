import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";
import { ApiError } from "../types/models";

const createTradingViewConnection = vi.fn();
const listTradingViewConnections = vi.fn();
const getSettings = vi.fn();
const sendTestAlert = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      createTradingViewConnection,
      listTradingViewConnections,
      getSettings,
      sendTestAlert,
      updateSettings: vi.fn(),
      getVapidPublicKey: vi.fn(),
      registerWebPushSubscription: vi.fn(),
      deleteWebPushSubscription: vi.fn()
    },
    signOut: vi.fn(),
    apiBaseUrl: "https://us-central1-goldmeta-web.cloudfunctions.net/api",
    user: { email: "tester@example.com" }
  })
}));

vi.mock("../lib/push", () => ({
  getNotificationPermission: () => "default",
  isProbablyInstalledPwa: () => false,
  isWebPushSupported: () => false,
  subscribeWebPush: vi.fn(),
  unsubscribeWebPush: vi.fn()
}));

describe("SettingsPage TradingView create connection", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    getSettings.mockResolvedValue({
      notificationsEnabled: false,
      aiEnabled: false,
      provisionalSignalsEnabled: false,
      riskProfile: "BALANCED"
    });
    listTradingViewConnections.mockResolvedValue([]);
    createTradingViewConnection.mockReset();
    sendTestAlert.mockReset();
  });

  it("shows the created webhook URL after a successful create", async () => {
    const connection = {
      id: "wh_1",
      status: "ACTIVE",
      webhookURL:
        "https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/wh_1"
    };
    createTradingViewConnection.mockResolvedValue({
      connection,
      webhookUrl: connection.webhookURL,
      secret: "once-secret"
    });
    listTradingViewConnections.mockImplementation(async () =>
      createTradingViewConnection.mock.calls.length > 0 ? [connection] : []
    );

    const user = userEvent.setup();
    render(<SettingsPage />);
    expect(await screen.findByText("No connections yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create connection" }));

    expect(await screen.findByText(/TradingView connection created/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        "https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/wh_1"
      )
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/ACTIVE/)).toBeInTheDocument();
    });
  });

  it("shows a friendly message instead of raw Load failed on network/CORS errors", async () => {
    createTradingViewConnection.mockRejectedValue(new TypeError("Load failed"));

    const user = userEvent.setup();
    render(<SettingsPage />);
    await screen.findByText("No connections yet.");
    await user.click(screen.getByRole("button", { name: "Create connection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Could not reach the GoldMeta API from this browser/i
    );
    expect(screen.queryByText(/^Load failed$/)).not.toBeInTheDocument();
  });

  it("surfaces API error codes for create failures", async () => {
    createTradingViewConnection.mockRejectedValue(
      new ApiError(503, "AUTH_UNAVAILABLE", "Auth service unavailable")
    );

    const user = userEvent.setup();
    render(<SettingsPage />);
    await screen.findByText("No connections yet.");
    await user.click(screen.getByRole("button", { name: "Create connection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AUTH_UNAVAILABLE: Auth service unavailable"
    );
  });
});
