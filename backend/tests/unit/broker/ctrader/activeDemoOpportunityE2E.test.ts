/**
 * ACTIVE_DEMO opportunity engine — processDecisionForQualification
 * submitDemoMarketOrder call-count regressions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitDemoMarketOrder, appendEvaluation, clearArmedCandidate, saveArmedCandidate, getArmedCandidate } =
  vi.hoisted(() => ({
    submitDemoMarketOrder: vi.fn(async () => ({
      accepted: true,
      orderId: "ord_1",
      positionId: "pos_1",
      executionType: "ORDER_FILLED",
      errorCode: null,
      clientOrderId: "c1"
    })),
    appendEvaluation: vi.fn(async (row: Record<string, unknown>) => ({ id: "ev", ...row })),
    clearArmedCandidate: vi.fn(async () => undefined),
    saveArmedCandidate: vi.fn(async (c: unknown) => c),
    getArmedCandidate: vi.fn(async () => null as unknown)
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
  recountDemoAuto: vi.fn((d: unknown) => d)
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
    leverage: 100,
    lastQuoteAt: new Date().toISOString()
  }))
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
  maxPositionExposureLots: null as number | null
};

vi.mock("../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings: vi.fn(async () => ({
    uid: "u1",
    environment: "demo",
    ...settingsState
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
    quote: {
      bid: 3400,
      ask: 3400.1,
      spread: 0.1,
      stale: false,
      marketStatus: "OPEN",
      timestamp: new Date().toISOString()
    }
  })),
  ensureFreshAccessToken: vi.fn(async () => ({
    accessToken: "tok",
    connection: { selectedAccountId: "48014710" }
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
    rate: 1,
    source: "same_currency",
    quoteCurrency: "USD",
    depositCurrency: "EUR"
  }))
}));

vi.mock("../../../../src/services/broker/ctrader/demoXauUsdSizing", () => ({
  calculatePepperstoneXauUsdDemoVolume: () => ({
    ok: true,
    volumeLots: 0.05,
    rejectionReason: null,
    notes: ["test-mock"]
  })
}));

vi.mock("../../../../src/services/broker/ctrader/brokerUnitMappings", () => ({
  resolvePepperstoneXauUsdDemoMapping: () => ({
    ozPerLot: 1,
    broker: "Pepperstone",
    symbol: "XAUUSD"
  })
}));

vi.mock("../../../../src/services/broker/ctrader/sizing", () => ({
  calculateCTraderVolume: () => ({
    ok: true,
    volume: 0.05
  })
}));

vi.mock("../../../../src/services/broker/ctrader/autoTradeJournal", () => ({
  createAutoTradeJournalEntry: vi.fn(),
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

function decision(over: Record<string, unknown> = {}) {
  return {
    decisionId: "dec_a_plus_buy",
    decision: "BUY",
    setupScore: 94,
    confidence: 94,
    entry: { price: 3400 },
    stopLoss: { price: 3390 },
    takeProfits: [{ price: 3415 }, { price: 3425 }, { price: 3435 }],
    reasons: ["TREND_AGREEMENT", "MTF_BULLISH", "BREAKOUT"],
    marketStructure: {
      confirmationClassification: "BREAKOUT_CONFIRMED"
    },
    ...over
  };
}

describe("ACTIVE_DEMO processDecision submit call counts", () => {
  beforeEach(() => {
    submitDemoMarketOrder.mockClear();
    appendEvaluation.mockClear();
    clearArmedCandidate.mockClear();
    saveArmedCandidate.mockClear();
    getArmedCandidate.mockReset();
    getArmedCandidate.mockResolvedValue(null);
    settingsState.autoTradeEnabledIntent = true;
    settingsState.autoTradePaused = false;
    settingsState.emergencyStopActive = false;
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    process.env.DEMO_OPPORTUNITY_MODE = "ACTIVE_DEMO";
    process.env.CTRADER_CLIENT_ID = "test-client";
    process.env.CTRADER_CLIENT_SECRET = "test-secret";
  });

  it("A+ valid setup + intent ON + gates pass → exactly ONE submit", async () => {
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
      decisionId: "dec_a_plus_buy",
      store: store as never
    });
    expect(result, JSON.stringify(result)).toMatchObject({ handled: true });
    expect(submitDemoMarketOrder, `result=${JSON.stringify(result)}`).toHaveBeenCalledTimes(1);
  });

  it("Intent OFF → ZERO submits", async () => {
    settingsState.autoTradeEnabledIntent = false;
    const store = {
      getDecision: vi.fn(async () => decision()),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_intent_off",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("Paused → ZERO submits", async () => {
    settingsState.autoTradePaused = true;
    const store = {
      getDecision: vi.fn(async () => decision()),
      getActiveSessionPlan: vi.fn(async () => null)
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_paused",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("Emergency stop → ZERO submits", async () => {
    settingsState.emergencyStopActive = true;
    const store = {
      getDecision: vi.fn(async () => decision()),
      getActiveSessionPlan: vi.fn(async () => null)
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_estop",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("Live account → ZERO submits", async () => {
    const { getConnection } = await import(
      "../../../../src/services/broker/ctrader/connectionStore"
    );
    vi.mocked(getConnection).mockResolvedValueOnce({
      selectedAccountId: "99999999",
      selectedAccountIsLive: true,
      selectedAccountMasked: "99…99",
      oauthScope: "trading",
      brokerConfirmedPepperstone: true,
      symbolId: "41",
      symbolName: "XAUUSD",
      environment: "LIVE",
      leverage: 100,
      lastQuoteAt: new Date().toISOString()
    } as never);
    const store = {
      getDecision: vi.fn(async () => decision()),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_live",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("duplicate decision → at most ONE submit", async () => {
    const store = {
      getDecision: vi.fn(async () => decision()),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_a_plus_buy",
      store: store as never
    });
    // Second delivery — armed already executionAttempted via store mock after first
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "dec_a_plus_buy",
      planSourceKey: null,
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 94,
      setupScore: 94,
      nowIso: new Date().toISOString()
    });
    getArmedCandidate.mockResolvedValue({ ...armed, executionAttempted: true });
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_a_plus_buy",
      store: store as never
    });
    expect(submitDemoMarketOrder.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("NO_VALID_PLAN after armed → remains ARMED (no invalidate-only kill)", async () => {
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "dec_armed",
      planSourceKey: "plan_1",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 91,
      setupScore: 91,
      nowIso: new Date().toISOString()
    });
    getArmedCandidate.mockResolvedValue(armed);
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_wait",
          decision: "WAIT",
          setupScore: 40,
          confidence: 40,
          marketStructure: { confirmationClassification: "OUTSIDE_ZONE" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "NO_VALID_PLAN",
        confirmationState: "OUTSIDE_ZONE",
        direction: "WAIT"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_wait",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    // Should save/keep armed, not only clear
    const clearedOnly =
      clearArmedCandidate.mock.calls.length > 0 && saveArmedCandidate.mock.calls.length === 0;
    expect(clearedOnly).toBe(false);
    expect(saveArmedCandidate).toHaveBeenCalled();
    const saved = saveArmedCandidate.mock.calls.at(-1)?.[0] as { status?: string; planRefreshNote?: string };
    expect(saved?.status).toBe("ARMED");
  });

  it("explicit opposite confirmation → invalidated / ZERO order", async () => {
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "dec_buy",
      planSourceKey: "plan_1",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 91,
      setupScore: 91,
      nowIso: new Date().toISOString()
    });
    getArmedCandidate.mockResolvedValue(armed);
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_neutral",
          decision: "WAIT",
          marketStructure: { confirmationClassification: "REJECTION_CONFIRMED" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "REJECTION_CONFIRMED",
        direction: "SELL"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_neutral",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(clearArmedCandidate).toHaveBeenCalled();
  });

  it("expired candidate → ZERO order", async () => {
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "dec_old",
      planSourceKey: "plan_1",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 91,
      setupScore: 91,
      nowIso: "2026-08-11T10:00:00.000Z"
    });
    // Force expiry in the past
    getArmedCandidate.mockResolvedValue({
      ...armed,
      expiresAt: "2026-08-11T10:14:00.000Z",
      armedAt: "2026-08-11T10:00:00.000Z"
    });
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_later",
          decision: "WAIT",
          marketStructure: { confirmationClassification: "BREAKOUT_CONFIRMED" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    // Freeze "now" indirectly via expired expiresAt vs Date.now() — expiresAt is in 2026-08-11 past relative to real now
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_later",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });
});
