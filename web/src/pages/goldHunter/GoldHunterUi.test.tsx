import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GoldHunterStatusResponse, GoldHunterTrade } from "../../lib/api";
import { GoldHunterTestPage } from "./GoldHunterTestPage";

const apiMocks = vi.hoisted(() => ({
  goldHunterStatus: vi.fn(),
  goldHunterTrades: vi.fn(),
  goldHunterUpdateConfig: vi.fn()
}));

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    account: { role: "OWNER", uid: "owner-1" },
    user: { uid: "owner-1" },
    api: apiMocks
  })
}));

function makeTrade(overrides: Partial<GoldHunterTrade> = {}): GoldHunterTrade {
  return {
    goldHunterTradeId: "GH-D-test-1",
    strategy: "GOLD_HUNTER",
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: "2026-08-21T13:46:59.000Z",
    orderTs: "2026-08-21T13:47:10.000Z",
    fillTs: "2026-08-21T13:47:11.000Z",
    closeTs: "2026-08-21T13:47:13.000Z",
    entry: 4590.26,
    exit: 4590.06,
    stop: 4589.7,
    entrySpread: 0.08,
    durationMs: 2000,
    mfe: 0.04,
    mae: 0.2,
    grossPnlEur: -1.54,
    netPnlEur: -2.08,
    result: "LOSS",
    exitReason: "FAILED_PULSE_EXIT",
    brokerOrderId: "order-1",
    brokerPositionId: "position-1",
    status: "CLOSED",
    ...overrides
  };
}

