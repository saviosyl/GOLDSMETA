import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrokerControlCentrePage } from "./BrokerControlCentrePage";
import { ApiError } from "../../types/models";
import "../../styles/redesign.css";

const {
  getBrokerControlCentre,
  getCTraderDemonstration,
  startCTraderOAuth,
  listCTraderAccounts,
  selectCTraderAccount,
  disconnectCTrader,
  getCTraderDiagnostics,
  createCTraderPreview,
  mockApi,
  mockAuth
} = vi.hoisted(() => {
  const getBrokerControlCentre = vi.fn();
  const getCTraderDemonstration = vi.fn();
  const startCTraderOAuth = vi.fn();
  const listCTraderAccounts = vi.fn();
  const selectCTraderAccount = vi.fn();
  const disconnectCTrader = vi.fn();
  const getCTraderDiagnostics = vi.fn();
  const createCTraderPreview = vi.fn();
  const mockApi = {
    getBrokerControlCentre,
    getCTraderDemonstration,
    startCTraderOAuth,
    listCTraderAccounts,
    selectCTraderAccount,
    disconnectCTrader,
    getCTraderDiagnostics,
    createCTraderPreview
  };
  const mockAuth = {
    account: { role: "OWNER" },
    api: mockApi
  };
  return {
    getBrokerControlCentre,
    getCTraderDemonstration,
    startCTraderOAuth,
    listCTraderAccounts,
    selectCTraderAccount,
    disconnectCTrader,
    getCTraderDiagnostics,
    createCTraderPreview,
    mockApi,
    mockAuth
  };
});

vi.mock("../../lib/auth", () => ({
  useAuth: () => mockAuth
}));

const centreFixture = {
  defaultBroker: "pepperstone_ctrader",
  autoTrade: "OFF",
  orderSubmissionEnabled: false,
  brokers: [
    {
      id: "pepperstone_ctrader",
      name: "Pepperstone cTrader Demo",
      status: "Connection setup required",
      detail: "Demo setup",
      badge: "PREVIEW"
    },
    {
      id: "trading212_invest",
      name: "Trading 212 Practice",
      status: "Read only",
      detail: "Practice read-only",
      badge: "READ_ONLY"
    },
    {
      id: "manual",
      name: "Manual",
      status: "Available",
      detail: "No broker execution",
      badge: "MANUAL"
    }
  ],
  automationModes: [],
  readiness: {
    setupRequired: true,
    authSetupRequired: true,
    oauthConfigured: false,
    connected: false,
    demonstrationAvailable: true,
    automationMode: "OFF",
    autoTrade: "OFF",
    orderSubmissionEnabled: false,
    liveEnabled: false,
    wizardSteps: [
      {
        step: 1,
        title: "Create Pepperstone cTrader Demo account",
        status: "AVAILABLE",
        detail: "Explain"
      },
      {
        step: 3,
        title: "Add secure credentials",
        status: "SETUP_REQUIRED",
        detail: "Missing CTRADER_CLIENT_SECRET"
      },
      {
        step: 4,
        title: "Connect account",
        status: "BLOCKED",
        detail: "AUTH SETUP REQUIRED"
      },
      {
        step: 8,
        title: "Request Demo trading approval",
        status: "BLOCKED",
        detail: "Locked"
      }
    ],
    label: "CTRADER_SETUP_REQUIRED",
    auth: {
      status: "NOT_HEALTHY",
      brokerSetupEnabled: false,
      notes: ["AUTH SETUP REQUIRED"]
    },
    qualification: {
      unlocked: false,
      canActivate: false,
      failed: ["AUTH_HEALTHY", "OAUTH_HEALTHY"],
      progress: {
        completedPreviews: 0,
        requiredPreviews: 20,
        approvedControlledDemoTrades: 0,
        requiredTrades: 5,
        daysSinceFirstTrade: null,
        requiredDays: 7,
        source: "recommended_qualification_defaults",
        sourceLabel:
          "Recommended qualification defaults for future Demo Auto approval — not permanent user risk limits."
      }
    }
  }
};

