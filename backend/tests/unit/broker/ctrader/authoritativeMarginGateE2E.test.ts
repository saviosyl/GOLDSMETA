/**
 * ACTIVE_DEMO margin gate wiring — Aug 12 MARGIN_UNAVAILABLE regression.
 * Proves: deferred sizing + authoritative flat margin → exactly ONE submit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  submitDemoMarketOrder,
  appendEvaluation,
  clearArmedCandidate,
  saveArmedCandidate,
  getArmedCandidate,
  assertDemoAuthoritativeMarginGate,
  createAutoTradeJournalEntry
} = vi.hoisted(() => ({
  submitDemoMarketOrder: vi.fn(async () => ({
    accepted: true,
    orderId: "ord_margin_1",
    positionId: "pos_margin_1",
    executionType: "ORDER_FILLED",
    errorCode: null,
    clientOrderId: "c_m1",
    fillPrice: 4413.1,
    stopLoss: 4409.84,
    takeProfit: 4416.26,
    filledVolumeLots: 17
  })),
  appendEvaluation: vi.fn(async (row: Record<string, unknown>) => ({
    id: "ev",
    ...row
  })),
  clearArmedCandidate: vi.fn(async () => undefined),
  saveArmedCandidate: vi.fn(async (c: unknown) => c),
  getArmedCandidate: vi.fn(async () => null as unknown),
  assertDemoAuthoritativeMarginGate: vi.fn(),
  createAutoTradeJournalEntry: vi.fn(async () => undefined)
}));

vi.mock("../../../../src/services/broker/ctrader/demoOrderExecution", () => ({
  submitDemoMarketOrder
}));

vi.mock("../../../../src/services/broker/ctrader/evaluationLogStore", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/broker/ctrader/evaluationLogStore")
  >("../../../../src/services/broker/ctrader/evaluationLogStore");
  return { ...actual, appendEvaluation };
});

vi.mock("../../../../src/services/broker/ctrader/armedCandidateStore", () => ({
  clearArmedCandidate,
  getArmedCandidate,
  saveArmedCandidate
}));

vi.mock("../../../../src/services/broker/ctrader/demoMarginService", () => ({
  assertDemoAuthoritativeMarginGate
}));

const qualDoc = {
  uid: "u1",
  accountId: "48014710",
  accountMasked: "48…10",
  startedAt: "2026-08-08T00:00:00.000Z",
  state: "LIVE_QUALIFICATION",
  safetyChecks: [],
  previews: [],
  controlledTrades: [],
  demoAutoTrades: [],
  previewSignalIds: [],
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

vi.mock("../../../../src/services/broker/ctrader/qualificationStore", () => ({
  getQualificationDoc: vi.fn(async () => ({ ...qualDoc })),
  getActiveQualificationAccountId: vi.fn(async () => "48014710"),
  appendTransition: vi.fn(async (doc: unknown) => doc),
  saveQualificationDoc: vi.fn(async (doc: unknown) => doc),
  createEmptyQualificationDoc: vi.fn(),
  tryAddPreview: vi.fn(),
  recountControlled: vi.fn((d: unknown) => d),
  recountDemoAuto: vi.fn((d: unknown) => d),
  normalizeAccountId: (id: unknown) =>
    id == null ? null : String(id).trim() || null,
  findForeignStartedQualifications: vi.fn(async () => [])
}));

vi.mock("../../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn(async () => ({
    selectedAccountId: "48014710",
    selectedAccountIsLive: false,
    selectedAccountMasked: "48…10",
    oauthScope: "trading",
    brokerConfirmedPepperstone: true,
    symbolId: "41",
    symbolName: "XAUUSD",
    environment: "DEMO",
    leverage: 30,
    currency: "EUR",
    lastQuoteAt: new Date().toISOString()
  }))
}));

vi.mock("../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings: vi.fn(async () => ({
    uid: "u1",
    environment: "demo",
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
    newsImpactMode: "OFF",
    newsMinutesBefore: 15,
    newsMinutesAfter: 15,
    sizingMode: "automatic_risk",
    manualLotSize: 0.01,
    maxPositionExposureLots: null
  })),
  saveUserAutoTradeSettings: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/connectionService", () => ({
  buildDiagnostics: vi.fn(async () => ({
    pepperstoneConfirmed: true,
    selectedAccountIsLive: false,
    symbol: {
      symbolId: "41",
      symbolName: "XAUUSD",
      metadataComplete: true,
      minVolume: 1,
      volumeStep: 1,
      maxVolume: 5000,
      lotSize: 1,
      tickSize: 0.01
    },
    // Production gap: balance present, freeMargin absent on ProtoOATrader.
    account: {
      currency: "EUR",
      equity: 50000,
      balance: 50000,
      freeMargin: null,
      leverage: 30
    },
    connection: { symbolName: "XAUUSD", symbolId: "41" },
    quote: {
      bid: 4412.9,
      ask: 4413.05,
      spread: 0.15,
      stale: false,
      marketStatus: "OPEN",
      timestamp: new Date().toISOString()
    }
  })),
  ensureFreshAccessToken: vi.fn(async () => ({
    accessToken: "tok",
    connection: {
      selectedAccountId: "48014710",
      selectedAccountIsLive: false,
      symbolId: "41"
    }
  }))
}));

vi.mock("../../../../src/services/broker/ctrader/dailySafetyService", () => ({
  assertEntryAllowed: vi.fn(async () => ({ allowed: true, code: null, label: null })),
  markTradeOpened: vi.fn(),
  markTradeClosed: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/dailySafetyStore", () => ({
  getDailySafetyDoc: vi.fn(async () => ({
    uid: "u1",
    environment: "demo",
    tradingDay: "2026-08-12",
    tradesUsed: 0,
    openPositions: 0,
    realisedPnl: 0,
    peakDailyPnl: 0,
    consecutiveLosses: 0,
    countedTradeIds: []
  })),
  saveDailySafetyDoc: vi.fn(),
  tradingDayKey: vi.fn(() => "2026-08-12")
}));

vi.mock("../../../../src/services/broker/ctrader/newsGuard", () => ({
  evaluateNewsGuardAsync: vi.fn(async () => ({ active: false }))
}));

vi.mock("../../../../src/services/broker/ctrader/sessionGuard", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/broker/ctrader/sessionGuard")
  >("../../../../src/services/broker/ctrader/sessionGuard");
  return {
    ...actual,
    sessionAllowed: vi.fn(() => ({ ok: true, current: "London", reason: null }))
  };
});

vi.mock("../../../../src/services/broker/ctrader/quoteToDepositFx", () => ({
  resolveQuoteToDepositFx: vi.fn(async () => ({
    ok: true,
    rate: 0.9,
    source: "EURUSD_MID",
    quoteCurrency: "USD",
    depositCurrency: "EUR"
  }))
}));

vi.mock("../../../../src/services/broker/ctrader/autoTradeJournal", () => ({
  createAutoTradeJournalEntry,
  updateAutoTradeJournalOnClose: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/demoPositionLifecycle", () => ({
  createDemoPositionLifecycle: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/autoTradeNotifications", () => ({
  notifyAutoTradeEvent: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/openApiClient", () => ({
  createOpenApiClient: () => ({})
}));

import { createArmedCandidate } from "../../../../src/services/broker/ctrader/armedCandidate";
import { processDecisionForQualification } from "../../../../src/services/broker/ctrader/qualificationService";
import { isCTraderLiveEnabled, isBrokerExecutionEnabled } from "../../../../src/services/broker/ctrader/flags";

function decision(over: Record<string, unknown> = {}) {
  // Geometry sized for RR≥1.5 with stop 3.21 → TP1 at +6.42
  return {
    decisionId: "04313529b31fa1f0f2769f0b",
    decision: "BUY",
    setupScore: 100,
    confidence: 100,
    entry: { price: 4413.05 },
    stopLoss: { price: 4409.84 },
    takeProfits: [{ price: 4419.47 }, { price: 4422.68 }, { price: 4425.89 }],
    reasons: [
      "TREND_COMPONENTS",
      "TREND_BULLISH",
      "PRICE_ABOVE_POC",
      "ABOVE_VAH",
      "BREAKOUT_OR_RETEST",
      "CANDLE_BULLISH",
      "SESSION_REJECTION",
      "MTF_BULLISH_AGREE"
    ],
    marketStructure: {
      confirmationClassification: "BREAKOUT_CONFIRMED"
    },
    currentSession: "LONDON",
    ...over
  };
}

function freshArmed(signalId = "04313529b31fa1f0f2769f0b") {
  return createArmedCandidate({
    uid: "u1",
    direction: "BUY",
    signalId,
    planSourceKey: "OANDA:XAUUSD|LONDON|1786526100000|PLAN_15M",
    entry: 4413.05,
    stopLoss: 4409.84,
    takeProfit: 4419.47,
    takeProfit2: 4422.68,
    takeProfit3: 4425.89,
    confidence: 100,
    setupScore: 100,
    originalReasons: ["TREND_BULLISH"],
    invalidationPrice: 4409.84,
    nowIso: new Date().toISOString()
  });
}

describe("Aug 12 MARGIN_UNAVAILABLE → authoritative margin fix", () => {
  beforeEach(() => {
    submitDemoMarketOrder.mockClear();
    appendEvaluation.mockClear();
    assertDemoAuthoritativeMarginGate.mockReset();
    getArmedCandidate.mockReset();
    getArmedCandidate.mockResolvedValue(null);
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    process.env.DEMO_OPPORTUNITY_MODE = "ACTIVE_DEMO";
    process.env.CTRADER_CLIENT_ID = "test-client";
    process.env.CTRADER_CLIENT_SECRET = "test-secret";
    process.env.CTRADER_LIVE_ENABLED = "false";
  });

  it("flat broker + expected margin OK → exactly ONE submitDemoMarketOrder", async () => {
    assertDemoAuthoritativeMarginGate.mockResolvedValue({
      ok: true,
      freeMargin: 50_000,
      expectedMargin: 2_500,
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
      marginAgeMs: 12,
      marginCapturedAt: new Date().toISOString(),
      marginSource: "BROKER_FLAT",
      expectedMarginSource: "PROTO_OA_EXPECTED_MARGIN"
    });

    getArmedCandidate.mockResolvedValue(freshArmed());

    const store = {
      getDecision: vi.fn(async () => decision()),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY",
        validUntil: new Date(Date.now() + 3600_000).toISOString()
      }))
    };

    const result = await processDecisionForQualification({
      uid: "u1",
      decisionId: "04313529b31fa1f0f2769f0b",
      store: store as never
    });

    expect(result.handled).toBe(true);
    expect(assertDemoAuthoritativeMarginGate).toHaveBeenCalledTimes(1);
    const gateArgs = assertDemoAuthoritativeMarginGate.mock.calls[0]![0];
    expect(gateArgs.side).toBe("BUY");
    expect(gateArgs.protocolVolume).toBe(1700); // 17 lots — FINAL volume
    expect(gateArgs.symbolId).toBe("41");
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    const submitArgs = submitDemoMarketOrder.mock.calls[0]![0];
    expect(submitArgs.lots).toBe(17);
    // Final-volume contract: submit lots must match the ExpectedMargin volume.
    expect(submitArgs.lots * 100).toBe(gateArgs.protocolVolume);
    // Gate must run before submit (call order).
    const gateOrder = assertDemoAuthoritativeMarginGate.mock.invocationCallOrder[0]!;
    const submitOrder = submitDemoMarketOrder.mock.invocationCallOrder[0]!;
    expect(gateOrder).toBeLessThan(submitOrder);
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
  });

  it("expected margin too high → ZERO submit + RISK_SIZE_EXCEEDS_MARGIN", async () => {
    assertDemoAuthoritativeMarginGate.mockResolvedValue({
      ok: false,
      reason: "RISK_SIZE_EXCEEDS_MARGIN",
      notes: ["Expected margin 60000 > freeMargin 50000"],
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
      expectedMargin: 60_000,
      marginAgeMs: 5
    });

    getArmedCandidate.mockResolvedValue(freshArmed());

    await processDecisionForQualification({
      uid: "u1",
      decisionId: "04313529b31fa1f0f2769f0b",
      store: {
        getDecision: vi.fn(async () => decision()),
        getActiveSessionPlan: vi.fn(async () => ({
          lifecycleState: "ACTIVE",
          confirmationState: "BREAKOUT_CONFIRMED",
          direction: "BUY",
          validUntil: new Date(Date.now() + 3600_000).toISOString()
        }))
      } as never
    });

    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    const rejected = appendEvaluation.mock.calls
      .map((c) => c[0])
      .find((r) => r?.reasonCode === "RISK_SIZE_EXCEEDS_MARGIN");
    expect(rejected).toBeTruthy();
  });

  it("margin unavailable from gate → ZERO submit", async () => {
    assertDemoAuthoritativeMarginGate.mockResolvedValue({
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: ["reconcile failed"],
      marginSnapshot: null,
      expectedMargin: null,
      marginAgeMs: null
    });

    getArmedCandidate.mockResolvedValue(freshArmed());

    await processDecisionForQualification({
      uid: "u1",
      decisionId: "04313529b31fa1f0f2769f0b",
      store: {
        getDecision: vi.fn(async () => decision()),
        getActiveSessionPlan: vi.fn(async () => ({
          lifecycleState: "ACTIVE",
          confirmationState: "BREAKOUT_CONFIRMED",
          direction: "BUY",
          validUntil: new Date(Date.now() + 3600_000).toISOString()
        }))
      } as never
    });

    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });
});
