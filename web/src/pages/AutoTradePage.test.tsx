import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AutoTradePage } from "./AutoTradePage";
import {
  buildReviewAutoTradeStatus,
  type AutoTradeStatus
} from "../lib/autoTradeTypes";
import "../styles/redesign.css";

const baseStatus = buildReviewAutoTradeStatus();

// Loose mock API — return shapes vary per test (Broker sync vs disconnected).
const api: Record<string, ReturnType<typeof vi.fn>> = {
  autoTradeStatus: vi.fn(async () => baseStatus),
  autoTradeSetMode: vi.fn(async (mode: string) => ({
    ...baseStatus,
    mode,
    displayStatus: mode === "SHADOW" ? "SHADOW" : "OFF"
  })),
  autoTradeConnect: vi.fn(async () => baseStatus),
  autoTradeDisconnect: vi.fn(async () => baseStatus),
  autoTradeDemoDiagnostics: vi.fn(async () => baseStatus),
  autoTradeEmergencyStop: vi.fn(async () => ({
    ...baseStatus,
    displayStatus: "LOCKED" as const,
    locked: true,
    mode: "OFF" as const,
    emergencyStopActive: true,
    lockReason: "emergency_stop"
  })),
  autoTradeUnlock: vi.fn(async () => baseStatus),
  autoTradeUpdateLimits: vi.fn(async () => baseStatus),
  autoTradeSelectBroker: vi.fn(async (broker: string) => ({
    ...baseStatus,
    selectedBroker: broker as AutoTradeStatus["selectedBroker"],
    brokerBadge:
      broker === "T212_INVEST"
        ? "T212 PRACTICE — READ ONLY"
        : broker === "PEPPERSTONE_CTRADER"
          ? "PEPPERSTONE CTRADER DEMO — READ ONLY"
          : "MANUAL",
    igParked: true
  })),
  autoTradeT212Connect: vi.fn(async () => baseStatus),
  autoTradeT212Disconnect: vi.fn(async () => baseStatus),
  autoTradeT212Diagnostics: vi.fn(async () => baseStatus),
  autoTradeT212SearchInstruments: vi.fn(async () => ({
    candidates: [],
    status: baseStatus
  })),
  autoTradeT212ConfirmInstrument: vi.fn(async () => baseStatus),
  autoTradeT212CreateProposal: vi.fn(async () => ({
    proposal: null,
    status: baseStatus
  })),
  autoTradeT212ApproveDryRun: vi.fn(async () => ({
    proposal: null,
    status: baseStatus
  })),
  getBrokerControlCentre: vi.fn(async () => ({
    defaultBroker: "pepperstone_ctrader",
    autoTrade: "OFF",
    brokers: [
      {
        id: "pepperstone_ctrader",
        name: "Pepperstone cTrader Demo",
        status: "Pepperstone connection required",
        detail: "Demo read-only",
        badge: "PREVIEW"
      }
    ],
    automationModes: [],
    readiness: {
      setupRequired: true,
      authSetupRequired: false,
      oauthConfigured: false,
      connected: false,
      demonstrationAvailable: true,
      automationMode: "OFF",
      autoTrade: "OFF",
      orderSubmissionEnabled: false,
      liveEnabled: false,
      wizardSteps: [],
      label: "Setup required",
      auth: { status: "UNKNOWN", brokerSetupEnabled: false, notes: [] },
      qualification: {
        unlocked: false,
        canActivate: false,
        failed: [],
        progress: {
          completedPreviews: 0,
          requiredPreviews: 3,
          approvedControlledDemoTrades: 0,
          requiredTrades: 3,
          daysSinceFirstTrade: null,
          requiredDays: 7
        }
      }
    }
  })),
  getCTraderDiagnostics: vi.fn(async () => {
    throw new Error("not connected");
  }),
  listCTraderAccounts: vi.fn(async () => ({ accounts: [] })),
  getAutoTradeSettings: vi.fn(async () => ({
    settings: {
      uid: "u",
      environment: "demo",
      updatedAt: new Date().toISOString(),
      selectedAccountId: null as string | null,
      sizingMode: "automatic_risk",
      fixedRiskAmount: 20,
      percentageRisk: 0.5,
      manualLotSize: 0.01,
      maxDailyLoss: 50,
      maxTradesPerDay: 3,
      maxOpenPositions: 1,
      minConfidence: 80,
      minRiskReward: 1.5,
      maxSpread: 2,
      maxQuoteAgeSeconds: 15,
      stopLossDistance: null,
      takeProfitMethod: "fixed_rr",
      tradeCooldownMinutes: 30,
      pauseAfterConsecutiveLosses: 3,
      allowedSessions: ["London", "NewYork"],
      allowedDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      newsFilterEnabled: true,
      confirmationCandleRequired: true,
      trendConfirmationRequired: false,
      volumeConfirmationRequired: false,
      breakEvenEnabled: false,
      trailingStopEnabled: false,
      partialTakeProfitEnabled: false,
      liveActivationConfirmedAt: null,
      liveActivationPhraseConfirmed: false,
      autoTradeEnabledIntent: false,
      emergencyStopActive: false
    },
    recommended: {}
  })),
  setCTraderEmergencyStop: vi.fn(async () => ({}))
};

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ api, account: { role: "USER", access: "APP" } })
}));