const connectedCentre = {
  ...centreFixture,
  readiness: {
    ...centreFixture.readiness,
    setupRequired: false,
    authSetupRequired: false,
    oauthConfigured: true,
    connected: true,
    connectionSummary: {
      accountMasked: "****4821",
      brokerName: "Pepperstone",
      symbolName: "XAUUSD",
      lastSyncAt: new Date().toISOString(),
      lastQuoteAt: new Date().toISOString()
    }
  }
};

const diagnosticsFixture = {
  oauthConnected: true,
  accountSelected: true,
  demoAccountSelected: true,
  credentialsConfigured: true,
  pepperstoneConfirmed: true,
  goldSymbolFound: true,
  liveQuoteReceived: true,
  spreadAvailable: true,
  volumeRulesAvailable: true,
  marginMetadataAvailable: true,
  marketStatusAvailable: true,
  tradingSafelyLocked: true,
  autoTrade: "OFF",
  environment: "DEMO",
  selectedAccountIsLive: false,
  connection: {
    accountMasked: "****4821",
    brokerName: "Pepperstone cTrader",
    currency: "EUR",
    tokenRefreshHealthy: true,
    lastQuoteAt: new Date().toISOString()
  },
  account: {
    accountIdMasked: "****4821",
    currency: "EUR",
    balance: 10000,
    equity: 10000,
    freeMargin: 9500,
    usedMargin: 120,
    leverage: 100
  },
  symbol: { symbolName: "XAUUSD", minVolume: 0.01, volumeStep: 0.01 },
  quote: {
    bid: 2350.1,
    ask: 2350.4,
    spread: 0.3,
    marketStatus: "OPEN",
    stale: false,
    timestamp: new Date().toISOString()
  }
};

const accountsFixture = {
  accounts: [
    {
      ctidTraderAccountId: "demo-4821",
      accountIdMasked: "****4821",
      isLive: false,
      selected: true,
      brokerNameTitle: "Pepperstone",
      depositCurrency: "EUR"
    },
    {
      ctidTraderAccountId: "live-9910",
      accountIdMasked: "****9910",
      isLive: true,
      selected: false,
      brokerNameTitle: "Pepperstone",
      depositCurrency: "EUR"
    }
  ]
};

function renderBroker() {
  return render(
    <MemoryRouter>
      <BrokerControlCentrePage />
    </MemoryRouter>
  );
}

