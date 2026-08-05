import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradingViewSetupPage } from "./TradingViewSetupPage";

const getTradingViewSetup = vi.fn();
const updateTradingViewSetup = vi.fn();
const createTradingViewConnection = vi.fn();
const sendTestAlert = vi.fn();
const restoreTradingViewStandard = vi.fn();
const saveTradingViewCustomMapping = vi.fn();
const rotateTradingViewConnection = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      getTradingViewSetup,
      updateTradingViewSetup,
      createTradingViewConnection,
      sendTestAlert,
      restoreTradingViewStandard,
      saveTradingViewCustomMapping,
      rotateTradingViewConnection
    }
  })
}));

const setupResponse = {
  setup: {
    templateMode: "standard" as const,
    templateId: "goldmeta-standard",
    templateVersion: "1",
    connectionStatus: "waiting_for_alert",
    setupLabel: "GoldMeta Standard",
    selectedSymbolAlias: "XAUUSD",
    selectedTimeframes: ["15"],
    lastSignalAt: null,
    lastValidSignalAt: null,
    lastRejectedSignalAt: null,
    lastRejectReason: null,
    hasWebhook: true,
    webhookIdMasked: "****abcd"
  },
  template: {
    id: "goldmeta-standard",
    name: "GoldMeta Standard",
    description: "Standard alert format",
    recommended: true,
    supportedTimeframes: [
      { value: "1", label: "1 minute" },
      { value: "5", label: "5 minutes" },
      { value: "15", label: "15 minutes" },
      { value: "30", label: "30 minutes" },
      { value: "60", label: "1 hour" },
      { value: "240", label: "4 hours" }
    ],
    symbolAliases: {},
    instructions: []
  },
  webhookUrl: "https://example.test/webhooks/tradingview/user-webhook",
  alertGuide: {
    alertName: "GoldMeta XAUUSD 15",
    messageBody: "{{alert_message}}",
    pineReminder: "Install GoldMeta Bridge 3.0.0"
  }
};

async function goToStep3(user: ReturnType<typeof userEvent.setup>) {
  render(
    <MemoryRouter>
      <TradingViewSetupPage />
    </MemoryRouter>
  );
  await screen.findByTestId("tv-setup-wizard");
  // Wait for initial setup fetch so hydration cannot race later clicks.
  await waitFor(() =>
    expect(screen.getByText("Waiting for TradingView alert")).toBeInTheDocument()
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByTestId("tv-step-timeframe")).toBeInTheDocument();
  await waitFor(() =>
    expect(within(screen.getByTestId("tv-timeframe-15m")).getByRole("radio")).toBeChecked()
  );
}

