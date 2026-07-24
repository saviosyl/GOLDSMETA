import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";
import { ApiError } from "../types/models";
import "../styles/global.css";

const createTradingViewConnection = vi.fn();
const listTradingViewConnections = vi.fn();
const revokeTradingViewConnection = vi.fn();
const getSettings = vi.fn();
const sendTestAlert = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      createTradingViewConnection,
      listTradingViewConnections,
      revokeTradingViewConnection,
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

const longWebhook =
  "https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/2HBnvhqE6XQPJF4roWCQUx6E";

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
    revokeTradingViewConnection.mockReset();
    sendTestAlert.mockReset();
  });

  it("hides the backend API URL and shows account email", async () => {
    render(<SettingsPage />);
    expect(await screen.findByTestId("account-email")).toHaveTextContent("tester@example.com");
    expect(screen.queryByText(/cloudfunctions\.net\/api/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("connection-status")).toHaveTextContent(/Connected|Offline/);
  });

  it("shows the created webhook URL after a successful create without exposing a secret", async () => {
    const connection = {
      id: "wh_1",
      status: "ACTIVE",
      webhookURL: longWebhook.replace("2HBnvhqE6XQPJF4roWCQUx6E", "wh_1")
    };
    createTradingViewConnection.mockResolvedValue({
      connection,
      webhookUrl: connection.webhookURL,
      secret: "once-secret-must-not-render"
    });
    listTradingViewConnections.mockImplementation(async () =>
      createTradingViewConnection.mock.calls.length > 0 ? [connection] : []
    );

    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(await screen.findByRole("tab", { name: "TradingView" }));
    expect(await screen.findByText("No connections yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create connection" }));

    expect(await screen.findByText(/TradingView connection created/i)).toBeInTheDocument();
    expect(screen.getByTestId("created-webhook-url")).toHaveTextContent(connection.webhookURL);
    expect(screen.queryByText("once-secret-must-not-render")).not.toBeInTheDocument();
    expect(screen.queryByText(/Secret \(shown once\)/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    });
  });

  it("shows a friendly message instead of raw Load failed on network/CORS errors", async () => {
    createTradingViewConnection.mockRejectedValue(new TypeError("Load failed"));

    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(await screen.findByRole("tab", { name: "TradingView" }));
    await screen.findByText("No connections yet.");
    await user.click(screen.getByRole("button", { name: "Create connection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Could not reach GoldMeta/i
    );
    expect(screen.queryByText(/^Load failed$/)).not.toBeInTheDocument();
  });

  it("shows friendly API errors for create failures without raw codes", async () => {
    createTradingViewConnection.mockRejectedValue(
      new ApiError(503, "AUTH_UNAVAILABLE", "Auth service unavailable")
    );

    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(await screen.findByRole("tab", { name: "TradingView" }));
    await screen.findByText("No connections yet.");
    await user.click(screen.getByRole("button", { name: "Create connection" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Auth service unavailable|Something went wrong/i);
    expect(alert).not.toHaveTextContent(/^AUTH_UNAVAILABLE:/);
  });
});

describe("SettingsPage TradingView revoke and copy", () => {
  const active = {
    id: "wh_active",
    webhookId: "wh_active",
    status: "ACTIVE",
    webhookURL: longWebhook
  };
  const revoked = {
    id: "wh_old",
    webhookId: "wh_old",
    status: "REVOKED",
    webhookURL:
      "https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/wh_old"
  };

  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    getSettings.mockResolvedValue({
      notificationsEnabled: false,
      aiEnabled: false,
      provisionalSignalsEnabled: false,
      riskProfile: "BALANCED"
    });
    listTradingViewConnections.mockResolvedValue([active, revoked]);
    createTradingViewConnection.mockReset();
    revokeTradingViewConnection.mockReset();
    sendTestAlert.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openTradingView(user: ReturnType<typeof userEvent.setup>) {
    render(<SettingsPage />);
    await user.click(await screen.findByRole("tab", { name: "TradingView" }));
  }

  it("requires confirmation before revoking and refreshes the list", async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirm);
    revokeTradingViewConnection.mockResolvedValue({
      connection: { ...active, status: "REVOKED" }
    });
    listTradingViewConnections.mockImplementation(async () => {
      if (revokeTradingViewConnection.mock.calls.length > 0) {
        return [{ ...active, status: "REVOKED" }, revoked];
      }
      return [active, revoked];
    });

    const user = userEvent.setup();
    await openTradingView(user);

    expect(await screen.findByTestId("connection-status-wh_active")).toHaveTextContent("ACTIVE");
    expect(screen.getByTestId("connection-status-wh_old")).toHaveTextContent("REVOKED");
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Revoke" }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(revokeTradingViewConnection).toHaveBeenCalledWith("wh_active");
    });
    expect(await screen.findByText(/TradingView connection revoked/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("REVOKED").length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("does not revoke when confirmation is cancelled", async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);

    const user = userEvent.setup();
    await openTradingView(user);
    await screen.findByRole("button", { name: "Revoke" });
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    expect(confirm).toHaveBeenCalled();
    expect(revokeTradingViewConnection).not.toHaveBeenCalled();
  });

  it("hides webhook URLs until revealed and still offers Copy webhook", async () => {
    const user = userEvent.setup();
    await openTradingView(user);
    const url = await screen.findByTestId("connection-url-wh_active");
    expect(url).toHaveClass("url-break");
    expect(url).toHaveTextContent(/hidden/i);
    expect(url).not.toHaveTextContent(longWebhook);
    expect(screen.getAllByRole("button", { name: "Copy webhook" }).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "Reveal webhook" })[0]!);
    expect(screen.getByTestId("connection-url-wh_active")).toHaveTextContent(longWebhook);
  });
});

describe("SettingsPage notifications UX", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    getSettings.mockResolvedValue({
      notificationsEnabled: false,
      aiEnabled: false,
      provisionalSignalsEnabled: false,
      riskProfile: "BALANCED"
    });
    listTradingViewConnections.mockResolvedValue([]);
  });

  it("disables Enable Web Push when unsupported and explains why", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(await screen.findByRole("tab", { name: "Notifications" }));
    expect(await screen.findByTestId("notif-headline")).toHaveTextContent(/Unavailable/i);
    expect(screen.getByRole("button", { name: "Enable Web Push" })).toBeDisabled();
    expect(screen.getByTestId("notif-enable-hint")).toHaveTextContent(/unavailable/i);
  });
});