function makeStatus(): GoldHunterStatusResponse {
  return {
    product: "GOLD_HUNTER",
    executionMode: "DEMO_ONLY",
    liveExecutionEnabled: false,
    runtimeSha: "api-00131-fev",
    config: {
      allocatedCapitalEur: 500,
      riskPerTradePct: 1,
      dailyLossLimitPct: 5,
      maxOpenTrades: 1,
      demoAutoTradeEnabled: false,
      pauseNewEntries: false,
      emergencyStopActive: false,
      mode: "RESEARCH",
      updatedAt: "2026-08-21T13:47:37.000Z",
      updatedBy: "owner-1"
    },
    modeLabel: { primary: "DEMO AUTOTRADE", secondary: "CTRADER DEMO", tertiary: "CONNECTED" },
    market: {
      symbol: "XAUUSD", bid: 4589.14, ask: 4589.26, mid: 4589.2, spread: 0.12,
      marketStatus: "OPEN", freshness: "LIVE", ageMs: 609, feedState: "LIVE",
      updatedAt: "2026-08-21T13:39:40.280Z"
    },
    broker: {
      provider: "cTrader", connected: true, environment: "DEMO", authState: "AUTHORISED",
      authorised: true, accountMasked: "48…10", brokerName: "Pepperstone", balance: 49078.76,
      currency: "EUR", equity: 49078.76, marginUsed: 0, freeMargin: 49078.76,
      openPositionCount: 0, snapshotAgeMs: 10644, lastSyncAt: "2026-08-21T13:39:29.796Z",
      snapshotSource: "AUTHORITATIVE_DEMO", demoOrderSubmissionEnabled: true, validForRisk: true
    },
    capital: {
      allocatedEur: 500, committedEur: 0, availableEur: 500, todayPnlEur: -82.96,
      riskBudgetEur: 5, dailyLossBudgetEur: 25, committedKnown: true
    },
    health: { marketFeed: "LIVE", transport: "CONNECTED", depth: "VALID", strategy: "WAITING", risk: "NORMAL", autoTrade: "ACTIVE" },
    strategyVersions: {
      brainVersion: "GOLD_HUNTER_BRAIN_V6",
      brainRevision: "GH-B6-20260821-02",
      strategyVariant: "PULSE_GUARD_CONTINUATION",
      softwareRevision: "GH_BRAIN_V6_PULSE_GUARD_CONTINUATION_2026.08.21-02",
      softwareRevisionAt: "2026-08-21T21:50:00Z",
      positionManagerVersion: "SMART_POSITION_MANAGER_V1",
      lossControllerVersion: "SMART_LOSS_CONTROLLER_V1",
      rollingRealisedR: -0.4, rollingSampleCount: 3, lossCircuitBreakerActive: false,
      circuitBreakerReason: null, lossStreakGuardActive: false, consecutiveLosses: 1,
      unknownRealisedRLossCount: 0, rollingUnknownRTradeCount: 0, lastUnknownRTradeId: null,
      lastUnknownRReason: null, consecutiveUnknownRLosses: 0, unknownRGuardActive: false,
      entryIntegrityHealthy: true, entryIntegrityRecoveredAtMs: null,
      lastEntryIntegrityRecoveryReason: null, lastClosedTradeId: "GH-D-test-1",
      updatedAt: "2026-08-21T13:39:40.000Z",
      workerRevision: "goldmeta-quote-worker-00059-tzk",
      telemetrySource: "QUOTE_WORKER", telemetryAgeMs: 1000, reentryState: null, bReentryState: null
    },
    strategyPipeline: {
      connected: true, spot: "LIVE", depth: "VALID", selector: "CONNECTED", state: "EVALUATING",
      lastSelectedCandidate: null, lastObservationAt: "2026-08-21T13:39:40.280Z",
      normalizationVersion: "CTRADER_NORMALIZED_V1", protectionGeometryConnected: true
    },
    arming: { ready: true, blockers: [], strategySelectorConnected: true },
    gates: { ok: false, blockers: ["WAIT — NO SETUP SELECTED"], executionMode: "DEMO_ONLY", liveExecutionEnabled: false },
    openTrades: [],
    unmatchedDemoPositions: [],
    performanceToday: {
      netPnl: -82.96, trades: 19, wins: 1, losses: 18, winRate: 1 / 19,
      profitFactor: 0.01, avgWin: 1.23, avgLoss: -4.68, expectancy: -4.37, maxDrawdown: 82.96
    },
    audit: [],
    signal: {
      present: false, setup: null, side: null, signalId: null, quality: null,
      signalTimestamp: null, depthValidity: "DEPTH_VALID", consumed: false, ageMs: null,
      note: "WAIT — NO SETUP SELECTED"
    },
    execution: {
      autoTradeEnabled: false, lastOpportunityId: "GH-OPP-test", lastSignalId: "GH-OPP-test",
      lastSetup: "A", lastSide: "SELL", lastOpportunityStartedAt: "2026-08-20T22:15:03.341Z",
      lastAttemptAt: "2026-08-20T22:15:03.367Z", lastAttemptCompletedAt: "2026-08-20T22:15:03.367Z",
      state: "AUTOTRADE_OFF", blocker: "WAIT — AUTOTRADE OFF", detail: "demo_auto_trade_disabled",
      outcome: null, tradeId: null, brokerOrderIdMaskedOrSafe: null, brokerPositionIdMaskedOrSafe: null,
      attemptCountForOpportunity: 1, queue: { pending: 0, dropped: 0, completed: 31, maxPendingSeen: 1 }
    }
  };
}

let currentStatus: GoldHunterStatusResponse;
let currentTrades: GoldHunterTrade[];

async function renderConsole() {
  render(<GoldHunterTestPage />);
  await waitFor(() => expect(screen.getByTestId("gold-hunter-test-page")).toBeInTheDocument());
}

