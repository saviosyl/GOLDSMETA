/**
 * FAST_AUTOTRADE_V1 → Demo execution integration.
 * Real processDecisionForQualification path. submitDemoMarketOrder mocked.
 * No real broker order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastAutoTradeDecision } from "../../../../../src/services/broker/ctrader/fastAutoTrade/types";
import { FAST_AUTOTRADE_STRATEGY_ID } from "../../../../../src/services/broker/ctrader/fastAutoTrade/types";

const {
  submitDemoMarketOrder,
  appendEvaluation,
  clearArmedCandidate,
  saveArmedCandidate,
  getArmedCandidate,
  calculatePepperstoneXauUsdDemoVolume,
  resolvePepperstoneXauUsdDemoMapping,
  createAutoTradeJournalEntry,
  createDemoPositionLifecycle,
  persistFastReentryEntry,
  evaluateFastAutoTrade,
  buildFastAutoTradeInput,
  listRecentEvaluations,
  assertDemoAuthoritativeMarginGate,
  calculateCTraderVolume,
  evaluateNewsGuardAsync,
  getConnection
} = vi.hoisted(() => ({
  submitDemoMarketOrder: vi.fn(async () => ({
    accepted: true,
    orderId: "ord_1",
    positionId: "pos_1",
    executionType: "ORDER_FILLED",
    errorCode: null,
    clientOrderId: "c1",
    fillPrice: 3400.1,
    stopLoss: 3390,
    takeProfit: 3415,
    filledVolumeLots: 0.05,
    ctidTraderAccountId: "48014710"
  })),
  appendEvaluation: vi.fn(async (row: Record<string, unknown>) => ({ id: "ev", ...row })),
  clearArmedCandidate: vi.fn(async () => undefined),
  saveArmedCandidate: vi.fn(async (c: unknown) => c),
  getArmedCandidate: vi.fn(async () => null as unknown),
  calculatePepperstoneXauUsdDemoVolume: vi.fn(() => ({
    ok: true,
    volumeLots: 0.05,
    rejectionReason: null,
    notes: ["test-mock"]
  })),
  resolvePepperstoneXauUsdDemoMapping: vi.fn(() => ({
    ozPerLot: 1,
    broker: "Pepperstone",
    symbol: "XAUUSD"
  })),
  createAutoTradeJournalEntry: vi.fn(async () => undefined),
  createDemoPositionLifecycle: vi.fn(async () => ({ id: "life_1" })),
  persistFastReentryEntry: vi.fn(async () => ({})),
  evaluateFastAutoTrade: vi.fn(),
  buildFastAutoTradeInput: vi.fn(),
  listRecentEvaluations: vi.fn(async () => []),
  assertDemoAuthoritativeMarginGate: vi.fn(async () => ({
    ok: true,
    freeMargin: 50_000,
    expectedMargin: 2500,
    marginSnapshot: {
      balance: 50_000,
      unrealisedNetPnl: 0,
      equity: 50_000,
      usedMargin: 0,
      freeMargin: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      source: "BROKER_FLAT",
      capturedAt: new Date().toISOString()
    },
    marginAgeMs: 10,
    marginCapturedAt: new Date().toISOString(),
    marginSource: "BROKER_FLAT",
    expectedMarginSource: "PROTO_OA_EXPECTED_MARGIN"
  })),
  calculateCTraderVolume: vi.fn(() => ({ ok: true, volume: 0.05 })),
  evaluateNewsGuardAsync: vi.fn(async () => ({ active: false })),
  getConnection: vi.fn()
}));

vi.mock("../../../../../src/services/broker/ctrader/demoOrderExecution", () => ({
  submitDemoMarketOrder
}));

vi.mock("../../../../../src/services/broker/ctrader/evaluationLogStore", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../src/services/broker/ctrader/evaluationLogStore")
  >("../../../../../src/services/broker/ctrader/evaluationLogStore");
  return { ...actual, appendEvaluation, listRecentEvaluations };
});

vi.mock("../../../../../src/services/broker/ctrader/armedCandidateStore", () => ({
  clearArmedCandidate,
  getArmedCandidate,
  saveArmedCandidate
}));

vi.mock("../../../../../src/services/broker/ctrader/fastAutoTrade/engine", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../src/services/broker/ctrader/fastAutoTrade/engine")
  >("../../../../../src/services/broker/ctrader/fastAutoTrade/engine");
  return { ...actual, evaluateFastAutoTrade };
});

vi.mock("../../../../../src/services/broker/ctrader/fastAutoTrade/qualificationInput", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../src/services/broker/ctrader/fastAutoTrade/qualificationInput")
  >("../../../../../src/services/broker/ctrader/fastAutoTrade/qualificationInput");
  return { ...actual, buildFastAutoTradeInput };
});

vi.mock("../../../../../src/services/broker/ctrader/fastAutoTrade/reentryStateStore", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../src/services/broker/ctrader/fastAutoTrade/reentryStateStore")
  >("../../../../../src/services/broker/ctrader/fastAutoTrade/reentryStateStore");
  return { ...actual, persistFastReentryEntry };
});

const qualDoc = {
  uid: "u1",
  accountId: "48014710",
  accountMasked: "48…10",
  startedAt: "2026-08-08T00:00:00.000Z",
  state: "LIVE_QUALIFICATION",
  safetyChecks: [],
  previews: [],
  controlledTrades: [],
  demoAutoTrades: [] as Array<{ signalId: string }>,
  previewSignalIds: [] as string[],
  previewCount: 20,
  controlledTradeCount: 5,
  controlledOpenCount: 0,
  controlledBlockedAttempts: 0,
  demoAutoTradeCount: 1,
  firstControlledDemoTradeAt: "2026-08-09T00:00:00.000Z",
  firstDemoAutoTradeAt: "2026-08-10T00:00:00.000Z",
  criticalSafetyFailures: 0,
  transitions: [],
  lastError: null,
  buildSha: null,
  updatedAt: "2026-08-11T00:00:00.000Z",
  pausedFrom: null,
  demoAutoEnabledAt: "2026-08-10T00:00:00.000Z"
};

vi.mock("../../../../../src/services/broker/ctrader/qualificationStore", () => ({
  getQualificationDoc: vi.fn(async () => ({ ...qualDoc, demoAutoTrades: [...qualDoc.demoAutoTrades] })),
  getActiveQualificationAccountId: vi.fn(async () => "48014710"),
  appendTransition: vi.fn(async (doc: unknown) => doc),
  saveQualificationDoc: vi.fn(async (doc: unknown) => doc),
  createEmptyQualificationDoc: vi.fn(),
  tryAddPreview: vi.fn(),
  recountControlled: vi.fn((d: unknown) => d),
  recountDemoAuto: vi.fn((d: unknown) => d),
  qualificationTradeKeysMatch: vi.fn(() => false),
  mergeQualificationOpenTrade: vi.fn((_a: unknown, b: unknown) => b),
  applyQualificationOpenTrade: vi.fn((doc: unknown) => doc),
  upsertQualificationOpenTrade: vi.fn(async () => null),
  incrementQualificationBlockedAttempts: vi.fn(async () => undefined),
  normalizeAccountId: (id: unknown) =>
    id == null ? null : String(id).trim() || null,
  findForeignStartedQualifications: vi.fn(async () => ({ ok: true, hits: [] }))
}));

const connectionState = {
  selectedAccountId: "48014710",
  selectedAccountIsLive: false,
  selectedAccountMasked: "48…10",
  oauthScope: "trading",
  brokerConfirmedPepperstone: true,
  symbolId: "41",
  symbolName: "XAUUSD",
  environment: "DEMO" as const,
  leverage: 100,
  lastQuoteAt: new Date().toISOString()
};

getConnection.mockResolvedValue({ ...connectionState });

vi.mock("../../../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection
}));

const settingsState = {
  autoTradeEnabledIntent: true,
  autoTradePaused: false,
  emergencyStopActive: false,
  selectedAccountId: "48014710",
  fixedRiskAmount: 50,
  maxDailyLoss: 250,
  maxTradesPerDay: 6,
  maxOpenPositions: 1,
  minConfidence: 80,
  minRiskReward: 1.5,
  maxSpread: 2,
  maxQuoteAgeSeconds: 30,
  allowedSessions: ["London", "NewYork", "Asia"],
  confirmationCandleRequired: true,
  newsFilterEnabled: false,
  newsImpactMode: "OFF" as const,
  newsMinutesBefore: 15,
  newsMinutesAfter: 15,
  sizingMode: "automatic_risk" as const,
  manualLotSize: 0.01,
  maxPositionExposureLots: null as number | null,
  demoProfitLockLadderEnabled: false
};

vi.mock("../../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings: vi.fn(async () => ({
    uid: "u1",
    environment: "demo",
    ...settingsState
  })),
  saveUserAutoTradeSettings: vi.fn()
}));

const quoteState = {
  bid: 3400,
  ask: 3400.1,
  spread: 0.1,
  stale: false,
  marketStatus: "OPEN",
  timestamp: new Date().toISOString()
};

vi.mock("../../../../../src/services/broker/ctrader/connectionService", () => ({
  buildDiagnostics: vi.fn(async () => ({
    pepperstoneConfirmed: true,
    selectedAccountIsLive: connectionState.selectedAccountIsLive,
    symbol: {
      symbolId: "41",
      symbolName: "XAUUSD",
      metadataComplete: true,
      minVolume: 0.01,
      volumeStep: 0.01,
      maxVolume: 50,
      lotSize: 1,
      tickSize: 0.01
    },
    account: {
      currency: "EUR",
      equity: 10000,
      balance: 10000,
      freeMargin: 9000,
      leverage: 100
    },
    connection: { symbolName: "XAUUSD" },
    quote: { ...quoteState }
  })),
  ensureFreshAccessToken: vi.fn(async () => ({
    accessToken: "tok",
    connection: { selectedAccountId: "48014710" }
  }))
}));

vi.mock("../../../../../src/services/broker/ctrader/dailySafetyService", () => ({
  assertEntryAllowed: vi.fn(async () => ({ allowed: true, code: null, label: null })),
  markTradeOpened: vi.fn(),
  markTradeClosed: vi.fn()
}));

vi.mock("../../../../../src/services/broker/ctrader/dailySafetyStore", () => ({
  getDailySafetyDoc: vi.fn(async () => ({
    uid: "u1",
    environment: "demo",
    tradingDay: "2026-08-16",
    tradesUsed: 0,
    openPositions: 0,
    realisedPnl: 0,
    peakDailyPnl: 0,
    consecutiveLosses: 0,
    countedTradeIds: []
  })),
  saveDailySafetyDoc: vi.fn(),
  tradingDayKey: vi.fn(() => "2026-08-16")
}));

vi.mock("../../../../../src/services/broker/ctrader/newsGuard", () => ({
  evaluateNewsGuardAsync
}));

vi.mock("../../../../../src/services/broker/ctrader/sessionGuard", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../src/services/broker/ctrader/sessionGuard")
  >("../../../../../src/services/broker/ctrader/sessionGuard");
  return {
    ...actual,
    currentSessionUtc: vi.fn(() => "London"),
    sessionAllowed: vi.fn(() => ({ ok: true, current: "London", reason: null }))
  };
});

vi.mock("../../../../../src/services/broker/ctrader/demoOpportunityEngine", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../src/services/broker/ctrader/demoOpportunityEngine")
  >("../../../../../src/services/broker/ctrader/demoOpportunityEngine");
  return {
    ...actual,
    resolveTradingSessionBucket: vi.fn(() => "London")
  };
});

vi.mock("../../../../../src/services/broker/ctrader/quoteToDepositFx", () => ({
  resolveQuoteToDepositFx: vi.fn(async () => ({
    ok: true,
    rate: 1,
    source: "same_currency",
    quoteCurrency: "USD",
    depositCurrency: "EUR"
  }))
}));

vi.mock("../../../../../src/services/broker/ctrader/demoXauUsdSizing", () => ({
  calculatePepperstoneXauUsdDemoVolume
}));

vi.mock("../../../../../src/services/broker/ctrader/demoMarginService", () => ({
  assertDemoAuthoritativeMarginGate
}));

vi.mock("../../../../../src/services/broker/ctrader/brokerUnitMappings", () => ({
  resolvePepperstoneXauUsdDemoMapping
}));

vi.mock("../../../../../src/services/broker/ctrader/sizing", () => ({
  calculateCTraderVolume
}));

vi.mock("../../../../../src/services/broker/ctrader/autoTradeJournal", () => ({
  createAutoTradeJournalEntry,
  updateAutoTradeJournalOnClose: vi.fn()
}));

vi.mock("../../../../../src/services/broker/ctrader/demoPositionLifecycle", () => ({
  createDemoPositionLifecycle
}));

vi.mock("../../../../../src/services/broker/ctrader/autoTradeNotifications", () => ({
  notifyAutoTradeEvent: vi.fn()
}));

vi.mock("../../../../../src/services/broker/ctrader/openApiClient", () => ({
  createOpenApiClient: () => ({})
}));

vi.mock("../../../../../src/services/broker/ctrader/quoteService", () => ({
  getExecutableQuoteForAutoTrade: vi.fn(async () => ({
    bid: quoteState.bid,
    ask: quoteState.ask,
    spread: quoteState.spread,
    timestamp: quoteState.timestamp,
    stale: quoteState.stale,
    marketStatus: quoteState.marketStatus,
    executable: true,
    freshness: "LIVE"
  }))
}));

import { createArmedCandidate } from "../../../../../src/services/broker/ctrader/armedCandidate";
import { setFastReconcileForTests } from "../../../../../src/services/broker/ctrader/fastAutoTrade/pendingFillReconcile";
import { processDecisionForQualification } from "../../../../../src/services/broker/ctrader/qualificationService";
import { getQualificationDoc } from "../../../../../src/services/broker/ctrader/qualificationStore";
import { assertEntryAllowed } from "../../../../../src/services/broker/ctrader/dailySafetyService";
import { resolveTradingSessionBucket } from "../../../../../src/services/broker/ctrader/demoOpportunityEngine";

function decision(over: Record<string, unknown> = {}) {
  return {
    decisionId: "dec_context",
    decision: "WAIT",
    setupScore: 61,
    confidence: 61,
    entry: { price: 3390 },
    stopLoss: { price: 3380 },
    takeProfits: [{ price: 3405 }],
    reasons: ["TREND_AGREEMENT"],
    marketStructure: {
      confirmationClassification: "NONE"
    },
    ...over
  };
}

function fastBuy(score: number, over: Partial<FastAutoTradeDecision> = {}): FastAutoTradeDecision {
  const grade = score >= 88 ? "A+" : score >= 78 ? "A" : score >= 70 ? "B+" : "BELOW";
  return {
    strategyId: FAST_AUTOTRADE_STRATEGY_ID,
    action: "BUY",
    regime: score >= 78 ? "NORMAL" : "FAST",
    bias: "BULLISH",
    setupType: "BREAKOUT",
    trigger: "BREAK_HOLD",
    qualityScore: score,
    grade,
    waitReason: null,
    hardVeto: null,
    accepted: ["setup", "trigger", "quality"],
    rejected: [],
    missing: [],
    supporting: ["momentum"],
    identity: {
      direction: "BUY",
      setupType: "BREAKOUT",
      structureAnchor: "res:3398",
      triggerCandle: "2026-08-16T22:09:00.000Z",
      timestamp: "2026-08-16T22:10:00.000Z"
    },
    geometry: {
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      takeProfit2: null,
      riskReward: 1.5
    },
    lifecycleState: "ENTRY_PENDING",
    signalId: `fast_BUY_${score}_brk`,
    telemetry: {
      direction: "BUY",
      setupType: "BREAKOUT",
      score,
      grade,
      regime: score >= 78 ? "NORMAL" : "FAST",
      price: 3400,
      timestamp: "2026-08-16T22:10:00.000Z",
      rejectionReason: null,
      supportingEvidence: [],
      missingEvidence: [],
      hardVeto: null,
      tradeSpaceOk: true,
      extended: false,
      extensionAnchorType: "BROKEN_RESISTANCE",
      extensionAnchorPrice: 3398,
      extensionDistance: 2,
      extensionAtr: 1.2,
      extensionAtrSource: "M1_ATR14",
      extensionDistanceAtr: 1.67,
      extensionLimitAtr: 2.2
    },
    tradeSpaceOk: true,
    extended: false,
    extension: {
      extensionAnchorType: "BROKEN_RESISTANCE",
      extensionAnchorPrice: 3398,
      extensionDistance: 2,
      extensionAtr: 1.2,
      extensionAtrSource: "M1_ATR14",
      extensionDistanceAtr: 1.67,
      extensionLimitAtr: 2.2
    },
    ...over
  };
}

function fastWait(reason: FastAutoTradeDecision["waitReason"]): FastAutoTradeDecision {
  return {
    ...fastBuy(66),
    action: "WAIT",
    qualityScore: 66,
    grade: "BELOW",
    waitReason: reason,
    signalId: null,
    geometry: null,
    identity: null
  };
}

function storeFor(d: Record<string, unknown>) {
  return {
    getDecision: vi.fn(async () => d),
    getActiveSessionPlan: vi.fn(async () => ({
      lifecycleState: "ACTIVE",
      confirmationState: "BREAKOUT_CONFIRMED",
      direction: "BUY",
      validUntil: new Date(Date.now() + 3600_000).toISOString()
    }))
  };
}

async function runQual(d: Record<string, unknown> = decision()) {
  return processDecisionForQualification({
    uid: "u1",
    decisionId: String(d.decisionId ?? "dec_context"),
    store: storeFor(d) as never
  });
}

describe("FAST_AUTOTRADE_V1 execution integration", () => {
  beforeEach(async () => {
    const { resetFastExecutionClaimsForTests } = await import(
      "../../../../../src/services/broker/ctrader/fastAutoTrade/executionClaimStore"
    );
    await resetFastExecutionClaimsForTests();
    setFastReconcileForTests(null);
    submitDemoMarketOrder.mockClear();
    submitDemoMarketOrder.mockResolvedValue({
      accepted: true,
      orderId: "ord_1",
      positionId: "pos_1",
      executionType: "ORDER_FILLED",
      errorCode: null,
      clientOrderId: "c1",
      fillPrice: 3400.1,
      stopLoss: 3390,
      takeProfit: 3415,
      filledVolumeLots: 0.05,
      ctidTraderAccountId: "48014710"
    });
    appendEvaluation.mockClear();
    clearArmedCandidate.mockClear();
    saveArmedCandidate.mockClear();
    persistFastReentryEntry.mockClear();
    createDemoPositionLifecycle.mockClear();
    createAutoTradeJournalEntry.mockClear();
    getArmedCandidate.mockReset();
    getArmedCandidate.mockResolvedValue(null);
    evaluateNewsGuardAsync.mockResolvedValue({ active: false });
    assertDemoAuthoritativeMarginGate.mockResolvedValue({
      ok: true,
      freeMargin: 50_000,
      expectedMargin: 2500,
      marginSnapshot: {
        balance: 50_000,
        unrealisedNetPnl: 0,
        equity: 50_000,
        usedMargin: 0,
        freeMargin: 50_000,
        moneyDigits: 2,
        leverage: 30,
        openPositionCount: 0,
        source: "BROKER_FLAT",
        capturedAt: new Date().toISOString()
      },
      marginAgeMs: 10,
      marginCapturedAt: new Date().toISOString(),
      marginSource: "BROKER_FLAT",
      expectedMarginSource: "PROTO_OA_EXPECTED_MARGIN"
    } as never);
    calculatePepperstoneXauUsdDemoVolume.mockReturnValue({
      ok: true,
      volumeLots: 0.05,
      rejectionReason: null,
      notes: ["test-mock"]
    });
    calculateCTraderVolume.mockReturnValue({ ok: true, volume: 0.05 });
    vi.mocked(assertEntryAllowed).mockResolvedValue({
      allowed: true,
      code: null,
      label: null
    } as never);
    connectionState.selectedAccountIsLive = false;
    connectionState.oauthScope = "trading";
    connectionState.environment = "DEMO";
    getConnection.mockResolvedValue({ ...connectionState });
    settingsState.autoTradeEnabledIntent = true;
    settingsState.autoTradePaused = false;
    settingsState.emergencyStopActive = false;
    settingsState.demoProfitLockLadderEnabled = true;
    quoteState.stale = false;
    quoteState.marketStatus = "OPEN";
    quoteState.spread = 0.1;
    quoteState.bid = 3400;
    quoteState.ask = 3400.1;
    quoteState.timestamp = new Date().toISOString();
    qualDoc.demoAutoTrades = [];
    qualDoc.previewSignalIds = [];
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    process.env.FAST_AUTOTRADE_V1_ENABLED = "true";
    process.env.DEMO_OPPORTUNITY_MODE = "FAST_AUTOTRADE_V1";
    process.env.DEMO_OVERNIGHT_MODE = "false";
    process.env.CTRADER_CLIENT_ID = "test-client";
    process.env.CTRADER_CLIENT_SECRET = "test-secret";
    process.env.CTRADER_LIVE_ENABLED = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
    buildFastAutoTradeInput.mockResolvedValue({
      nowMs: Date.now(),
      m1Availability: "OK",
      m1CompletedAtMs: Date.now() - 30_000,
      spread: 0.1,
      quoteAgeSeconds: 1
    });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    vi.mocked(resolveTradingSessionBucket).mockReturnValue("London");
  });

  afterEach(() => {
    setFastReconcileForTests(null);
    vi.useRealTimers();
    delete process.env.FAST_AUTOTRADE_V1_ENABLED;
    process.env.DEMO_OPPORTUNITY_MODE = "ACTIVE_DEMO";
    delete process.env.DEMO_OVERNIGHT_MODE;
  });

  async function expectOneBuy(score: number, extra?: Partial<FastAutoTradeDecision>) {
    evaluateFastAutoTrade.mockReturnValue(fastBuy(score, extra));
    const result = await runQual();
    expect(result, JSON.stringify(result)).toMatchObject({ handled: true });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    const arg = submitDemoMarketOrder.mock.calls[0][0];
    expect(arg.side).toBe("BUY");
    expect(arg.stopLoss).toBe(3400 - 10);
    expect(arg.takeProfit).toBe(3415);
    expect(arg.strategyId).toBe(FAST_AUTOTRADE_STRATEGY_ID);
    return result;
  }

  it("1 FAST regime score 70 B+ → exactly ONE submit", async () => {
    await expectOneBuy(70);
  });

  it("2 FAST score 74 B+ → exactly ONE submit", async () => {
    await expectOneBuy(74);
  });

  it("3 FAST score 77 B+ → exactly ONE submit", async () => {
    await expectOneBuy(77);
  });

  it("4 FAST/NORMAL score 78 → exactly ONE submit", async () => {
    await expectOneBuy(78, { regime: "NORMAL" });
  });

  it("5 score 79 → exactly ONE submit (old >=80 gate gone)", async () => {
    await expectOneBuy(79, { regime: "NORMAL" });
  });

  it("6 FAST score 80–87 → ONE submit, no 5M confirmation", async () => {
    await expectOneBuy(84);
    expect(saveArmedCandidate).not.toHaveBeenCalled();
  });

  it("7 FAST A+ score 88 → exactly ONE submit", async () => {
    await expectOneBuy(88);
  });

  it("8 FAST A+ score 89 → exactly ONE submit (old >=90 gone)", async () => {
    await expectOneBuy(89);
  });

  it("9 DecisionRecord WAIT + FAST BUY → ONE BUY with FAST geometry/signalId", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual(decision({ decision: "WAIT", decisionId: "dec_wait" }));
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    const arg = submitDemoMarketOrder.mock.calls[0][0];
    expect(arg.side).toBe("BUY");
    expect(arg.stopLoss).toBe(3390);
    expect(arg.takeProfit).toBe(3415);
    const submitted = appendEvaluation.mock.calls.find(
      (c) => c[0].reasonCode === "BROKER_SUBMITTED"
    );
    expect(submitted?.[0].signalId).toBe("fast_BUY_74_brk");
    expect(submitted?.[0].confidence).toBe(74);
  });

  it("10 DecisionRecord SELL + FAST BUY → ONE BUY, zero SELL", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual(
      decision({
        decision: "SELL",
        decisionId: "dec_sell",
        entry: { price: 3400 },
        stopLoss: { price: 3410 },
        takeProfits: [{ price: 3380 }]
      })
    );
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    expect(submitDemoMarketOrder.mock.calls[0][0].side).toBe("BUY");
    expect(submitDemoMarketOrder.mock.calls[0][0].stopLoss).toBe(3390);
  });

  it("11 DecisionRecord BUY + FAST WAIT → ZERO submissions", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastWait("WAIT_LOW_QUALITY"));
    await runQual(
      decision({
        decision: "BUY",
        setupScore: 94,
        confidence: 94,
        entry: { price: 3400 },
        stopLoss: { price: 3390 },
        takeProfits: [{ price: 3415 }]
      })
    );
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(
      appendEvaluation.mock.calls.some((c) => c[0].reasonCode === "WAIT_LOW_QUALITY")
    ).toBe(true);
  });

  it("12 legacy ArmedCandidate + FAST WAIT → ZERO submit and candidate cleared", async () => {
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "SELL",
      signalId: "legacy_armed_sell",
      planSourceKey: "plan_1",
      entry: 3400,
      stopLoss: 3410,
      takeProfit: 3385,
      confidence: 94,
      setupScore: 94,
      nowIso: new Date().toISOString()
    });
    getArmedCandidate.mockResolvedValue(armed);
    evaluateFastAutoTrade.mockReturnValue(fastWait("WAIT_NO_SETUP"));
    await runQual(decision({ decision: "WAIT" }));
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(clearArmedCandidate).toHaveBeenCalled();
    expect(
      appendEvaluation.mock.calls.some(
        (c) => c[0].reasonCode === "FAST_STRATEGY_REPLACED_LEGACY_ARMED"
      )
    ).toBe(true);
  });

  it("13 legacy ArmedCandidate + FAST BUY → only FAST BUY submits", async () => {
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "SELL",
      signalId: "legacy_armed_sell",
      planSourceKey: "plan_1",
      entry: 3400,
      stopLoss: 3410,
      takeProfit: 3385,
      confidence: 94,
      setupScore: 94,
      nowIso: new Date().toISOString()
    });
    getArmedCandidate.mockResolvedValue(armed);
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    expect(submitDemoMarketOrder.mock.calls[0][0].side).toBe("BUY");
    expect(clearArmedCandidate).toHaveBeenCalled();
  });

  it("14 duplicate FAST signal → at most ONE submission", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    vi.mocked(getQualificationDoc).mockResolvedValueOnce({
      ...qualDoc,
      demoAutoTrades: [{ signalId: "fast_BUY_74_brk" }]
    } as never);
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
  });

  it("15 stale M1 → ZERO submit", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastWait("WAIT_M1_STALE"));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(
      appendEvaluation.mock.calls.some((c) => c[0].reasonCode === "WAIT_M1_STALE")
    ).toBe(true);
  });

  it("16 post-gap <5 TRs → WAIT_EXTENSION_VOLATILITY_UNAVAILABLE, ZERO submit", async () => {
    evaluateFastAutoTrade.mockReturnValue(
      fastWait("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE")
    );
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(
      appendEvaluation.mock.calls.some(
        (c) => c[0].reasonCode === "WAIT_EXTENSION_VOLATILITY_UNAVAILABLE"
      )
    ).toBe(true);
  });

  it("17 extended >2.2 ATR → ZERO submit", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastWait("WAIT_EXTENDED"));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("18 tradeSpaceOk=false → ZERO submit", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastWait("WAIT_NO_TRADE_SPACE"));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("19 low momentum → ZERO submit", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastWait("WAIT_LOW_MOMENTUM"));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("20 execution quote stale → ZERO submit", async () => {
    quoteState.stale = true;
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("21 spread too high → ZERO submit", async () => {
    quoteState.spread = 9;
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("22 market CLOSED → ZERO submit", async () => {
    quoteState.marketStatus = "CLOSED";
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("23 news guard active → ZERO submit", async () => {
    evaluateNewsGuardAsync.mockResolvedValue({ active: true });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("24 Demo Auto intent OFF → ZERO submit", async () => {
    settingsState.autoTradeEnabledIntent = false;
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("25 paused → ZERO submit", async () => {
    settingsState.autoTradePaused = true;
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("26 emergency stop → ZERO submit", async () => {
    settingsState.emergencyStopActive = true;
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("27 OAuth scope != trading → ZERO submit", async () => {
    connectionState.oauthScope = "accounts";
    getConnection.mockResolvedValue({ ...connectionState });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("28 selected account LIVE → ZERO submit + FAST_AUTOTRADE_V1_DEMO_ONLY", async () => {
    connectionState.selectedAccountIsLive = true;
    getConnection.mockResolvedValue({ ...connectionState });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    const result = await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(result.message).toBe("FAST_AUTOTRADE_V1_DEMO_ONLY");
    expect(
      appendEvaluation.mock.calls.some(
        (c) => c[0].reasonCode === "FAST_AUTOTRADE_V1_DEMO_ONLY"
      )
    ).toBe(true);
  });

  it("29 Demo submission flag OFF → ZERO submit", async () => {
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "false";
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("30 authoritative margin failure → ZERO submit", async () => {
    assertDemoAuthoritativeMarginGate.mockResolvedValue({
      ok: false,
      code: "MARGIN_INSUFFICIENT"
    } as never);
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("31 sizing failure → ZERO submit", async () => {
    calculatePepperstoneXauUsdDemoVolume.mockReturnValue({
      ok: false,
      volumeLots: null,
      rejectionReason: "SIZING_FAILED",
      notes: []
    });
    calculateCTraderVolume.mockReturnValue({ ok: false, volume: null });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("32 broker accepted=false → ZERO trade record + BROKER_REJECTED", async () => {
    submitDemoMarketOrder.mockResolvedValue({
      accepted: false,
      orderId: null,
      positionId: null,
      executionType: null,
      errorCode: "NOT_ENOUGH_MONEY",
      clientOrderId: "c1",
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: null
    });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(createDemoPositionLifecycle).not.toHaveBeenCalled();
    const rejected = appendEvaluation.mock.calls.find(
      (c) => c[0].reasonCode === "BROKER_REJECTED"
    );
    expect(rejected).toBeTruthy();
    expect(rejected?.[0].pipeline?.brokerSubmissionAttempted).toBe(true);
    expect(rejected?.[0].pipeline?.brokerErrorCode).toBe("NOT_ENOUGH_MONEY");
    expect(rejected?.[0].signalId).toBe("fast_BUY_74_brk");
    expect(rejected?.[0].direction).toBe("BUY");
    expect(rejected?.[0].entry).toBe(3400);
    expect(rejected?.[0].stopLoss).toBe(3390);
    expect(rejected?.[0].takeProfit).toBe(3415);
    expect(rejected?.[0].confidence).toBe(74);
  });

  it("33 broker submission throws → ZERO trade record + BROKER_SUBMIT_ERROR", async () => {
    submitDemoMarketOrder.mockRejectedValue(
      new Error("access_token=SECRET refresh_token=SECRET2 TRANSPORT")
    );
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(createDemoPositionLifecycle).not.toHaveBeenCalled();
    const err = appendEvaluation.mock.calls.find(
      (c) => c[0].reasonCode === "BROKER_SUBMIT_ERROR"
    );
    expect(err).toBeTruthy();
    expect(JSON.stringify(err?.[0])).not.toMatch(/access_token=SECRET|refresh_token=SECRET2/);
    expect(err?.[0].pipeline?.brokerSubmissionAttempted).toBe(true);
  });

  it("34 successful FAST submission persists BROKER_SUBMITTED + re-entry + lifecycle", async () => {
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    expect(
      appendEvaluation.mock.calls.some((c) => c[0].reasonCode === "BROKER_SUBMITTED")
    ).toBe(true);
    expect(persistFastReentryEntry).toHaveBeenCalled();
    expect(createDemoPositionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ strategyId: FAST_AUTOTRADE_STRATEGY_ID })
    );
  });

  it("Sunday 23:10 Ireland FAST B+ 74 → exactly ONE mocked submit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T22:10:00.000Z"));
    quoteState.timestamp = "2026-08-16T22:09:50.000Z";
    vi.mocked(resolveTradingSessionBucket).mockReturnValue("Asia");
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74, { regime: "FAST" }));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    expect(saveArmedCandidate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("Sunday reopen <5 TRs → WAIT_EXTENSION_VOLATILITY_UNAVAILABLE, ZERO submit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T22:10:00.000Z"));
    evaluateFastAutoTrade.mockReturnValue(
      fastWait("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE")
    );
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    vi.useRealTimers();
  });

  it("PROFIT_LOCK_V1 does not reject FAST single-TP geometry", async () => {
    settingsState.demoProfitLockLadderEnabled = true;
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual(decision({ takeProfits: [{ price: 3415 }] }));
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
  });

  it("4. ORDER_ACCEPTED with no position → NO local OPEN trade", async () => {
    submitDemoMarketOrder.mockResolvedValue({
      accepted: false,
      outcome: "BROKER_ACCEPTED",
      orderId: "o_acc",
      positionId: null,
      executionType: "ORDER_ACCEPTED",
      errorCode: null,
      clientOrderId: "c_acc",
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: "48014710",
      requestSent: true,
      newOrderReqCount: 1
    });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    const result = await runQual();
    expect(result.message).toBe("order_accepted_pending_fill");
    expect(createDemoPositionLifecycle).not.toHaveBeenCalled();
    expect(
      appendEvaluation.mock.calls.some((c) => c[0].reasonCode === "BROKER_SUBMITTED")
    ).toBe(false);
    expect(
      appendEvaluation.mock.calls.some(
        (c) => c[0].reasonCode === "BROKER_ACCEPTED_PENDING_FILL"
      )
    ).toBe(true);
  });

  it("5. ORDER_ACCEPTED then ORDER_FILLED evidence → one OPEN trade", async () => {
    submitDemoMarketOrder.mockResolvedValue({
      accepted: true,
      outcome: "BROKER_FILLED",
      orderId: "o_fill",
      positionId: "p_fill",
      executionType: "ORDER_FILLED",
      errorCode: null,
      clientOrderId: "c_fill",
      fillPrice: 3400.2,
      stopLoss: 3390,
      takeProfit: 3415,
      filledVolumeLots: 0.05,
      ctidTraderAccountId: "48014710",
      requestSent: true,
      newOrderReqCount: 1
    });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(createDemoPositionLifecycle).toHaveBeenCalledTimes(1);
    expect(
      appendEvaluation.mock.calls.some((c) => c[0].reasonCode === "BROKER_SUBMITTED")
    ).toBe(true);
  });

  it("6. ORDER_ACCEPTED then reconcile finds clientOrderId + position → one OPEN trade", async () => {
    submitDemoMarketOrder.mockResolvedValue({
      accepted: false,
      outcome: "BROKER_ACCEPTED",
      orderId: "o_rec",
      positionId: null,
      executionType: "ORDER_ACCEPTED",
      errorCode: null,
      clientOrderId: "c_rec",
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: "48014710",
      requestSent: true,
      newOrderReqCount: 1
    });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(createDemoPositionLifecycle).not.toHaveBeenCalled();
    setFastReconcileForTests(async () => ({
      matched: true,
      by: "ORDER_CLIENT_ORDER_ID",
      orderId: "o_rec",
      positionId: "p_rec",
      clientOrderId: "c_rec"
    }));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    expect(createDemoPositionLifecycle).toHaveBeenCalledTimes(1);
    setFastReconcileForTests(null);
  });

  it("7. ORDER_ACCEPTED no fill → pending fill, second pass sends zero NewOrder", async () => {
    submitDemoMarketOrder.mockResolvedValue({
      accepted: false,
      outcome: "BROKER_ACCEPTED",
      orderId: "o_pend",
      positionId: null,
      executionType: "ORDER_ACCEPTED",
      errorCode: null,
      clientOrderId: "c_pend",
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: "48014710",
      requestSent: true,
      newOrderReqCount: 1
    });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    expect(createDemoPositionLifecycle).not.toHaveBeenCalled();
  });

  it("production stale BUY past TP → zero NewOrderReq and BLOCK_ENTRY_TARGET_ALREADY_PASSED", async () => {
    quoteState.bid = 4398.0;
    quoteState.ask = 4398.08;
    evaluateFastAutoTrade.mockReturnValue(
      fastBuy(81, {
        regime: "NORMAL",
        geometry: {
          entry: 4396.35,
          stopLoss: 4395.88,
          takeProfit: 4397.98,
          takeProfit2: null,
          riskReward: 3.47
        },
        signalId:
          "fast_BUY_BREAKOUT_BREAKOUT:BULLISH:4393_2_1:4396_37:4397_17:4395_97:4396"
      })
    );
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(createDemoPositionLifecycle).not.toHaveBeenCalled();
    expect(createAutoTradeJournalEntry).not.toHaveBeenCalled();
    const blocked = appendEvaluation.mock.calls.find(
      (c) => c[0].reasonCode === "BLOCK_ENTRY_TARGET_ALREADY_PASSED"
    );
    expect(blocked).toBeTruthy();
    expect(blocked?.[0].entryGeometry?.freshExecutionPrice).toBe(4398.08);
    quoteState.bid = 3400;
    quoteState.ask = 3400.1;
  });

  it("valid geometry persists broker fill/lots and a unique clientOrderId", async () => {
    quoteState.bid = 4396.3;
    quoteState.ask = 4396.4;
    submitDemoMarketOrder.mockResolvedValue({
      accepted: true,
      outcome: "BROKER_FILLED",
      orderId: "70265866",
      positionId: "54335877",
      executionType: "ORDER_FILLED",
      errorCode: null,
      clientOrderId: "will-be-replaced",
      fillPrice: 4396.41,
      stopLoss: 4395.94,
      takeProfit: 4398.04,
      filledVolumeLots: 92,
      ctidTraderAccountId: "48014710",
      requestSent: true,
      newOrderReqCount: 1
    });
    evaluateFastAutoTrade.mockReturnValue(
      fastBuy(81, {
        regime: "NORMAL",
        geometry: {
          entry: 4396.35,
          stopLoss: 4395.88,
          takeProfit: 4397.98,
          takeProfit2: null,
          riskReward: 3.47
        },
        signalId:
          "fast_BUY_BREAKOUT_valid_geom:BULLISH:4393_2_1:4396_37"
      })
    );
    await runQual();
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    const sentId = submitDemoMarketOrder.mock.calls[0][0].clientOrderId;
    expect(sentId).toMatch(/^fa_/);
    expect(sentId).not.toBe("fa_fast_BUY_BREAKOUT_BREAKOUTBULLISH4393_2_");
    expect(createDemoPositionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: 4396.41,
        lots: 92,
        brokerPositionId: "54335877"
      })
    );
    expect(createAutoTradeJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: 4396.41,
        lots: 92
      })
    );
    quoteState.bid = 3400;
    quoteState.ask = 3400.1;
  });

  it("ORDER_FILLED with proto-zero fill does not persist entry/lots as 0", async () => {
    submitDemoMarketOrder.mockResolvedValue({
      accepted: true,
      outcome: "BROKER_FILLED",
      orderId: "70265866",
      positionId: "54335877",
      executionType: "ORDER_FILLED",
      errorCode: null,
      clientOrderId: "c_zero",
      fillPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      filledVolumeLots: 0,
      ctidTraderAccountId: "48014710",
      requestSent: true,
      newOrderReqCount: 1
    });
    evaluateFastAutoTrade.mockReturnValue(fastBuy(74));
    await runQual();
    expect(createDemoPositionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: null,
        lots: null,
        brokerPositionId: "54335877"
      })
    );
    expect(createAutoTradeJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: null,
        lots: null
      })
    );
  });
});