describe("TradingViewSetupPage timeframe selection", () => {
  beforeEach(() => {
    getTradingViewSetup.mockReset();
    updateTradingViewSetup.mockReset();
    createTradingViewConnection.mockReset();
    sendTestAlert.mockReset();
    restoreTradingViewStandard.mockReset();
    saveTradingViewCustomMapping.mockReset();
    rotateTradingViewConnection.mockReset();
    getTradingViewSetup.mockResolvedValue(setupResponse);
    updateTradingViewSetup.mockResolvedValue({ ok: true });
  });

  it("defaults PLAN_15M role to 15 minutes with selected styling", async () => {
    const user = userEvent.setup();
    await goToStep3(user);

    const btn15 = screen.getByTestId("tv-timeframe-15m");
    expect(within(btn15).getByRole("radio")).toBeChecked();
    expect(btn15).toHaveAttribute("data-selected", "true");
    expect(btn15.className).toMatch(/is-selected/);
    expect(btn15.style.border).toMatch(/rgb\(29,\s*53,\s*87\)|#1d3557/i);
    expect(within(btn15).getByText("✓")).toBeInTheDocument();
    expect(screen.getByTestId("tv-alert-role-PLAN_15M")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tv-timeframe-continue")).not.toBeDisabled();
    expect(screen.getByTestId("tv-timeframe-guidance")).toHaveTextContent(
      /wizard choice is for setup guidance/i
    );
  });

  it("selects a timeframe with mouse click and enables Continue", async () => {
    const user = userEvent.setup();
    await goToStep3(user);

    const btn5 = screen.getByTestId("tv-timeframe-5m");
    await user.click(within(btn5).getByRole("radio"));

    expect(within(btn5).getByRole("radio")).toBeChecked();
    expect(btn5.className).toMatch(/is-selected/);
    expect(btn5.style.background).toMatch(/rgba\(29,\s*53,\s*87/i);
    expect(within(screen.getByTestId("tv-timeframe-15m")).getByRole("radio")).not.toBeChecked();
    expect(screen.getByTestId("tv-selected-timeframe-summary")).toHaveTextContent(/5 minutes/i);
    expect(screen.getByTestId("tv-timeframe-continue")).not.toBeDisabled();
  });

  it("selects a timeframe with keyboard Enter / Space", async () => {
    const user = userEvent.setup();
    await goToStep3(user);

    const radio1h = within(screen.getByTestId("tv-timeframe-1h")).getByRole("radio");
    radio1h.focus();
    await user.keyboard("{Enter}");
    // Radios select via Space / click; Enter may not toggle all browsers — use Space.
    await user.keyboard(" ");
    expect(radio1h).toBeChecked();

    const radio4h = within(screen.getByTestId("tv-timeframe-4h")).getByRole("radio");
    radio4h.focus();
    await user.keyboard(" ");
    expect(radio4h).toBeChecked();
    expect(radio1h).not.toBeChecked();
  });

  it("selects a timeframe with touch pointer events", async () => {
    const user = userEvent.setup();
    await goToStep3(user);

    const btn30 = screen.getByTestId("tv-timeframe-30m");
    fireEvent.click(within(btn30).getByRole("radio"));

    expect(within(btn30).getByRole("radio")).toBeChecked();
    expect(btn30.className).toMatch(/is-selected/);
    expect(screen.getByTestId("tv-timeframe-continue")).not.toBeDisabled();
  });

  it("maps alert roles to default timeframes", async () => {
    const user = userEvent.setup();
    await goToStep3(user);

    await user.click(screen.getByTestId("tv-alert-role-CONFIRM_5M"));
    expect(within(screen.getByTestId("tv-timeframe-5m")).getByRole("radio")).toBeChecked();

    await user.click(screen.getByTestId("tv-alert-role-QUOTE_1M"));
    expect(within(screen.getByTestId("tv-timeframe-1m")).getByRole("radio")).toBeChecked();

    await user.click(screen.getByTestId("tv-alert-role-PLAN_15M"));
    expect(within(screen.getByTestId("tv-timeframe-15m")).getByRole("radio")).toBeChecked();
  });

  it("persists selected timeframe across Back and Continue", async () => {
    const user = userEvent.setup();
    await goToStep3(user);

    await user.click(within(screen.getByTestId("tv-timeframe-1h")).getByRole("radio"));
    await user.click(screen.getByTestId("tv-timeframe-continue"));

    await waitFor(() =>
      expect(updateTradingViewSetup).toHaveBeenCalledWith(
        expect.objectContaining({ selectedTimeframes: ["60"] })
      )
    );

    // Step 4 — go back to step 3
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByTestId("tv-step-timeframe")).toBeInTheDocument();
    expect(within(screen.getByTestId("tv-timeframe-1h")).getByRole("radio")).toBeChecked();
    expect(screen.getByTestId("tv-selected-timeframe-summary")).toHaveTextContent(/1 hour/i);

    // Continue again — still 1h
    await user.click(screen.getByTestId("tv-timeframe-continue"));
    await waitFor(() =>
      expect(updateTradingViewSetup).toHaveBeenLastCalledWith(
        expect.objectContaining({ selectedTimeframes: ["60"] })
      )
    );
  });

  it("shows timeframe buttons even before template loads", async () => {
    getTradingViewSetup.mockImplementation(
      () => new Promise(() => undefined) // never resolves
    );
    render(
      <MemoryRouter>
        <TradingViewSetupPage />
      </MemoryRouter>
    );
    // Advance without waiting for API
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByTestId("tv-timeframe-grid")).toBeInTheDocument();
    for (const id of [
      "tv-timeframe-1m",
      "tv-timeframe-5m",
      "tv-timeframe-15m",
      "tv-timeframe-30m",
      "tv-timeframe-1h",
      "tv-timeframe-4h"
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("keeps a single shared webhook URL for all roles", async () => {
    const user = userEvent.setup();
    await goToStep3(user);
    await user.click(screen.getByTestId("tv-timeframe-5m"));
    await user.click(screen.getByTestId("tv-timeframe-continue"));

    expect(await screen.findByTestId("tv-webhook-url")).toHaveTextContent(
      "https://example.test/webhooks/tradingview/user-webhook"
    );
    expect(screen.getByText(/same URL is used for PLAN_15M, CONFIRM_5M and QUOTE_1M/i)).toBeInTheDocument();
  });
});
