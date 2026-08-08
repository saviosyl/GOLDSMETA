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
  setCTraderEmergencyStop: vi.fn(async () => ({})),
  getAutoTradeQualification: vi.fn(async () => ({
    state: "SETUP_REQUIRED",
    overallLabel: "Setup required",
    accountMasked: null,
    accountIdPresent: false,
    environment: "DEMO",
    nextAction: "Connect Pepperstone Demo",
    nextRequirement: "Complete setup",
    blockers: [
      { id: "oauth", label: "Pepperstone Demo connected", ok: false }
    ],
    canStart: false,
    canPause: false,
    canResume: false,
    canEnableDemoAuto: false,
    canBeginLiveActivation: false,
    preview: { completed: 0, required: 20 },
    controlledDemo: { completed: 0, required: 5, open: 0, blockedAttempts: 0 },
    observation: { day: null, requiredDays: 7, firstTradeAt: null, remainingMs: null },
    safety: { completed: 0, required: 6, checks: [] },
    liveEligibility: {
      demoAutoTrades: 0,
      requiredTrades: 20,
      observationDay: null,
      requiredDays: 7,
      criticalSafetyFailures: 0,
      status: "LOCKED"
    },
    demoAuto: { enabled: false, ready: false },
    liveOrders: "LOCKED",
    recentPreviews: [],
    recentControlledTrades: [],
    todayActivity: { evaluated: 0, qualified: 0, rejected: 0 },
    recentEvaluations: [],
    startedAt: null,
    updatedAt: null
  })),
  startAutoTradeQualification: vi.fn(),
  pauseAutoTradeQualification: vi.fn(),
  resumeAutoTradeQualification: vi.fn(),
  enableDemoAutoFromQualification: vi.fn(),
  authoriseCTraderDemoTrading: vi.fn(),
  getDailySafety: vi.fn(async () => ({
    environment: "demo",
    tradingDay: "2026-08-08",
    tradesToday: 0,
    tradesMax: 6,
    tradesLimitReached: false,
    dailyPnl: 0,
    dailyLossLimit: 50,
    dailyLossUsed: 0,
    dailyLossRemaining: 50,
    dailyLossLimitReached: false,
    consecutiveLosses: 0,
    consecutiveLossMax: 3,
    consecutiveLossPaused: false,
    openPositions: 0,
    openPositionsMax: 1,
    cooldownActive: false,
    cooldownRemainingMs: null,
    cooldownLabel: "Ready",
    emergencyStopActive: false,
    emergencyStopLabel: "READY",
    autoTradeLabel: "QUALIFYING",
    dailyProfitTarget: null,
    dailyProfitTargetEnabled: false,
    dailyProfitTargetReached: false,
    profitProtectionEnabled: false,
    profitProtectionPaused: false,
    peakDailyPnl: 0,
    protectedMinimumPnl: null,
    entriesBlocked: false,
    entriesBlockedReason: null,
    currency: "EUR"
  })),
  resumeDailySafety: vi.fn(),
  getOpenAutoTradePositions: vi.fn(async () => ({
    environment: "DEMO",
    positions: []
  })),
  getNewsGuardStatus: vi.fn(async () => ({
    news: {
      configured: false,
      provider: "NONE",
      providerLabel: "Not configured",
      active: false,
      upcoming: []
    },
    liveOrders: "LOCKED"
  })),
  getSystemHealth: vi.fn(async () => ({
    marketFeed: { tone: "green", label: "OK" },
    strategyFeed: { tone: "green", label: "OK" },
    broker: { tone: "green", label: "OK" },
    autoTradeEngine: { tone: "green", label: "OK" },
    riskEngine: { tone: "green", label: "OK" },
    notifications: { tone: "green", label: "OK" },
    qualificationWorker: { tone: "green", label: "OK" },
    overall: "green",
    plainSummary: "All systems healthy"
  }))
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
    api.getAutoTradeQualification.mockResolvedValue({
      state: "READY_TO_QUALIFY",
      overallLabel: "Ready to qualify",
      accountMasked: "****4810",
      accountIdPresent: true,
      environment: "DEMO",
      nextAction: "Start qualification",
      nextRequirement: "Complete setup",
      blockers: [
        { id: "oauth", label: "Pepperstone Demo connected", ok: true },
        { id: "trading_scope", label: "Demo trading permission", ok: true },
        { id: "risk", label: "Risk limits configured", ok: true }
      ],
      canStart: true,
      canPause: false,
      canResume: false,
      canEnableDemoAuto: false,
      canBeginLiveActivation: false,
      preview: { completed: 0, required: 20 },
      controlledDemo: { completed: 0, required: 5, open: 0, blockedAttempts: 0 },
      observation: { day: null, requiredDays: 7, firstTradeAt: null, remainingMs: null },
      safety: { completed: 4, required: 6, checks: [] },
      liveEligibility: {
        demoAutoTrades: 0,
        requiredTrades: 20,
        observationDay: null,
        requiredDays: 7,
        criticalSafetyFailures: 0,
        status: "LOCKED"
      },
      demoAuto: { enabled: false, ready: false },
      liveOrders: "LOCKED",
      recentPreviews: [],
      recentControlledTrades: [],
      todayActivity: { evaluated: 0, qualified: 0, rejected: 0 },
      recentEvaluations: [],
      startedAt: null,
      updatedAt: new Date().toISOString()
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
    expect(screen.getByTestId("autotrade-qualification")).toBeInTheDocument();
    expect(screen.getByTestId("qual-start")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-connection-label")).toHaveTextContent("Connected");
    expect(screen.getByTestId("autotrade-broker-quotes-stat")).toHaveTextContent(/Active|Live/i);
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
    expect(screen.getByTestId("autotrade-step-9-status")).toHaveTextContent("Current");
    // Trading scope comes from qualification blockers when diagnostics omit oauthScope.
    expect(screen.getByTestId("autotrade-step-10-status")).toHaveTextContent("Complete");
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

  it("does not wait on hanging diagnostics to show Broker Demo + qualification", async () => {
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
          accountMasked: "48…10",
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
    api.listCTraderAccounts.mockResolvedValue({
      accounts: [
        {
          ctidTraderAccountId: "48014710",
          accountIdMasked: "48…10",
          isLive: false,
          selected: true,
          brokerNameTitle: "Pepperstone",
          depositCurrency: "EUR"
        }
      ]
    });
    api.getAutoTradeQualification.mockResolvedValue({
      state: "SETUP_REQUIRED",
      overallLabel: "Setup required",
      accountMasked: "48…10",
      accountIdPresent: true,
      environment: "DEMO",
      nextAction: "Authorise Demo Trading",
      nextRequirement: "Demo trading permission",
      blockers: [
        { id: "oauth", label: "Pepperstone Demo 48…10 connected", ok: true },
        { id: "symbol", label: "XAUUSD verified", ok: true },
        { id: "trading_scope", label: "Demo trading permission", ok: false, action: "Authorise Demo Trading" },
        { id: "broker_quotes", label: "Broker quotes available", ok: true },
        { id: "risk", label: "Risk settings configured", ok: true }
      ],
      canStart: false,
      canPause: false,
      canResume: false,
      canEnableDemoAuto: false,
      canBeginLiveActivation: false,
      preview: { completed: 0, required: 20 },
      controlledDemo: { completed: 0, required: 5, open: 0, blockedAttempts: 0 },
      observation: { day: null, requiredDays: 7, firstTradeAt: null, remainingMs: null },
      safety: { completed: 0, required: 6, checks: [] },
      liveEligibility: {
        demoAutoTrades: 0,
        requiredTrades: 20,
        observationDay: null,
        requiredDays: 7,
        criticalSafetyFailures: 0,
        status: "LOCKED"
      },
      demoAuto: { enabled: false, ready: false },
      liveOrders: "LOCKED",
      recentPreviews: [],
      recentControlledTrades: [],
      todayActivity: { evaluated: 0, qualified: 0, rejected: 0 },
      recentEvaluations: [],
      startedAt: null,
      updatedAt: null
    });
    // Diagnostics hangs — historically blocked Promise.allSettled and hid qualification.
    api.getCTraderDiagnostics.mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    );

    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("autotrade-broker-account-stat")).toHaveTextContent(/Demo · 48…10/)
    );
    expect(screen.getByTestId("autotrade-broker-account-stat")).toHaveTextContent(/Connected/i);
    expect(screen.getByTestId("autotrade-broker-quotes-stat")).toHaveTextContent(/Active|Live/i);
    expect(screen.getByTestId("autotrade-qualification")).toBeInTheDocument();
    expect(screen.getByTestId("qual-next-action")).toHaveTextContent(/Authorise Demo Trading/i);
    expect(screen.getByTestId("qual-authorise-trading")).toBeInTheDocument();
    expect(screen.queryByTestId("autotrade-setup-required")).not.toBeInTheDocument();
    expect(screen.queryByTestId("qual-start")).not.toBeInTheDocument();
  });

  it("shows qualification retry UI when qualification API fails", async () => {
    api.getBrokerControlCentre.mockResolvedValue({
      defaultBroker: "pepperstone_ctrader",
      autoTrade: "OFF",
      brokers: [],
      automationModes: [],
      readiness: {
        setupRequired: false,
        connected: true,
        connectionSummary: {
          accountMasked: "48…10",
          brokerName: "Pepperstone",
          pepperstoneConfirmed: true,
          symbolName: "XAUUSD",
          lastSyncAt: new Date().toISOString(),
          lastQuoteAt: new Date().toISOString()
        }
      }
    });
    api.listCTraderAccounts.mockResolvedValue({
      accounts: [
        {
          ctidTraderAccountId: "48014710",
          accountIdMasked: "48…10",
          isLive: false,
          selected: true
        }
      ]
    });
    api.getCTraderDiagnostics.mockRejectedValue(new Error("gateway timeout"));
    api.getAutoTradeQualification.mockRejectedValue(
      Object.assign(new Error("Unable to load qualification status"), {
        code: "INTERNAL"
      })
    );

    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("autotrade-qualification-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("qual-retry")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-broker-account-stat")).toHaveTextContent(/48…10/);
  });
});
