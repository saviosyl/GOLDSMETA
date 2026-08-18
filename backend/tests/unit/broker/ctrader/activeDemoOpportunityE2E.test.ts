/**
 * ACTIVE_DEMO opportunity engine — processDecisionForQualification
 * submitDemoMarketOrder call-count regressions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  submitDemoMarketOrder,
  appendEvaluation,
  clearArmedCandidate,
  saveArmedCandidate,
  getArmedCandidate,
  calculatePepperstoneXauUsdDemoVolume,
  resolvePepperstoneXauUsdDemoMapping,
  createAutoTradeJournalEntry
} = vi.hoisted(() => ({
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
  incrementQualificationBlockedAttempts: vi.fn(async () => undefined),
  upsertQualificationOpenTrade: vi.fn(async () => null),
  normalizeAccountId: (id: unknown) =>
    id == null ? null : String(id).trim() || null,
  findForeignStartedQualifications: vi.fn(async () => ({ ok: true, hits: [] }))
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
    // Pin major session so risk multipliers are time-stable (Asia half-risk otherwise).
    currentSessionUtc: vi.fn(() => "London"),
    sessionAllowed: vi.fn(() => ({ ok: true, current: "London", reason: null }))
  };
});

vi.mock("../../../../src/services/broker/ctrader/demoOpportunityEngine", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/broker/ctrader/demoOpportunityEngine")
  >("../../../../src/services/broker/ctrader/demoOpportunityEngine");
  return {
    ...actual,
    // Overlap (12–16 UTC) bypasses currentSessionUtc — pin the bucket used for risk.
    resolveTradingSessionBucket: vi.fn(() => "London")
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
  calculatePepperstoneXauUsdDemoVolume
}));

vi.mock("../../../../src/services/broker/ctrader/demoMarginService", () => ({
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
  }))
}));

vi.mock("../../../../src/services/broker/ctrader/brokerUnitMappings", () => ({
  resolvePepperstoneXauUsdDemoMapping
}));

vi.mock("../../../../src/services/broker/ctrader/sizing", () => ({
  calculateCTraderVolume: () => ({
    ok: true,
    volume: 0.05
  })
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
  // FAST must stay off — leftover FAST_AUTOTRADE_V1_ENABLED from other files
  // would otherwise replace ACTIVE_DEMO armed/tier behaviour.
  beforeEach(() => {
    submitDemoMarketOrder.mockClear();
    appendEvaluation.mockClear();
    clearArmedCandidate.mockClear();
    saveArmedCandidate.mockClear();
    calculatePepperstoneXauUsdDemoVolume.mockClear();
    resolvePepperstoneXauUsdDemoMapping.mockClear();
    createAutoTradeJournalEntry.mockClear();
    getArmedCandidate.mockReset();
    getArmedCandidate.mockResolvedValue(null);
    resolvePepperstoneXauUsdDemoMapping.mockReturnValue({
      ozPerLot: 1,
      broker: "Pepperstone",
      symbol: "XAUUSD"
    });
    calculatePepperstoneXauUsdDemoVolume.mockReturnValue({
      ok: true,
      volumeLots: 0.05,
      rejectionReason: null,
      notes: ["test-mock"]
    });
    settingsState.autoTradeEnabledIntent = true;
    settingsState.autoTradePaused = false;
    settingsState.emergencyStopActive = false;
    settingsState.confirmationCandleRequired = true;
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    process.env.DEMO_OPPORTUNITY_MODE = "ACTIVE_DEMO";
    process.env.FAST_AUTOTRADE_V1_ENABLED = "false";
    process.env.CTRADER_CLIENT_ID = "test-client";
    process.env.CTRADER_CLIENT_SECRET = "test-secret";
    delete process.env.DEMO_A_PLUS_MIN_SCORE;
    delete process.env.DEMO_A_MIN_SCORE;
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

  it("Intent OFF → ZERO submits + armed candidate invalidated", async () => {
    settingsState.autoTradeEnabledIntent = false;
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "dec_armed_off",
      planSourceKey: "plan_1",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      takeProfit2: 3425,
      confidence: 94,
      setupScore: 94,
      nowIso: new Date().toISOString()
    });
    getArmedCandidate.mockResolvedValue(armed);
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
    expect(clearArmedCandidate).toHaveBeenCalled();
  });

  it("OAuth trading scope lost → ZERO submits + armed invalidated", async () => {
    const { getConnection } = await import(
      "../../../../src/services/broker/ctrader/connectionStore"
    );
    vi.mocked(getConnection).mockResolvedValue({
      selectedAccountId: "48014710",
      selectedAccountIsLive: false,
      selectedAccountMasked: "48…10",
      oauthScope: "accounts",
      brokerConfirmedPepperstone: true,
      symbolId: "41",
      symbolName: "XAUUSD",
      environment: "DEMO",
      leverage: 100,
      lastQuoteAt: new Date().toISOString()
    } as never);
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "dec_oauth",
      planSourceKey: "plan_1",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 94,
      setupScore: 94,
      nowIso: new Date().toISOString()
    });
    getArmedCandidate.mockResolvedValue(armed);
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
      decisionId: "dec_oauth_lost",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(clearArmedCandidate).toHaveBeenCalled();
    // restore trading scope for later tests
    vi.mocked(getConnection).mockResolvedValue({
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
    } as never);
  });

  it("BELOW tier (setupScore 78) + high confidence → ZERO + TIER_BELOW_A", async () => {
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_below",
          setupScore: 78,
          confidence: 88,
          reasons: ["TREND_AGREEMENT", "MTF_BULLISH"],
          marketStructure: { confirmationClassification: "BREAKOUT_CONFIRMED" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_below",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    const tierReject = appendEvaluation.mock.calls.some(
      (c) => (c[0] as { reasonCode?: string }).reasonCode === "TIER_BELOW_A"
    );
    expect(tierReject).toBe(true);
  });

  it("CASE1 A+ 94 setting=false structural-only OUTSIDE_ZONE → ARMED, ZERO submit", async () => {
    settingsState.confirmationCandleRequired = false;
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_aplus_struct",
          setupScore: 94,
          confidence: 94,
          reasons: ["TREND_AGREEMENT", "POC"],
          marketStructure: { confirmationClassification: "OUTSIDE_ZONE" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "OUTSIDE_ZONE",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_aplus_struct",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(saveArmedCandidate).toHaveBeenCalled();
    const saved = saveArmedCandidate.mock.calls.at(-1)?.[0] as { status?: string };
    expect(saved?.status).toBe("ARMED");
  });

  it("CASE2 A+ BUY setting=false + BEARISH_REJECTION + MTF_BULLISH → ZERO / no fast exec", async () => {
    settingsState.confirmationCandleRequired = false;
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_aplus_opp",
          setupScore: 94,
          confidence: 94,
          reasons: ["MTF_BULLISH", "TREND_AGREEMENT"],
          marketStructure: { confirmationClassification: "BEARISH_REJECTION" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BEARISH_REJECTION",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_aplus_opp",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });

  it("CASE3 A+ BUY setting=false + valid bullish fast evidence → ONE FAST submit", async () => {
    settingsState.confirmationCandleRequired = false;
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_aplus_fast",
          setupScore: 94,
          confidence: 94,
          reasons: ["MTF_BULLISH", "MARKET_STRUCTURE", "BREAKOUT"],
          marketStructure: { confirmationClassification: "BREAKOUT_CONFIRMED" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_aplus_fast",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    const journal = createAutoTradeJournalEntry.mock.calls.at(-1)?.[0] as {
      reasonForTrade?: string;
    };
    expect(journal?.reasonForTrade ?? "").toMatch(/FAST CONFIRMATION|Confirm FAST_CONFIRMATION/);
  });

  it("original TP2/TP3 survive later WAIT confirmation → exactly ONE submit", async () => {
    // Entry 3400 / SL 3390 / TP1 3410 (=1R) / TP2 3420 (=2R) — minRR 1.5 needs TP2.
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "dec_tp_ladder",
      planSourceKey: "plan_tp",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3410,
      takeProfit2: 3420,
      takeProfit3: 3430,
      confidence: 86,
      setupScore: 86,
      nowIso: new Date().toISOString()
    });
    getArmedCandidate.mockResolvedValue(armed);
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_tp_confirm",
          decision: "WAIT",
          setupScore: 40,
          confidence: 40,
          // Later cycle omits TP ladder — armed thesis must retain it.
          takeProfits: [],
          entry: undefined,
          stopLoss: undefined,
          marketStructure: { confirmationClassification: "BREAKOUT_CONFIRMED" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY",
        planSourceKey: "plan_tp"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_tp_confirm",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
  });

  it("NO_TRADE after armed → invalidated / ZERO order", async () => {
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "dec_armed_nt",
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
          decisionId: "dec_no_trade",
          decision: "WAIT",
          marketStructure: { confirmationClassification: "OUTSIDE_ZONE" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "NO_TRADE",
        confirmationState: "OUTSIDE_ZONE",
        direction: "WAIT"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_no_trade",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(clearArmedCandidate).toHaveBeenCalled();
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

  it("custom A+=95 / A=85 + score 90 → tier A, risk 0.75, persists through submit/journal", async () => {
    process.env.DEMO_A_PLUS_MIN_SCORE = "95";
    process.env.DEMO_A_MIN_SCORE = "85";
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_custom_a",
          setupScore: 90,
          confidence: 99,
          reasons: ["MTF_BULLISH", "MARKET_STRUCTURE"],
          marketStructure: { confirmationClassification: "BREAKOUT_CONFIRMED" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_custom_a",
      store: store as never
    });
    // Score 90 with A+=95 is A-tier → must wait for normal confirm, but
    // BREAKOUT_CONFIRMED satisfies mandatory A confirmation → one submit.
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    const sizingArg = calculatePepperstoneXauUsdDemoVolume.mock.calls.at(-1)?.[0] as {
      riskAmountDeposit?: number;
    };
    expect(sizingArg?.riskAmountDeposit).toBe(37.5); // 50 * 0.75 (London A)
    const journalArg = createAutoTradeJournalEntry.mock.calls.at(-1)?.[0] as {
      reasonForTrade?: string;
      cashRisk?: number;
      requestedRiskAmountDeposit?: number;
      effectiveRiskAmountDeposit?: number;
      riskCapReason?: string | null;
    };
    expect(journalArg?.cashRisk).toBe(37.5);
    expect(journalArg?.requestedRiskAmountDeposit).toBe(50);
    expect(journalArg?.effectiveRiskAmountDeposit).toBe(37.5);
    expect(journalArg?.riskCapReason).toMatch(/TIER_A_RISK_MULT/);
    expect(journalArg?.reasonForTrade).toMatch(/Tier A\b/);
    expect(journalArg?.reasonForTrade).not.toMatch(/Tier A_PLUS|Tier A\+/);
  });

  it("overnight cutoff → ZERO submit + OVERNIGHT_WINDOW_ENDED", async () => {
    process.env.DEMO_OVERNIGHT_MODE = "true";
    process.env.DEMO_OVERNIGHT_RUN_UNTIL = "2026-08-12T00:00:00.000Z";
    const store = {
      getDecision: vi.fn(async () => decision()),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY",
        validUntil: new Date(Date.now() + 3600_000).toISOString()
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_overnight_ended",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    const rejected = appendEvaluation.mock.calls
      .map((c) => c[0])
      .find((r) => r?.reasonCode === "OVERNIGHT_WINDOW_ENDED");
    expect(rejected).toBeTruthy();
    delete process.env.DEMO_OVERNIGHT_MODE;
    delete process.env.DEMO_OVERNIGHT_RUN_UNTIL;
  });

  it("Asia session → effective risk 25 (50 * 0.5) with explicit risk-cap reason", async () => {
    const sessionGuard = await import(
      "../../../../src/services/broker/ctrader/sessionGuard"
    );
    const opportunity = await import(
      "../../../../src/services/broker/ctrader/demoOpportunityEngine"
    );
    vi.mocked(sessionGuard.currentSessionUtc).mockReturnValue("Asia");
    vi.mocked(sessionGuard.sessionAllowed).mockReturnValue({
      ok: true,
      current: "Asia",
      reason: null
    });
    vi.mocked(opportunity.resolveTradingSessionBucket).mockReturnValue("Asia");
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_asia_a_plus",
          setupScore: 95,
          confidence: 95,
          reasons: ["MTF_BULLISH", "MARKET_STRUCTURE"],
          marketStructure: { confirmationClassification: "BREAKOUT_CONFIRMED" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_asia_a_plus",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
    const sizingArg = calculatePepperstoneXauUsdDemoVolume.mock.calls.at(-1)?.[0] as {
      riskAmountDeposit?: number;
    };
    expect(sizingArg?.riskAmountDeposit).toBe(25); // Asia experimental half-risk
    const journalArg = createAutoTradeJournalEntry.mock.calls.at(-1)?.[0] as {
      requestedRiskAmountDeposit?: number;
      effectiveRiskAmountDeposit?: number;
      riskCapReason?: string | null;
    };
    expect(journalArg?.requestedRiskAmountDeposit).toBe(50);
    expect(journalArg?.effectiveRiskAmountDeposit).toBe(25);
    expect(journalArg?.riskCapReason).toMatch(/ASIA_EXPERIMENTAL_RISK/);
    vi.mocked(sessionGuard.currentSessionUtc).mockReturnValue("London");
    vi.mocked(sessionGuard.sessionAllowed).mockReturnValue({
      ok: true,
      current: "London",
      reason: null
    });
    vi.mocked(opportunity.resolveTradingSessionBucket).mockReturnValue("London");
  });

  it("A + confirmationCandleRequired=false still waits without 5M confirm", async () => {
    settingsState.confirmationCandleRequired = false;
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_a_wait",
          setupScore: 86,
          confidence: 86,
          reasons: ["MTF_BULLISH"],
          marketStructure: { confirmationClassification: "OUTSIDE_ZONE" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "OUTSIDE_ZONE",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_a_wait",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    expect(saveArmedCandidate).toHaveBeenCalled();
    const armed = saveArmedCandidate.mock.calls.at(-1)?.[0] as {
      status?: string;
      tier?: string;
      setupScore?: number;
    };
    expect(armed?.status).toBe("ARMED");
    expect(armed?.tier).toBe("A");

    getArmedCandidate.mockResolvedValue(armed);
    const confirmStore = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_a_confirm",
          decision: "WAIT",
          setupScore: 40,
          takeProfits: [],
          marketStructure: { confirmationClassification: "BREAKOUT_CONFIRMED" }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BREAKOUT_CONFIRMED",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_a_confirm",
      store: confirmStore as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(1);
  });

  it("missing Pepperstone XAU unit mapping → ZERO submit (ACTIVE_DEMO fail closed)", async () => {
    resolvePepperstoneXauUsdDemoMapping.mockReturnValue(null);
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
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
    const mapped = appendEvaluation.mock.calls.some(
      (c) =>
        (c[0] as { reasonCode?: string }).reasonCode ===
        "BROKER_UNIT_MAPPING_REQUIRED"
    );
    expect(mapped).toBe(true);
  });

  it("opposite classification + same-side reasons → no A+ fast execution", async () => {
    const store = {
      getDecision: vi.fn(async () =>
        decision({
          decisionId: "dec_conflict",
          setupScore: 94,
          confidence: 94,
          reasons: ["MTF_BULLISH", "TREND_AGREEMENT"],
          marketStructure: {
            confirmationClassification: "BEARISH_REJECTION"
          }
        })
      ),
      getActiveSessionPlan: vi.fn(async () => ({
        lifecycleState: "ACTIVE",
        confirmationState: "BEARISH_REJECTION",
        direction: "BUY"
      }))
    };
    await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_conflict",
      store: store as never
    });
    expect(submitDemoMarketOrder).toHaveBeenCalledTimes(0);
  });
});