describe("Gold Hunter runtime test console", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentStatus = makeStatus();
    currentTrades = [makeTrade()];
    apiMocks.goldHunterStatus.mockImplementation(async () => currentStatus);
    apiMocks.goldHunterTrades.mockImplementation(async () => ({ trades: currentTrades, strategy: "GOLD_HUNTER", environment: "DEMO" }));
    apiMocks.goldHunterUpdateConfig.mockResolvedValue({ config: currentStatus.config, executionMode: "DEMO_ONLY", liveExecutionEnabled: false });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders the current R02 runtime identity without confusing it with the web build", async () => {
    await renderConsole();
    expect(screen.getByText("XAUUSD Demo AutoTrade")).toBeInTheDocument();
    expect(screen.getByText("4589.20")).toBeInTheDocument();
    expect(screen.getByText("V6")).toBeInTheDocument();
    expect(screen.getByText("GH-B6-20260821-02")).toBeInTheDocument();
    expect(screen.getByText("Pulse Guard Continuation")).toBeInTheDocument();
    expect(screen.getByText("api-00131-fev")).toBeInTheDocument();
    expect(screen.getByText("goldmeta-quote-worker-00059-tzk")).toBeInTheDocument();
    expect(screen.getByText("Presentation build only")).toBeInTheDocument();
  });

  it("shows Demo-only safety state and no Live enable control", async () => {
    await renderConsole();
    expect(screen.getByText("DEMO OFF")).toBeInTheDocument();
    expect(screen.getByText(/DEMO ONLY · LIVE LOCKED/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enable live/i })).not.toBeInTheDocument();
  });

  it("enables Demo only after confirmation and sends the required confirmation flag", async () => {
    await renderConsole();
    fireEvent.click(screen.getByRole("button", { name: "Enable Demo" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(apiMocks.goldHunterUpdateConfig).toHaveBeenCalledWith({ demoAutoTradeEnabled: true, confirmDemoAutoTrade: true }));
  });

  it("turns Demo off directly when Demo AutoTrade is active", async () => {
    currentStatus.config.demoAutoTradeEnabled = true;
    currentStatus.execution = { ...currentStatus.execution!, autoTradeEnabled: true, state: "WAITING_FOR_SIGNAL", blocker: "WAIT — NO SETUP SELECTED", detail: null };
    await renderConsole();
    expect(screen.getByText("DEMO ON")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn Demo OFF" }));
    await waitFor(() => expect(apiMocks.goldHunterUpdateConfig).toHaveBeenCalledWith({ demoAutoTradeEnabled: false }));
  });

  it("keeps pause and emergency-stop controls explicit and Demo-only", async () => {
    await renderConsole();
    fireEvent.click(screen.getByRole("button", { name: "Pause Entries" }));
    await waitFor(() => expect(apiMocks.goldHunterUpdateConfig).toHaveBeenCalledWith({ pauseNewEntries: true }));
    apiMocks.goldHunterUpdateConfig.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Emergency Stop" }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(apiMocks.goldHunterUpdateConfig).toHaveBeenCalledWith({ emergencyStopActive: true }));
  });

  it("shows the open trade separately from recent closed results", async () => {
    const open = makeTrade({ goldHunterTradeId: "GH-D-open", side: "SELL", entry: 4577.97, exit: null, closeTs: null, netPnlEur: null, grossPnlEur: null, result: "OPEN", exitReason: null, status: "FILLED" });
    currentStatus.openTrades = [open];
    currentTrades = [open, makeTrade()];
    await renderConsole();
    expect(screen.getByText("Trade in progress")).toBeInTheDocument();
    expect(screen.getAllByText("GH-D-open").length).toBeGreaterThan(0);
    expect(screen.getByText("GH-D-test-1 · Setup A")).toBeInTheDocument();
    expect(screen.getByText("FAILED_PULSE_EXIT")).toBeInTheDocument();
  });

  it("shows compact performance metrics needed for forward testing", async () => {
    await renderConsole();
    expect(screen.getByText("Today P/L").parentElement).toHaveTextContent("€-82.96");
    expect(screen.getByText("Trades").parentElement).toHaveTextContent("19");
    expect(screen.getByText("Wins / Losses").parentElement).toHaveTextContent("1 / 18");
    expect(screen.getByText("Avg loss").parentElement).toHaveTextContent("€-4.68");
  });

  it("uses selector depth for the health panel instead of the legacy health field", async () => {
    currentStatus.strategyPipeline!.depth = "VALID";
    currentStatus.health.depth = "CROSSED";
    await renderConsole();
    expect(screen.getByText("Depth").parentElement).toHaveTextContent("VALID");
    expect(screen.getByText("Depth").parentElement).not.toHaveTextContent("CROSSED");
  });
});