describe("AutoTradePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.autoTradeStatus.mockResolvedValue(baseStatus);
  });

  it("renders Pepperstone-first dashboard with emergency STOP", async () => {
    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("autotrade-page")).toBeInTheDocument());
    expect(screen.getByTestId("autotrade-mode-pill")).toHaveTextContent("OFF");
    expect(screen.getByTestId("autotrade-broker-badge")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-readonly-banner")).toHaveTextContent(
      /Demo Auto is available|Live execution stays locked/i
    );
    expect(screen.getByTestId("autotrade-tab-demo")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-tab-live")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-emergency-stop")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-setup-journey")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-card-account")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-card-market")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-card-risk")).toBeInTheDocument();
    expect(screen.queryByText(/IG Demo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Parked — temporarily unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("autotrade-view-diagnostics")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-enable-demo-auto")).toBeEnabled();
  });

  it("keeps technical modes behind View diagnostics", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("autotrade-page")).toBeInTheDocument());
    await user.click(screen.getByTestId("autotrade-view-diagnostics"));
    expect(screen.getByTestId("autotrade-mode-IG_DEMO_AUTO")).toBeDisabled();
    expect(screen.getByTestId("autotrade-mode-IG_LIVE_AUTO")).toBeDisabled();
  });

  it("locks mode after Emergency STOP", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("autotrade-emergency-stop")).toBeInTheDocument());
    await user.click(screen.getByTestId("autotrade-emergency-stop"));
    await waitFor(() =>
      expect(api.autoTradeEmergencyStop).toHaveBeenCalled()
    );
    await waitFor(() =>
      expect(screen.getByTestId("autotrade-mode-pill")).toHaveTextContent("OFF")
    );
  });

  it("does not expose active IG Demo broker card", async () => {
    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("autotrade-page")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /IG Demo/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("autotrade-connect-ctrader")).toHaveAttribute("href", "/brokers");
  });

  it("shows Broker-selected Demo account on AutoTrade summary and advances wizard", async () => {
    api.autoTradeStatus.mockResolvedValue({
      ...baseStatus,
      activity: [
        {
          id: "stale",
          at: "2026-08-01T00:00:00.000Z",
          message: "Broker set to PEPPERSTONE_CTRADER. AutoTrade OFF — reconnect required.",
          level: "warn"
        }
      ]
    });
    api.getBrokerControlCentre.mockResolvedValue({
      defaultBroker: "pepperstone_ctrader",
      autoTrade: "OFF",
      brokers: [],
      automationModes: [],
      readiness: {
        setupRequired: false,
        authSetupRequired: false,
        oauthConfigured: true,
        connected: true,
        demonstrationAvailable: true,
        automationMode: "OFF",
        autoTrade: "OFF",
        orderSubmissionEnabled: false,
        liveEnabled: false,
        wizardSteps: [],
        label: "Connected",
        connectionSummary: {
          accountMasked: "****4810",
          brokerName: "Pepperstone",
          pepperstoneConfirmed: true,
          symbolName: "XAUUSD",
          lastSyncAt: new Date().toISOString(),
          lastQuoteAt: new Date().toISOString()
        },
        auth: { status: "HEALTHY", brokerSetupEnabled: true, notes: [] },
        qualification: {
          unlocked: false,
          canActivate: false,
          failed: [],
          progress: {
            completedPreviews: 0,
            requiredPreviews: 20,
            approvedControlledDemoTrades: 0,
            requiredTrades: 5,
            daysSinceFirstTrade: null,
            requiredDays: 7
          }
        }
      }
    });
    api.getCTraderDiagnostics.mockResolvedValue({
      oauthConnected: true,
      accountSelected: true,
      demoAccountSelected: true,
      selectedAccountIsLive: false,
      credentialsConfigured: true,
      pepperstoneConfirmed: true,
      goldSymbolFound: true,
      liveQuoteReceived: true,
      spreadAvailable: true,
      volumeRulesAvailable: true,
      marginMetadataAvailable: false,
      marketStatusAvailable: true,
      tradingSafelyLocked: true,
      autoTrade: "OFF",
      environment: "DEMO",
      connection: {
        accountMasked: "****4810",
        brokerName: "Pepperstone",
        currency: "EUR",
        symbolName: "XAUUSD",
        tokenRefreshHealthy: true
      },
      symbol: { symbolName: "XAUUSD", minVolume: 0.01, volumeStep: 0.01 },
      quote: {
        bid: 4046.35,
        ask: 4046.64,
        spread: 0.29,
        marketStatus: "CLOSED",
        stale: true,
        timestamp: new Date().toISOString()
      }
    });
    api.listCTraderAccounts.mockResolvedValue({
      accounts: [
        {
          ctidTraderAccountId: "demo-4810",
          accountIdMasked: "****4810",
          isLive: false,
          selected: true,
          brokerNameTitle: "Pepperstone",
          depositCurrency: "EUR"
        }
      ]
    });
    api.getAutoTradeSettings.mockResolvedValue({
      settings: {
        uid: "u",
        environment: "demo",
        updatedAt: new Date().toISOString(),
        selectedAccountId: "demo-4810",
        sizingMode: "automatic_risk",
        fixedRiskAmount: 20,
        percentageRisk: 0.5,
        manualLotSize: 0.01,
        maxDailyLoss: 50,
        maxTradesPerDay: 3,
        maxOpenPositions: 1,
        minConfidence: 80,
        minRiskReward: 1.5,
        maxSpread: 2,
        maxQuoteAgeSeconds: 15,
        stopLossDistance: null,
        takeProfitMethod: "fixed_rr",
        tradeCooldownMinutes: 30,
        pauseAfterConsecutiveLosses: 3,
        allowedSessions: ["London", "NewYork"],
        allowedDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        newsFilterEnabled: true,
        confirmationCandleRequired: true,
        trendConfirmationRequired: false,
        volumeConfirmationRequired: false,
        breakEvenEnabled: false,
        trailingStopEnabled: false,
        partialTakeProfitEnabled: false,
        liveActivationConfirmedAt: null,
        liveActivationPhraseConfirmed: false,
        autoTradeEnabledIntent: false,
        emergencyStopActive: false
      },
      recommended: {}
    });

    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("autotrade-broker-badge")).toHaveTextContent(
        /Pepperstone Demo · \*\*\*\*4810/
      )
    );
    expect(screen.getByTestId("autotrade-connection-label")).toHaveTextContent("Connected");
    expect(screen.getByTestId("autotrade-market-label")).toHaveTextContent(
      /XAUUSD · Market closed/i
    );
    expect(screen.getByTestId("autotrade-mode-label")).toHaveTextContent("Demo AutoTrade");
    expect(screen.getByTestId("autotrade-mode-pill")).toHaveTextContent("OFF");
    expect(screen.getByTestId("autotrade-market-status")).toHaveTextContent(/Market closed/i);
    expect(screen.getByTestId("autotrade-quote-label")).toHaveTextContent(/Previous-session quote/i);
    expect(screen.getByTestId("autotrade-execution-label")).toHaveTextContent(/market closed/i);
    expect(screen.getByTestId("autotrade-step-3-status")).toHaveTextContent("Complete");
    expect(screen.getByTestId("autotrade-step-4-status")).toHaveTextContent("Complete");
    expect(screen.getByTestId("autotrade-step-5-status")).toHaveTextContent("Complete");
    expect(screen.getByTestId("autotrade-step-6-status")).toHaveTextContent("Complete");
    expect(screen.getByTestId("autotrade-step-10-status")).toHaveTextContent("Current");
    expect(screen.getByTestId("autotrade-step-11-status")).toHaveTextContent("Locked");
    expect(screen.getByTestId("autotrade-broker-account-stat")).toHaveTextContent(/Demo · \*\*\*\*4810/);
    expect(screen.getByTestId("autotrade-live-execution-stat")).toHaveTextContent(/Not selected/i);
    expect(screen.getByTestId("autotrade-market-data-stat")).toHaveTextContent(/Connected|Market closed/i);
    expect(screen.queryByTestId("autotrade-setup-required")).not.toBeInTheDocument();
    const activity = screen.getByTestId("autotrade-activity");
    expect(activity.textContent).toMatch(/Demo account \*\*\*\*4810 connected\. AutoTrade OFF/);
    const connectedIdx = activity.textContent?.toLowerCase().indexOf("connected. autotrade off") ?? -1;
    const reconnectIdx = activity.textContent?.toLowerCase().indexOf("reconnect required") ?? -1;
    expect(connectedIdx).toBeGreaterThanOrEqual(0);
    if (reconnectIdx >= 0) {
      expect(connectedIdx).toBeLessThan(reconnectIdx);
    }
  });
});