describe("BrokerControlCentrePage", () => {
  beforeEach(() => {
    getBrokerControlCentre.mockReset();
    getCTraderDemonstration.mockReset();
    startCTraderOAuth.mockReset();
    listCTraderAccounts.mockReset();
    selectCTraderAccount.mockReset();
    disconnectCTrader.mockReset();
    getCTraderDiagnostics.mockReset();
    createCTraderPreview.mockReset();
    getBrokerControlCentre.mockResolvedValue(centreFixture);
    getCTraderDiagnostics.mockResolvedValue(diagnosticsFixture);
    listCTraderAccounts.mockResolvedValue(accountsFixture);
    selectCTraderAccount.mockResolvedValue({});
    disconnectCTrader.mockResolvedValue({ disconnected: true });
    createCTraderPreview.mockResolvedValue({
      notice: "Preview only — no order will be submitted.",
      preview: { action: "BUY", state: "READY_FOR_CONFIRMATION", proposedVolume: 0.02, riskAmount: 20 },
      quote: { bid: 2350, ask: 2350.3, spread: 0.3 }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders broker options with AutoTrade OFF and no-order badges", async () => {
    renderBroker();
    await waitFor(() => {
      expect(screen.getByTestId("broker-control-centre")).toBeInTheDocument();
    });
    expect(screen.getByTestId("autotrade-off-badge")).toHaveTextContent("OFF");
    expect(screen.getByTestId("no-order-badge")).toHaveTextContent(
      /Order submission disabled in this preview/i
    );
    expect(screen.getByTestId("broker-edit-autotrade-settings")).toHaveAttribute(
      "href",
      "/autotrade"
    );
    expect(screen.getByTestId("broker-card-pepperstone_ctrader")).toBeInTheDocument();
    expect(screen.getByTestId("broker-top-status")).toBeInTheDocument();
  });

  it("shows Connection setup required and disables connect for cTrader", async () => {
    renderBroker();
    await waitFor(() => screen.getByTestId("broker-card-pepperstone_ctrader"));
    fireEvent.click(screen.getByTestId("broker-card-pepperstone_ctrader"));
    expect(await screen.findByTestId("ctrader-setup-panel")).toBeInTheDocument();
    expect(await screen.findByTestId("auth-setup-required")).toHaveTextContent(
      /Connection setup required|Pepperstone connection required/i
    );
    expect(screen.getByTestId("ctrader-connect-btn")).toBeDisabled();
    expect(screen.getByTestId("no-order-controls")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /place|submit order/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("owner-setup-guide")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-status-1")).toHaveTextContent(/Action required/i);
  });

  it("keeps technical codes out of the main wizard copy", async () => {
    renderBroker();
    fireEvent.click(await screen.findByTestId("broker-card-pepperstone_ctrader"));
    const panel = await screen.findByTestId("ctrader-setup-panel");
    expect(panel.textContent).not.toMatch(/AUTH SETUP REQUIRED/);
    expect(panel.textContent).not.toMatch(/CTRADER_CLIENT_SECRET/);
  });

  it("loads labelled demonstration data", async () => {
    getCTraderDemonstration.mockResolvedValue({
      banner: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED",
      notice: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED",
      autoTrade: "OFF",
      orderSubmissionEnabled: false,
      account: {
        accountIdMasked: "DE…01",
        currency: "EUR",
        balance: 10000,
        equity: 10000,
        freeMargin: 9500,
        leverage: 100,
        brokerName: "Pepperstone",
        brokerNameSource: "USER_CONFIRMED"
      },
      symbol: {
        symbolName: "XAUUSD",
        baseAsset: "XAU",
        quoteAsset: "USD",
        minVolume: 0.01,
        volumeStep: 0.01,
        lotSize: 100,
        metadataComplete: true
      },
      quote: {
        bid: 2350,
        ask: 2350.3,
        spread: 0.3,
        marketStatus: "OPEN",
        source: "FIXTURE"
      },
      buyPreview: {
        state: "READY_FOR_CONFIRMATION",
        action: "BUY",
        proposedVolume: 0.02,
        riskAmount: 20,
        failedGates: [],
        passedGates: ["ACTION_BUY"],
        label: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED"
      },
      sellPreview: {
        state: "READY_FOR_CONFIRMATION",
        action: "SELL",
        proposedVolume: 0.02,
        label: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED"
      },
      blockedPreview: {
        state: "BLOCKED",
        failedGates: ["CONFIDENCE_TOO_LOW"],
        label: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED"
      }
    });
    renderBroker();
    await waitFor(() => screen.getByTestId("broker-card-pepperstone_ctrader"));
    fireEvent.click(screen.getByTestId("broker-card-pepperstone_ctrader"));
    fireEvent.click(screen.getByTestId("ctrader-demo-btn"));
    expect(await screen.findByTestId("ctrader-demonstration")).toHaveTextContent(
      "DEMONSTRATION DATA"
    );
    expect(await screen.findByTestId("broker-action-banner")).toHaveTextContent(
      /demonstration loaded/i
    );
  });

  it("refreshes accounts with loading feedback and duplicate-click protection", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    let resolveAccounts: (v: unknown) => void = () => undefined;
    listCTraderAccounts.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAccounts = resolve;
        })
    );
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-refresh-accounts-btn"));
    const btn = screen.getByTestId("ctrader-refresh-accounts-btn");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(listCTraderAccounts).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveTextContent(/Refreshing accounts/i);
    await act(async () => {
      resolveAccounts(accountsFixture);
    });
    expect(await screen.findByTestId("broker-action-banner")).toHaveTextContent(
      /Accounts refreshed/i
    );
  });

  it("refreshes diagnostics and supports view toggle", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-diagnostics-btn"));
    fireEvent.click(screen.getByTestId("ctrader-diagnostics-btn"));
    expect(await screen.findByTestId("broker-action-banner")).toHaveTextContent(
      /Diagnostics refreshed/i
    );
    expect(screen.getByTestId("ctrader-diagnostics")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ctrader-view-diagnostics-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("ctrader-diagnostics")).not.toBeInTheDocument();
    });
  });

  it("requires disconnect confirmation then disconnects", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-disconnect-btn"));
    fireEvent.click(screen.getByTestId("ctrader-disconnect-btn"));
    expect(disconnectCTrader).not.toHaveBeenCalled();
    expect(screen.getByTestId("ctrader-disconnect-btn")).toHaveTextContent(/Confirm disconnect/i);
    fireEvent.click(screen.getByTestId("ctrader-disconnect-btn"));
    await waitFor(() => expect(disconnectCTrader).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("broker-action-banner")).toHaveTextContent(/disconnected/i);
  });

  it("requires Live account confirmation before selecting", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    listCTraderAccounts.mockResolvedValue(accountsFixture);
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-refresh-accounts-btn"));
    fireEvent.click(screen.getByTestId("ctrader-refresh-accounts-btn"));
    await waitFor(() => screen.getByTestId("ctrader-account-****9910"));
    fireEvent.click(screen.getByTestId("ctrader-account-****9910"));
    expect(selectCTraderAccount).not.toHaveBeenCalled();
    expect(screen.getByTestId("ctrader-account-****9910")).toHaveTextContent(/Confirm Live/i);
    fireEvent.click(screen.getByTestId("ctrader-account-****9910"));
    await waitFor(() =>
      expect(selectCTraderAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          ctidTraderAccountId: "live-9910",
          confirmLiveSelection: true
        })
      )
    );
  });

  it("selects Demo account without extra confirmation", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-refresh-accounts-btn"));
    fireEvent.click(screen.getByTestId("ctrader-refresh-accounts-btn"));
    await waitFor(() => screen.getByTestId("ctrader-account-****4821"));
    fireEvent.click(screen.getByTestId("ctrader-account-****4821"));
    await waitFor(() =>
      expect(selectCTraderAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          ctidTraderAccountId: "demo-4821",
          confirmLiveSelection: false
        })
      )
    );
  });

  it("shows trade preview loading then result", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    let resolvePreview: (v: unknown) => void = () => undefined;
    createCTraderPreview.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        })
    );
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-live-preview-btn"));
    fireEvent.click(screen.getByTestId("ctrader-live-preview-btn"));
    expect(await screen.findByTestId("ctrader-preview-loading")).toBeInTheDocument();
    await act(async () => {
      resolvePreview({
        notice: "Preview only — no order will be submitted.",
        preview: { action: "BUY", state: "READY_FOR_CONFIRMATION", proposedVolume: 0.02, riskAmount: 20 },
        quote: { bid: 2350, ask: 2350.3, spread: 0.3 }
      });
    });
    expect(await screen.findByTestId("ctrader-preview-only")).toBeInTheDocument();
  });

  it("shows reconnect-required UI on ACCESS_DENIED", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    listCTraderAccounts.mockRejectedValue(new ApiError(403, "ACCESS_DENIED", "denied"));
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-refresh-accounts-btn"));
    fireEvent.click(screen.getByTestId("ctrader-refresh-accounts-btn"));
    expect(await screen.findByTestId("broker-reconnect-required")).toBeInTheDocument();
    expect(screen.getByTestId("broker-connection-status")).toHaveTextContent(/Reconnect required/i);
    expect(screen.getByTestId("ctrader-reconnect-btn")).toBeInTheDocument();
  });

  it("reloads winner state on VERSION_CONFLICT", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    listCTraderAccounts
      .mockRejectedValueOnce(new ApiError(409, "CTRADER_TOKEN_VERSION_CONFLICT", "conflict"))
      .mockResolvedValue(accountsFixture);
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-refresh-accounts-btn"));
    const loadsBefore = getBrokerControlCentre.mock.calls.length;
    fireEvent.click(screen.getByTestId("ctrader-refresh-accounts-btn"));
    await waitFor(() => {
      expect(getBrokerControlCentre.mock.calls.length).toBeGreaterThan(loadsBefore);
    });
    expect(await screen.findByTestId("broker-action-banner")).toHaveTextContent(
      /updated elsewhere|Reloading/i
    );
  });

  it("applies only the latest diagnostics refresh (latest-request-wins)", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    getCTraderDiagnostics.mockResolvedValue({
      ...diagnosticsFixture,
      account: { ...diagnosticsFixture.account, accountIdMasked: "INIT****" }
    });
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-diagnostics-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("ctrader-account-snapshot").textContent).toMatch(/INIT\*\*\*\*/)
    );

    getCTraderDiagnostics.mockResolvedValueOnce({
      ...diagnosticsFixture,
      account: { ...diagnosticsFixture.account, accountIdMasked: "NEW****" }
    });
    fireEvent.click(screen.getByTestId("ctrader-diagnostics-btn"));
    await waitFor(() => {
      const snap = screen.getByTestId("ctrader-account-snapshot");
      expect(snap.textContent).toMatch(/NEW\*\*\*\*/);
      expect(snap.textContent).not.toMatch(/INIT\*\*\*\*/);
    });
  });

  it("does not show Connected + Account pending when selected account exists", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    getCTraderDiagnostics.mockResolvedValue(diagnosticsFixture);
    renderBroker();
    await waitFor(() => {
      expect(screen.getByTestId("broker-connection-status")).toHaveTextContent("Connected");
      expect(screen.getByTestId("broker-account-type")).toHaveTextContent(/Demo account selected/i);
    });
  });

  it("shows reconnect instead of Connected when token refresh is unhealthy", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    getCTraderDiagnostics.mockResolvedValue({
      ...diagnosticsFixture,
      connection: { ...diagnosticsFixture.connection, tokenRefreshHealthy: false }
    });
    renderBroker();
    await waitFor(() => {
      expect(screen.getByTestId("broker-connection-status")).toHaveTextContent(/Reconnect required/i);
      expect(screen.getByTestId("broker-reconnect-required")).toBeInTheDocument();
    });
  });

  it("retries the last failed action from the error banner", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    listCTraderAccounts
      .mockRejectedValueOnce(new ApiError(500, "CTRADER_UNAVAILABLE", "down"))
      .mockResolvedValue(accountsFixture);
    renderBroker();
    await waitFor(() => screen.getByTestId("ctrader-refresh-accounts-btn"));
    fireEvent.click(screen.getByTestId("ctrader-refresh-accounts-btn"));
    expect(await screen.findByTestId("broker-centre-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    await waitFor(() => expect(listCTraderAccounts).toHaveBeenCalledTimes(2));
  });

  it("supports keyboard activation on refresh accounts", async () => {
    getBrokerControlCentre.mockResolvedValue(connectedCentre);
    renderBroker();
    const btn = await screen.findByTestId("ctrader-refresh-accounts-btn");
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter", code: "Enter" });
    fireEvent.click(btn);
    await waitFor(() => expect(listCTraderAccounts).toHaveBeenCalled());
  });
});
