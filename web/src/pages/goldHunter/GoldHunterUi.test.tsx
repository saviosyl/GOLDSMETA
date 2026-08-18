import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GoldHunterShell } from "./GoldHunterShell";
import { GoldHunterDashboardPage } from "./GoldHunterDashboardPage";
import { GoldHunterControlPage } from "./GoldHunterControlPage";
import { GoldHunterMonitorPage } from "./GoldHunterMonitorPage";
import { GoldHunterPerformancePage } from "./GoldHunterPerformancePage";

const goldHunterUpdateConfig = vi.fn();

const status = {
  product: "GOLD_HUNTER" as const,
  executionMode: "DEMO_ONLY" as const,
  liveExecutionEnabled: false as const,
  runtimeSha: "testsha",
  config: {
    allocatedCapitalEur: 5000,
    riskPerTradePct: 1,
    dailyLossLimitPct: 5,
    maxOpenTrades: 1,
    demoAutoTradeEnabled: false,
    pauseNewEntries: false,
    emergencyStopActive: false,
    mode: "RESEARCH" as const,
    updatedAt: "2026-08-15T00:00:00.000Z",
    updatedBy: "owner-1"
  },
  modeLabel: {
    primary: "RESEARCH",
    secondary: "PAPER ONLY",
    tertiary: "NO BROKER EXECUTION"
  },
  market: {
    symbol: "XAUUSD" as const,
    bid: 2390.1,
    ask: 2390.4,
    mid: 2390.25,
    spread: 0.3,
    marketStatus: "CLOSED",
    freshness: "STALE",
    ageMs: 90_000,
    feedState: "STALE",
    updatedAt: "2026-08-15T00:00:00.000Z"
  },
  broker: {
    provider: "cTrader" as const,
    connected: true,
    environment: "DEMO" as const,
    authState: "AUTHORISED",
    authorised: true,
    accountMasked: "****1234",
    brokerName: "Pepperstone",
    balance: 50000,
    currency: "EUR",
    equity: 49985.2,
    marginUsed: 120,
    freeMargin: 49865.2,
    openPositionCount: 0,
    snapshotAgeMs: 1200,
    lastSyncAt: "2026-08-15T22:00:00.000Z",
    snapshotSource: "AUTHORITATIVE_DEMO",
    demoOrderSubmissionEnabled: true,
    validForRisk: true
  },
  capital: {
    allocatedEur: 5000,
    committedEur: 0,
    availableEur: 5000,
    todayPnlEur: 0,
    riskBudgetEur: 50,
    dailyLossBudgetEur: 250,
    committedKnown: true
  },
  health: {
    marketFeed: "STALE",
    transport: "CONNECTED",
    depth: "UNAVAILABLE",
    strategy: "WAITING_FOR_MARKET",
    risk: "NORMAL",
    autoTrade: "OFF"
  },
  strategyPipeline: {
    connected: false,
    spot: "CLOSED",
    depth: "UNAVAILABLE",
    selector: "NOT_CONNECTED",
    state: "SELECTOR_NOT_CONNECTED",
    lastSelectedCandidate: null,
    lastObservationAt: null,
    normalizationVersion: "CTRADER_NORMALIZED_V1",
    protectionGeometryConnected: true
  },
  arming: {
    ready: false,
    blockers: ["STRATEGY_SELECTOR_NOT_CONNECTED"],
    strategySelectorConnected: false
  },
  gates: {
    ok: false,
    blockers: ["WAIT — AUTOTRADE OFF", "WAIT — MARKET CLOSED"],
    executionMode: "DEMO_ONLY" as const,
    liveExecutionEnabled: false as const
  },
  openTrades: [],
  unmatchedDemoPositions: [],
  performanceToday: {
    netPnl: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    profitFactor: null,
    avgWin: null,
    avgLoss: null,
    expectancy: null,
    maxDrawdown: null
  },
  audit: [],
  signal: {
    present: false,
    setup: null,
    side: null,
    signalId: null,
    quality: null,
    signalTimestamp: null,
    depthValidity: null,
    consumed: false,
    ageMs: null,
    note: "WAIT — NO SETUP SELECTED"
  },
  execution: {
    autoTradeEnabled: false,
    lastOpportunityId: null,
    lastSignalId: null,
    lastSetup: null,
    lastSide: null,
    lastOpportunityStartedAt: null,
    lastAttemptAt: null,
    lastAttemptCompletedAt: null,
    state: "IDLE",
    blocker: null,
    detail: null,
    outcome: null,
    tradeId: null,
    brokerOrderIdMaskedOrSafe: null,
    brokerPositionIdMaskedOrSafe: null,
    attemptCountForOpportunity: 0,
    queue: {
      pending: 0,
      dropped: 0,
      completed: 0,
      maxPendingSeen: 0
    }
  }
};
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    account: { role: "OWNER", uid: "owner-1" },
    user: { uid: "owner-1" },
    api: {
      goldHunterStatus: vi.fn(async () => status),
      goldHunterConfig: vi.fn(async () => ({
        config: status.config,
        executionMode: "DEMO_ONLY",
        liveExecutionEnabled: false
      })),
      goldHunterUpdateConfig,
      goldHunterTrades: vi.fn(async () => ({
        trades: [],
        strategy: "GOLD_HUNTER",
        environment: "DEMO"
      })),
      goldHunterPerformance: vi.fn(async () => ({
        range: "today",
        demo: status.performanceToday,
        paper: null,
        paperNote: "separate"
      })),
      goldHunterRefreshAccount: vi.fn(async () => status)
    }
  })
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/gold-hunter" element={<GoldHunterShell />}>
          <Route index element={<GoldHunterDashboardPage />} />
          <Route path="control" element={<GoldHunterControlPage />} />
          <Route path="monitor" element={<GoldHunterMonitorPage />} />
          <Route path="performance" element={<GoldHunterPerformancePage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("Gold Hunter UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status.config.demoAutoTradeEnabled = false;
    status.arming = {
      ready: false,
      blockers: ["STRATEGY_SELECTOR_NOT_CONNECTED"],
      strategySelectorConnected: false
    };
    status.gates = {
      ok: false,
      blockers: ["WAIT — AUTOTRADE OFF", "WAIT — MARKET CLOSED"],
      executionMode: "DEMO_ONLY",
      liveExecutionEnabled: false
    };
    status.openTrades = [];
    status.market.marketStatus = "CLOSED";
    goldHunterUpdateConfig.mockImplementation(async () => ({
      config: status.config,
      executionMode: "DEMO_ONLY",
      liveExecutionEnabled: false
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders dashboard with allocation and market-closed wait", async () => {
    renderAt("/gold-hunter");
    await waitFor(() => expect(screen.getByTestId("gh-dashboard")).toBeInTheDocument());
    expect(screen.getByTestId("gh-allocation")).toHaveTextContent("5,000");
    expect(screen.getByTestId("gh-primary-wait")).toHaveTextContent("AUTOTRADE OFF");
    expect(screen.getByTestId("gh-demo-balance")).toHaveTextContent("50,000");
    expect(screen.getByTestId("gh-demo-equity")).toHaveTextContent("49,985");
    expect(screen.getByTestId("gh-account-refresh")).toBeInTheDocument();
  });

  it("shows Demo AutoTrade card as NOT READY with LIVE LOCKED and exact blocker", async () => {
    renderAt("/gold-hunter");
    await waitFor(() => expect(screen.getByTestId("gh-demo-autotrade-card")).toBeInTheDocument());
    expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent("NOT READY");
    expect(screen.getByText("LIVE LOCKED")).toBeInTheDocument();
    expect(screen.getByTestId("gh-demo-autotrade-card")).toHaveTextContent(
      "Cannot start yet: STRATEGY_SELECTOR_NOT_CONNECTED"
    );
    expect(screen.getByTestId("gh-dashboard-start-demo-auto")).toBeInTheDocument();
  });

  it("shows READY TO ARM and arms via confirmDemoAutoTrade=true only", async () => {
    status.arming = {
      ready: true,
      blockers: [],
      strategySelectorConnected: true
    };
    status.gates = {
      ok: false,
      blockers: ["WAIT — AUTOTRADE OFF"],
      executionMode: "DEMO_ONLY",
      liveExecutionEnabled: false
    };
    status.market.marketStatus = "OPEN";
    renderAt("/gold-hunter");
    await waitFor(() => expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent("READY TO ARM"));
    fireEvent.click(screen.getByTestId("gh-dashboard-start-demo-auto"));
    await waitFor(() => expect(goldHunterUpdateConfig).toHaveBeenCalledTimes(1));
    expect(goldHunterUpdateConfig).toHaveBeenCalledWith({
      demoAutoTradeEnabled: true,
      confirmDemoAutoTrade: true
    });
  });

  it("treats NO SETUP SELECTED as ARMED — WAITING FOR VALID SIGNAL", async () => {
    status.config.demoAutoTradeEnabled = true;
    status.arming = {
      ready: true,
      blockers: [],
      strategySelectorConnected: true
    };
    status.gates = {
      ok: false,
      blockers: ["WAIT — NO SETUP SELECTED"],
      executionMode: "DEMO_ONLY",
      liveExecutionEnabled: false
    };
    status.market.marketStatus = "OPEN";
    renderAt("/gold-hunter");
    await waitFor(() =>
      expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent(
        "ARMED — WAITING FOR VALID SIGNAL"
      )
    );
    expect(screen.queryByText(/TEMPORARILY BLOCKED/)).not.toBeInTheDocument();
  });

  it("shows ARMED — WAITING FOR VALID SIGNAL and can stop Demo AutoTrade", async () => {
    status.config.demoAutoTradeEnabled = true;
    status.arming = {
      ready: true,
      blockers: [],
      strategySelectorConnected: true
    };
    status.gates = {
      ok: true,
      blockers: [],
      executionMode: "DEMO_ONLY",
      liveExecutionEnabled: false
    };
    status.market.marketStatus = "OPEN";
    renderAt("/gold-hunter");
    await waitFor(() =>
      expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent(
        "ARMED — WAITING FOR VALID SIGNAL"
      )
    );
    fireEvent.click(screen.getByTestId("gh-dashboard-stop-demo-auto"));
    await waitFor(() => expect(goldHunterUpdateConfig).toHaveBeenCalledTimes(1));
    expect(goldHunterUpdateConfig).toHaveBeenCalledWith({ demoAutoTradeEnabled: false });
  });

  it("shows ARMED — TEMPORARILY BLOCKED with exact gate blocker", async () => {
    status.config.demoAutoTradeEnabled = true;
    status.gates = {
      ok: false,
      blockers: ["WAIT — SPREAD TOO WIDE"],
      executionMode: "DEMO_ONLY",
      liveExecutionEnabled: false
    };
    renderAt("/gold-hunter");
    await waitFor(() =>
      expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent(
        "ARMED — TEMPORARILY BLOCKED"
      )
    );
    expect(screen.getByTestId("gh-demo-autotrade-card")).toHaveTextContent(
      "No new order right now: WAIT — SPREAD TOO WIDE"
    );
  });

  it("surfaces DAILY LOSS LIMIT before arming even when arming.ready=true", async () => {
    status.config.demoAutoTradeEnabled = false;
    status.arming = {
      ready: true,
      blockers: [],
      strategySelectorConnected: true
    };
    status.gates = {
      ok: false,
      blockers: [
        "WAIT — AUTOTRADE OFF",
        "WAIT — DAILY LOSS LIMIT",
        "WAIT — NO SETUP SELECTED"
      ],
      executionMode: "DEMO_ONLY",
      liveExecutionEnabled: false
    };
    status.market.marketStatus = "OPEN";
    renderAt("/gold-hunter");
    await waitFor(() =>
      expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent("READY TO ARM")
    );
    expect(screen.getByTestId("gh-demo-autotrade-hint")).toHaveTextContent(
      "BLOCKED — DAILY LOSS LIMIT"
    );
    expect(screen.getByTestId("gh-primary-wait")).toHaveTextContent("DAILY LOSS LIMIT");
    expect(screen.getByTestId("gh-demo-autotrade-hint")).not.toHaveTextContent("AUTOTRADE OFF");
  });

  it("shows IN DEMO TRADE when an open Gold Hunter position exists", async () => {
    status.config.demoAutoTradeEnabled = true;
    status.broker.openPositionCount = 1;
    status.broker.marginUsed = 120;
    status.openTrades = [
      {
        goldHunterTradeId: "GH-D-1",
        setup: "A",
        side: "BUY",
        status: "FILLED",
        netPnlEur: 0,
        entry: 2400,
        stop: 2399.45
      }
    ] as typeof status.openTrades;
    renderAt("/gold-hunter");
    await waitFor(() =>
      expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent("IN DEMO TRADE")
    );
  });

  it("shows RECONCILING DEMO CLOSE for CLOSE_REQUESTED without claiming active management", async () => {
    status.config.demoAutoTradeEnabled = true;
    status.broker.openPositionCount = 0;
    status.broker.marginUsed = 0;
    status.openTrades = [
      {
        goldHunterTradeId: "GH-D-5194a263",
        setup: "B",
        side: "BUY",
        status: "CLOSE_REQUESTED",
        netPnlEur: null,
        entry: 4415.27,
        stop: 4415.93
      }
    ] as typeof status.openTrades;
    renderAt("/gold-hunter");
    await waitFor(() =>
      expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent(
        "RECONCILING DEMO CLOSE"
      )
    );
    expect(screen.getByTestId("gh-demo-autotrade-hint")).not.toHaveTextContent(
      "active cTrader DEMO position and is managing it"
    );
  });

  it("shows CLOSE SETTLEMENT PENDING when broker is flat and local awaits deal P/L", async () => {
    status.config.demoAutoTradeEnabled = true;
    status.broker.openPositionCount = 0;
    status.openTrades = [
      {
        goldHunterTradeId: "GH-D-settle",
        setup: "A",
        side: "BUY",
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
        netPnlEur: null,
        entry: 2400,
        stop: 2399.45
      }
    ] as typeof status.openTrades;
    renderAt("/gold-hunter");
    await waitFor(() =>
      expect(screen.getByTestId("gh-demo-autotrade-state")).toHaveTextContent(
        "CLOSE SETTLEMENT PENDING"
      )
    );
  });

  it("does not call updateConfig when Start confirmation is cancelled", async () => {
    status.arming = {
      ready: true,
      blockers: [],
      strategySelectorConnected: true
    };
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAt("/gold-hunter");
    await waitFor(() => expect(screen.getByTestId("gh-dashboard-start-demo-auto")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("gh-dashboard-start-demo-auto"));
    expect(goldHunterUpdateConfig).not.toHaveBeenCalled();
  });

  it("renders control with arm confirmation flow", async () => {
    renderAt("/gold-hunter/control");
    await waitFor(() => expect(screen.getByTestId("gh-control")).toBeInTheDocument());
    expect(screen.getByTestId("gh-arm-open")).toBeInTheDocument();
  });

  it("renders monitor wait reasons", async () => {
    renderAt("/gold-hunter/monitor");
    await waitFor(() => expect(screen.getByTestId("gh-monitor")).toBeInTheDocument());
    expect(screen.getByTestId("gh-monitor-wait")).toHaveTextContent("AUTOTRADE OFF");
  });

  it("renders performance empty demo history", async () => {
    renderAt("/gold-hunter/performance");
    await waitFor(() => expect(screen.getByTestId("gh-performance")).toBeInTheDocument());
    expect(screen.getByTestId("gh-no-trades")).toBeInTheDocument();
  });
});
