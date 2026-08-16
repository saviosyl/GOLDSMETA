import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GoldHunterShell } from "./GoldHunterShell";
import { GoldHunterDashboardPage } from "./GoldHunterDashboardPage";
import { GoldHunterControlPage } from "./GoldHunterControlPage";
import { GoldHunterMonitorPage } from "./GoldHunterMonitorPage";
import { GoldHunterPerformancePage } from "./GoldHunterPerformancePage";

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
      goldHunterUpdateConfig: vi.fn(async () => ({
        config: status.config,
        executionMode: "DEMO_ONLY",
        liveExecutionEnabled: false
      })),
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
  });

  it("renders dashboard with allocation and market-closed wait", async () => {
    renderAt("/gold-hunter");
    await waitFor(() => expect(screen.getByTestId("gh-dashboard")).toBeInTheDocument());
    expect(screen.getByTestId("gh-allocation")).toHaveTextContent("5,000");
    expect(screen.getByTestId("gh-primary-wait")).toHaveTextContent("MARKET CLOSED");
    expect(screen.getByTestId("gh-demo-balance")).toHaveTextContent("50,000");
    expect(screen.getByTestId("gh-demo-equity")).toHaveTextContent("49,985");
    expect(screen.getByTestId("gh-account-refresh")).toBeInTheDocument();
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
