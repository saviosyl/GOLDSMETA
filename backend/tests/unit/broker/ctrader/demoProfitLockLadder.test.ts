/**
 * Deterministic Demo T1/T2/T3 profit-lock ladder — review-fix coverage.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateProfitLock,
  isFreshPostSecureM5Bar,
  m5CloseConfirmsContinuation
} from "../../../../src/services/broker/ctrader/demoProfitLockEvaluate";
import {
  computeBrokerSafeStopBuffer,
  brokerHardTakeProfitForAmend,
  isStopImprovement,
  brokerTp3Preserved
} from "../../../../src/services/broker/ctrader/demoProfitLockStops";
import {
  planT1PartialClose,
  planT2PartialClose,
  desiredCumulativeCloseLots
} from "../../../../src/services/broker/ctrader/demoProfitLockVolume";
import {
  runDemoProfitLockPass,
  type ProfitLockDeps
} from "../../../../src/services/broker/ctrader/demoProfitLockManager";
import { isDemoProfitLockLadderEnabled } from "../../../../src/services/broker/ctrader/demoProfitLockFlag";
import {
  executableTargetTouchPrice,
  targetTouched,
  validateProfitLockTargets
} from "../../../../src/services/broker/ctrader/demoProfitLockTargets";
import {
  normalizeSlDistanceToPrice,
  parseDistanceSetIn
} from "../../../../src/services/broker/ctrader/ctraderStopDistance";
import {
  emptyProfitLockState,
  emptyTpStatuses,
  type DemoPositionLifecycle
} from "../../../../src/services/broker/ctrader/positionLifecycleTypes";
import {
  isBrokerExecutionEnabled,
  isCTraderLiveEnabled
} from "../../../../src/services/broker/ctrader/flags";
import { defaultUserAutoTradeSettings } from "../../../../src/services/broker/ctrader/userAutoTradeSettings";
import type { BrokerOpenPosition } from "../../../../src/services/broker/ctrader/openApiClient";
import type { BrokerSymbol } from "../../../../src/services/broker/domain";
import { resolveManagementPolicy } from "../../../../src/services/broker/ctrader/demoProfitLockTypes";

const FINE_RULES = { minLots: 0.01, maxLots: 100, stepLots: 0.01 };

function baseDoc(
  overrides: Partial<DemoPositionLifecycle> = {}
): DemoPositionLifecycle {
  return {
    id: "c1",
    uid: "u1",
    environment: "DEMO",
    correlationId: "c1",
    brokerOrderId: "o1",
    brokerPositionId: "p1",
    accountId: "48014710",
    accountMasked: "48…10",
    symbol: "XAUUSD",
    side: "BUY",
    entry: 2350,
    currentPrice: 2350,
    lots: 17,
    remainingLots: 17,
    initialSl: 2340,
    currentSl: 2340,
    tp1: 2360,
    tp2: 2370,
    tp3: 2380,
    ...emptyTpStatuses(),
    openedAt: new Date().toISOString(),
    closedAt: null,
    realisedPnl: null,
    unrealisedPnl: 0,
    brokerPnlConfirmed: false,
    closePrice: null,
    grossPnl: null,
    commission: null,
    swap: null,
    netPnl: null,
    brokerDealId: null,
    initialRisk: 10,
    currentRisk: 10,
    qualificationStage: "LIVE_QUALIFICATION",
    decisionId: "d1",
    setupRef: "d1",
    source: "demo_auto",
    managementState: "SL_PROTECTED",
    lastRecommendation: null,
    protectionVerified: true,
    protectionFailure: false,
    events: [],
    appliedDedupeKeys: [],
    updatedAt: new Date().toISOString(),
    status: "OPEN",
    ...emptyProfitLockState(),
    managementPolicy: "PROFIT_LOCK_V1",
    profitLockStage: "OPEN",
    brokerHardTakeProfit: 2380,
    ...overrides
  };
}

function symbolFine(): BrokerSymbol {
  return {
    brokerId: "pepperstone_ctrader",
    environment: "DEMO",
    symbolId: "41",
    symbolName: "XAUUSD",
    displayName: "XAUUSD",
    baseAsset: "XAU",
    quoteAsset: "USD",
    digits: 2,
    pipPosition: 1,
    tickSize: 0.01,
    minVolume: 0.01,
    volumeStep: 0.01,
    maxVolume: 100,
    lotSize: 100,
    commissionType: null,
    commissionAmount: null,
    minCommission: null,
    swapLong: null,
    swapShort: null,
    minStopDistance: 0.3,
    rawSlDistance: 30,
    distanceSetIn: "SYMBOL_DISTANCE_IN_POINTS",
    rawTpDistance: null,
    normalizedMinStopPriceDistance: 0.3,
    guaranteedStopAvailable: null,
    tradingScheduleId: null,
    metadataComplete: true,
    missingFields: []
  };
}

/** Pepperstone Demo smoke shape: slDistance=0 POINTS. */
function symbolPepperstoneZeroSl(): BrokerSymbol {
  return {
    ...symbolFine(),
    rawSlDistance: 0,
    distanceSetIn: "SYMBOL_DISTANCE_IN_POINTS",
    rawTpDistance: 0,
    normalizedMinStopPriceDistance: null,
    minStopDistance: null
  };
}

function pos(
  lots: number,
  sl: number | null = 2340,
  tp: number | null = 2380
): BrokerOpenPosition {
  return {
    positionId: "p1",
    symbolId: "41",
    side: "BUY",
    volumeLots: lots,
    volumeUnits: Math.round(lots * 100),
    entryPrice: 2350,
    stopLoss: sl,
    takeProfit: tp,
    unrealisedPnl: 0,
    usedMargin: null,
    openTimestamp: new Date().toISOString()
  };
}

type SimState = {
  remaining: number;
  sl: number | null;
  tp: number | null;
  bid: number;
  ask: number;
  m5Bars?: Array<{ time: number; close: number }>;
  liveAccount?: boolean;
  reconcileFail?: boolean;
  closeDelayVolume?: boolean;
  amendKeepOldSl?: boolean;
  amendDropTp3?: boolean;
  symbol?: BrokerSymbol;
};

function makeDeps(state: SimState): {
  deps: ProfitLockDeps;
  closes: number[];
  amends: Array<{ stopLoss: number; takeProfit?: number | null }>;
  saved: DemoPositionLifecycle[];
  state: SimState;
} {
  const closes: number[] = [];
  const amends: Array<{ stopLoss: number; takeProfit?: number | null }> = [];
  const saved: DemoPositionLifecycle[] = [];

  const deps: ProfitLockDeps = {
    reconcilePositions: async () => {
      if (state.reconcileFail) throw new Error("RECONCILE_DOWN");
      return state.remaining > 1e-8
        ? [pos(state.remaining, state.sl, state.tp)]
        : [];
    },
    amendStopLoss: async (args) => {
      amends.push({ stopLoss: args.stopLoss, takeProfit: args.takeProfit });
      if (state.amendDropTp3) {
        state.tp = 2360; // wrongly rewritten to TP1
      } else if (args.takeProfit != null) {
        state.tp = args.takeProfit;
      }
      if (!state.amendKeepOldSl) {
        state.sl = args.stopLoss;
      }
      return { accepted: true };
    },
    closePosition: async (args) => {
      closes.push(args.volumeUnits);
      if (!state.closeDelayVolume) {
        state.remaining = Number(
          (state.remaining - args.volumeUnits / 100).toFixed(8)
        );
      }
      return { accepted: true };
    },
    loadSymbol: async () => state.symbol ?? symbolFine(),
    getQuote: async () => ({
      bid: state.bid,
      ask: state.ask,
      spread: Number((state.ask - state.bid).toFixed(6))
    }),
    getCompletedM5Bars: async () =>
      (state.m5Bars ?? []).map((b) => ({
        time: b.time,
        open: b.close,
        high: b.close,
        low: b.close,
        close: b.close,
        volume: 1
      })),
    isSelectedAccountLive: async () => Boolean(state.liveAccount),
    save: async (doc) => {
      saved.push(structuredClone(doc));
    }
  };
  return { deps, closes, amends, saved, state };
}

const stopBuffer = {
  normalizedMinStopPriceDistance: 0.3,
  spread: 0.1,
  tickSize: 0.01,
  digits: 2
};

describe("B2 — executable BID/ASK target touch", () => {
  it("BUY: mid>=TP1 but bid<TP1 does not trigger; bid cross does", () => {
    expect(
      targetTouched({
        side: "BUY",
        touchPrice: executableTargetTouchPrice({
          side: "BUY",
          bid: 2359.9,
          ask: 2360.2
        }),
        level: 2360
      })
    ).toBe(false);
    const mid = (2359.9 + 2360.2) / 2;
    expect(mid).toBeGreaterThanOrEqual(2360);
    expect(
      targetTouched({
        side: "BUY",
        touchPrice: executableTargetTouchPrice({
          side: "BUY",
          bid: 2360,
          ask: 2360.2
        }),
        level: 2360
      })
    ).toBe(true);
  });

  it("SELL: mid<=TP1 but ask>TP1 does not trigger; ask cross does", () => {
    expect(
      targetTouched({
        side: "SELL",
        touchPrice: executableTargetTouchPrice({
          side: "SELL",
          bid: 2369.8,
          ask: 2370.1
        }),
        level: 2370
      })
    ).toBe(false);
    expect(
      targetTouched({
        side: "SELL",
        touchPrice: executableTargetTouchPrice({
          side: "SELL",
          bid: 2369.8,
          ask: 2370
        }),
        level: 2370
      })
    ).toBe(true);
  });

  it("missing executable side fails closed", () => {
    expect(
      evaluateProfitLock({
        side: "BUY",
        stage: "OPEN",
        protectionLevel: "NONE",
        entry: 2350,
        currentSl: 2340,
        tp1: 2360,
        tp2: 2370,
        tp3: 2380,
        brokerHardTakeProfit: 2380,
        originalLots: 10,
        brokerRemainingLots: 10,
        targetTouchPrice: null,
        brokerPositionOpen: true,
        m5ContinuationBeyondTp1: false,
        m5ContinuationBeyondTp2: false,
        completedM5BarTime: null,
        volumeRules: FINE_RULES,
        stopBuffer
      }).type === "NONE" &&
        evaluateProfitLock({
          side: "BUY",
          stage: "OPEN",
          protectionLevel: "NONE",
          entry: 2350,
          currentSl: 2340,
          tp1: 2360,
          tp2: 2370,
          tp3: 2380,
          brokerHardTakeProfit: 2380,
          originalLots: 10,
          brokerRemainingLots: 10,
          targetTouchPrice: null,
          brokerPositionOpen: true,
          m5ContinuationBeyondTp1: false,
          m5ContinuationBeyondTp2: false,
          completedM5BarTime: null,
          volumeRules: FINE_RULES,
          stopBuffer
        }).type === "NONE"
    ).toBe(true);
    const a = evaluateProfitLock({
      side: "BUY",
      stage: "OPEN",
      protectionLevel: "NONE",
      entry: 2350,
      currentSl: 2340,
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      brokerHardTakeProfit: 2380,
      originalLots: 10,
      brokerRemainingLots: 10,
      targetTouchPrice: null,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: false,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(a).toEqual({
      type: "NONE",
      reason: "EXECUTABLE_TOUCH_PRICE_UNAVAILABLE"
    });
  });
});

describe("B3/F3 — fresh post-secure M5 continuation (never null-open)", () => {
  it("null securedAt fails closed; barEnd must be after securedAt", () => {
    const securedAt = new Date(1_700_000_000_000).toISOString();
    expect(
      isFreshPostSecureM5Bar({
        barTime: 1_700_000_000 - 600,
        securedAt: null,
        securedAfterM5BarTime: null,
        alreadyConfirmedBarTime: null
      })
    ).toBe(false);
    // Bar that completed before secure
    expect(
      isFreshPostSecureM5Bar({
        barTime: Math.floor(1_700_000_000_000 / 1000) - 600,
        securedAt,
        securedAfterM5BarTime: null,
        alreadyConfirmedBarTime: null
      })
    ).toBe(false);
    // Bar that completes after secure
    const afterOpen = Math.floor(1_700_000_000_000 / 1000) + 60;
    expect(
      isFreshPostSecureM5Bar({
        barTime: afterOpen,
        securedAt,
        securedAfterM5BarTime: afterOpen - 300,
        alreadyConfirmedBarTime: null
      })
    ).toBe(true);
    expect(
      isFreshPostSecureM5Bar({
        barTime: afterOpen,
        securedAt,
        securedAfterM5BarTime: afterOpen - 300,
        alreadyConfirmedBarTime: afterOpen
      })
    ).toBe(false);
  });

  it("BE confirmed with candle fetch fail: old bar beyond TP1 must NOT confirm", async () => {
    const securedAt = new Date().toISOString();
    const oldBarTime = Math.floor(Date.now() / 1000) - 900;
    const doc = baseDoc({
      profitLockStage: "T1_SECURED_BE",
      remainingLots: 8.5,
      lots: 17,
      currentSl: 2350,
      profitLockProtectionLevel: "BE",
      t1SecuredAt: securedAt,
      t1SecuredAfterM5BarTime: null // candle fetch failed at secure
    });
    const { deps, state } = makeDeps({
      remaining: 8.5,
      sl: 2350,
      tp: 2380,
      bid: 2362,
      ask: 2362.2,
      m5Bars: [{ time: oldBarTime, close: 2361 }]
    });
    const wait = await runDemoProfitLockPass(doc, deps);
    expect(wait.doc.profitLockStage).toBe("T1_SECURED_BE");
    expect(wait.blockedReason).toBe("WAITING_T1_CONTINUATION_5M_FRESH");

    const freshTime = Math.floor(Date.now() / 1000) + 10;
    // Simulate time: bar open after securedAt with end after securedAt
    state.m5Bars = [{ time: Math.floor(Date.parse(securedAt) / 1000) + 60, close: 2362 }];
    const conf = await runDemoProfitLockPass(wait.doc, deps);
    expect(conf.doc.profitLockStage).toBe("T1_CONTINUATION_CONFIRMED");
    void freshTime;
  });

  it("SELL T2 fresh continuation mirrors BUY", () => {
    expect(
      m5CloseConfirmsContinuation({
        side: "SELL",
        completedClose: 2359,
        level: 2360
      })
    ).toBe(true);
  });
});

describe("B4/F4 — stop distance normalization", () => {
  it("POINTS supported; PERCENTAGE and unknown fail closed", () => {
    expect(parseDistanceSetIn(1)).toBe("SYMBOL_DISTANCE_IN_POINTS");
    expect(parseDistanceSetIn(2)).toBe("SYMBOL_DISTANCE_IN_PERCENTAGE");

    const pts = normalizeSlDistanceToPrice({
      rawSlDistance: 30,
      distanceSetIn: 1,
      digits: 2
    });
    expect(pts.ok).toBe(true);
    if (pts.ok) expect(pts.normalizedMinStopPriceDistance).toBeCloseTo(0.3, 8);

    const pct = normalizeSlDistanceToPrice({
      rawSlDistance: 100,
      distanceSetIn: 2,
      digits: 2,
      referencePrice: 2350
    });
    expect(pct.ok).toBe(false);
    if (!pct.ok) {
      expect(pct.reason).toBe("STOP_DISTANCE_NORMALIZATION_UNAVAILABLE");
      expect(pct.distanceSetIn).toBe("SYMBOL_DISTANCE_IN_PERCENTAGE");
    }

    const zero = normalizeSlDistanceToPrice({
      rawSlDistance: 0,
      distanceSetIn: 1,
      digits: 2
    });
    expect(zero.ok).toBe(false);

    const buf = computeBrokerSafeStopBuffer({
      rawSlDistance: 0,
      distanceSetIn: 1,
      digits: 2,
      spread: 0.1,
      tickSize: 0.01
    });
    expect(buf.ok).toBe(false);
  });
});

describe("B5 — valid T1/T2/T3 required for PROFIT_LOCK_V1", () => {
  it("incomplete / invalid geometry blocked", () => {
    expect(
      validateProfitLockTargets({
        side: "BUY",
        entry: 2350,
        tp1: 2360,
        tp2: null,
        tp3: 2380
      }).ok
    ).toBe(false);
    const inv = validateProfitLockTargets({
      side: "BUY",
      entry: 2350,
      tp1: 2380,
      tp2: 2370,
      tp3: 2360
    });
    expect(inv.ok).toBe(false);
    if (!inv.ok) expect(inv.code).toBe("PROFIT_LOCK_TARGETS_INVALID");

    const sellOk = validateProfitLockTargets({
      side: "SELL",
      entry: 2380,
      tp1: 2370,
      tp2: 2360,
      tp3: 2350
    });
    expect(sellOk.ok).toBe(true);
  });
});

describe("B6 — immutable per-position management policy", () => {
  it("A/B/C policy snapshot semantics", () => {
    expect(resolveManagementPolicy(null)).toBe("LEGACY_V1");
    expect(resolveManagementPolicy("LEGACY_V1")).toBe("LEGACY_V1");
    expect(resolveManagementPolicy("PROFIT_LOCK_V1")).toBe("PROFIT_LOCK_V1");

    // A: opened LEGACY — setting later TRUE must not change policy
    const legacy = baseDoc({
      managementPolicy: "LEGACY_V1",
      profitLockStage: null
    });
    expect(resolveManagementPolicy(legacy.managementPolicy)).toBe("LEGACY_V1");
    expect(
      isDemoProfitLockLadderEnabled({
        environment: "demo",
        demoProfitLockLadderEnabled: true
      })
    ).toBe(true);
    // policy on doc still LEGACY
    expect(legacy.managementPolicy).toBe("LEGACY_V1");

    // B: opened PROFIT_LOCK — setting later FALSE must not change policy
    const lock = baseDoc({ managementPolicy: "PROFIT_LOCK_V1" });
    expect(resolveManagementPolicy(lock.managementPolicy)).toBe("PROFIT_LOCK_V1");
    expect(
      isDemoProfitLockLadderEnabled({
        environment: "demo",
        demoProfitLockLadderEnabled: false
      })
    ).toBe(false);

    // C: new position uses current setting
    expect(
      isDemoProfitLockLadderEnabled({
        environment: "demo",
        demoProfitLockLadderEnabled: true
      })
        ? "PROFIT_LOCK_V1"
        : "LEGACY_V1"
    ).toBe("PROFIT_LOCK_V1");
  });
});

describe("B7 — broker-proven mutations", () => {
  it("close accepted but volume unchanged → pending, no double close", async () => {
    const doc = baseDoc({
      profitLockStage: "T1_TRIGGERED",
      currentPrice: 2361
    });
    const { deps, closes, state } = makeDeps({
      remaining: 17,
      sl: 2340,
      tp: 2380,
      bid: 2361,
      ask: 2361.2,
      closeDelayVolume: true
    });
    const first = await runDemoProfitLockPass(doc, deps);
    expect(closes.length).toBe(1);
    expect(first.doc.profitLockStage).toBe("T1_CLOSE_PENDING_RECONCILE");
    expect(first.blockedReason).toBe("CLOSE_PENDING_VOLUME_UNCHANGED");

    const second = await runDemoProfitLockPass(first.doc, deps);
    expect(closes.length).toBe(1); // no resend
    expect(second.doc.profitLockStage).toBe("T1_CLOSE_PENDING_RECONCILE");

    state.closeDelayVolume = false;
    state.remaining = 8.5; // broker now proves close
    const third = await runDemoProfitLockPass(second.doc, deps);
    expect(closes.length).toBe(1);
    expect(third.doc.profitLockStage).toBe("T1_PARTIAL_DONE_SL_PENDING");
  });

  it("post-reconcile unavailable stays pending", async () => {
    const doc = baseDoc({
      profitLockStage: "T1_CLOSE_PENDING_RECONCILE",
      pendingClose: {
        tag: "T1",
        desiredCumulativeLots: 8.5,
        requestedLots: 8.5,
        volumeUnits: 850,
        submittedAt: new Date().toISOString(),
        brokerAccepted: true
      },
      remainingLots: 17
    });
    const { deps } = makeDeps({
      remaining: 17,
      sl: 2340,
      tp: 2380,
      bid: 2361,
      ask: 2361.2,
      reconcileFail: true
    });
    const r = await runDemoProfitLockPass(doc, deps);
    expect(r.doc.profitLockStage).toBe("T1_CLOSE_PENDING_RECONCILE");
    expect(r.blockedReason).toBe("RECONCILE_FAILED");
  });

  it("SL amend accepted but old SL → pending; then confirms; TP3 loss fails", async () => {
    const doc = baseDoc({
      profitLockStage: "T1_PARTIAL_DONE_SL_PENDING",
      remainingLots: 8.5,
      lots: 17
    });
    const { deps, state } = makeDeps({
      remaining: 8.5,
      sl: 2340,
      tp: 2380,
      bid: 2361,
      ask: 2361.2,
      amendKeepOldSl: true
    });
    const pending = await runDemoProfitLockPass(doc, deps);
    expect(pending.doc.profitLockStage).toBe("BE_AMEND_PENDING_RECONCILE");
    expect(pending.blockedReason).toBe("SL_AMEND_PENDING_OLD_SL");

    state.amendKeepOldSl = false;
    state.sl = 2350;
    const ok = await runDemoProfitLockPass(pending.doc, deps);
    expect(ok.doc.profitLockStage).toBe("T1_SECURED_BE");
    expect(ok.doc.t1SecuredAfterM5BarTime).not.toBeUndefined();

    // TP3 lost
    const protectDoc = baseDoc({
      profitLockStage: "T1_CONTINUATION_CONFIRMED",
      remainingLots: 8.5,
      lots: 17,
      currentSl: 2350,
      profitLockProtectionLevel: "BE",
      t1SecuredAfterM5BarTime: 1000,
      t1ContinuationBarTime: 1300
    });
    const bad = makeDeps({
      remaining: 8.5,
      sl: 2350,
      tp: 2380,
      bid: 2362,
      ask: 2362.2,
      amendDropTp3: true,
      m5Bars: [{ time: 1300, close: 2362 }]
    });
    const lost = await runDemoProfitLockPass(protectDoc, bad.deps);
    // After amend, reconcile sees TP!=TP3
    expect(
      lost.blockedReason === "BROKER_TP3_NOT_PRESERVED" ||
        lost.doc.profitLockLastBlocker === "BROKER_TP3_NOT_PRESERVED"
    ).toBe(true);
  });

  it("T3 broker already flat → no second close", async () => {
    const doc = baseDoc({
      profitLockStage: "T2_PROTECTED",
      remainingLots: 0,
      lots: 17,
      currentSl: 2369.7,
      profitLockProtectionLevel: "TP2"
    });
    const { deps, closes } = makeDeps({
      remaining: 0,
      sl: 2369.7,
      tp: 2380,
      bid: 2381,
      ask: 2381.2
    });
    const r = await runDemoProfitLockPass(doc, deps);
    expect(closes.length).toBe(0);
    expect(r.doc.profitLockStage).toBe("CLOSE_RECONCILIATION_PENDING");
  });

  it("brokerTp3Preserved helper", () => {
    expect(
      brokerTp3Preserved({ brokerTp: 2380, expectedTp3: 2380 })
    ).toBe(true);
    expect(
      brokerTp3Preserved({ brokerTp: 2360, expectedTp3: 2380 })
    ).toBe(false);
  });
});

describe("F1 — SUBMITTING crash never auto-resends", () => {
  it("T1: crash after send / before save — old volume → ZERO second close; later proof advances", async () => {
    const doc = baseDoc({
      profitLockStage: "T1_CLOSE_SUBMITTING",
      remainingLots: 17,
      lots: 17,
      pendingClose: {
        tag: "T1",
        desiredCumulativeLots: 8.5,
        requestedLots: 8.5,
        volumeUnits: 850,
        submittedAt: new Date().toISOString(),
        brokerAccepted: null
      }
    });
    const { deps, closes, state } = makeDeps({
      remaining: 17, // lagging reconcile
      sl: 2340,
      tp: 2380,
      bid: 2361,
      ask: 2361.2
    });
    const first = await runDemoProfitLockPass(doc, deps);
    expect(closes.length).toBe(0); // never auto-resend
    expect(first.doc.profitLockStage).toBe("T1_CLOSE_PENDING_RECONCILE");
    expect(
      first.doc.profitLockLastBlocker === "AMBIGUOUS_CLOSE_SUBMISSION" ||
        first.doc.profitLockLastBlocker === "CLOSE_PENDING_VOLUME_UNCHANGED"
    ).toBe(true);

    const stillLag = await runDemoProfitLockPass(first.doc, deps);
    expect(closes.length).toBe(0);
    expect(stillLag.doc.profitLockStage).toBe("T1_CLOSE_PENDING_RECONCILE");

    state.remaining = 8.5;
    const proven = await runDemoProfitLockPass(stillLag.doc, deps);
    expect(closes.length).toBe(0);
    expect(proven.doc.profitLockStage).toBe("T1_PARTIAL_DONE_SL_PENDING");
  });

  it("T2: same at-most-once SUBMITTING recovery", async () => {
    const doc = baseDoc({
      profitLockStage: "T2_CLOSE_SUBMITTING",
      remainingLots: 8.5,
      lots: 17,
      currentSl: 2350,
      profitLockProtectionLevel: "BE",
      pendingClose: {
        tag: "T2",
        desiredCumulativeLots: 13.6,
        requestedLots: 5.1,
        volumeUnits: 510,
        submittedAt: new Date().toISOString(),
        brokerAccepted: null
      }
    });
    const { deps, closes, state } = makeDeps({
      remaining: 8.5,
      sl: 2350,
      tp: 2380,
      bid: 2371,
      ask: 2371.2
    });
    const first = await runDemoProfitLockPass(doc, deps);
    expect(closes.length).toBe(0);
    expect(first.doc.profitLockStage).toBe("T2_CLOSE_PENDING_RECONCILE");
    state.remaining = 3.4;
    const proven = await runDemoProfitLockPass(first.doc, deps);
    expect(closes.length).toBe(0);
    expect(proven.doc.profitLockStage).toBe("T2_PARTIAL_DONE");
  });

  it("crash BEFORE send: SUBMITTING + brokerAccepted=null stays reconcile-only, never duplicates", async () => {
    // Persisted SUBMITTING before broker request completed — same ambiguous
    // window as crash-after-send; at-most-once forbids any closePosition call.
    const doc = baseDoc({
      profitLockStage: "T1_CLOSE_SUBMITTING",
      remainingLots: 17,
      lots: 17,
      pendingClose: {
        tag: "T1",
        desiredCumulativeLots: 8.5,
        requestedLots: 8.5,
        volumeUnits: 850,
        submittedAt: new Date().toISOString(),
        brokerAccepted: null
      }
    });
    const { deps, closes } = makeDeps({
      remaining: 17,
      sl: 2340,
      tp: 2380,
      bid: 2361,
      ask: 2361.2
    });
    const r1 = await runDemoProfitLockPass(doc, deps);
    const r2 = await runDemoProfitLockPass(r1.doc, deps);
    expect(closes.length).toBe(0);
    expect(r2.doc.profitLockStage).toBe("T1_CLOSE_PENDING_RECONCILE");
    expect(r2.mutations.partialCloses).toBe(0);
  });
});

describe("F2 — slDistance=0 does not freeze T1→T2", () => {
  it("BUY: T1 50% → BE → fresh cont → skip ratchet → TP2 still closes to 80%", async () => {
    const securedAt = new Date(Date.now() - 60_000).toISOString();
    const freshBar = Math.floor(Date.parse(securedAt) / 1000) + 120;
    // Start at T1_CONTINUATION_CONFIRMED with Pepperstone zero slDistance
    let doc = baseDoc({
      profitLockStage: "T1_CONTINUATION_CONFIRMED",
      remainingLots: 8.5,
      lots: 17,
      currentSl: 2350,
      profitLockProtectionLevel: "BE",
      t1SecuredAt: securedAt,
      t1SecuredAfterM5BarTime: freshBar - 300,
      t1ContinuationBarTime: freshBar
    });
    const { deps, closes, state } = makeDeps({
      remaining: 8.5,
      sl: 2350,
      tp: 2380,
      bid: 2362,
      ask: 2362.2,
      symbol: symbolPepperstoneZeroSl(),
      m5Bars: [{ time: freshBar, close: 2362 }]
    });
    const skip = await runDemoProfitLockPass(doc, deps);
    expect(skip.doc.profitLockStage).toBe("T1_PROTECTED");
    expect(skip.doc.profitLockProtectionLevel).toBe("BE"); // not falsely TP1
    expect(skip.doc.profitLockLastBlocker).toBe(
      "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE"
    );
    expect(skip.doc.currentSl).toBe(2350);

    // TP2 touch via BID
    state.bid = 2370;
    state.ask = 2370.2;
    doc = skip.doc;
    const t2trig = await runDemoProfitLockPass(doc, deps);
    expect(t2trig.doc.profitLockStage).toBe("T2_TRIGGERED");

    const t2close = await runDemoProfitLockPass(t2trig.doc, deps);
    // close requested then pending — force proof
    if (t2close.doc.profitLockStage === "T2_CLOSE_PENDING_RECONCILE") {
      state.remaining = 3.4;
      const proven = await runDemoProfitLockPass(t2close.doc, deps);
      expect(proven.doc.profitLockStage).toBe("T2_PARTIAL_DONE");
      expect(proven.doc.cumulativeClosedLots).toBeCloseTo(13.6, 5);
    } else {
      expect(closes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("SELL evaluator: ratchet skip keeps protectionLevel and advances", () => {
    const a = evaluateProfitLock({
      side: "SELL",
      stage: "T1_CONTINUATION_CONFIRMED",
      protectionLevel: "BE",
      entry: 2380,
      currentSl: 2380,
      tp1: 2370,
      tp2: 2360,
      tp3: 2350,
      brokerHardTakeProfit: 2350,
      originalLots: 10,
      brokerRemainingLots: 5,
      targetTouchPrice: 2365,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: true,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: 1,
      volumeRules: FINE_RULES,
      stopBuffer: {
        rawSlDistance: 0,
        distanceSetIn: 1,
        digits: 2,
        spread: 0.1,
        tickSize: 0.01
      }
    });
    expect(a.type).toBe("ADVANCE_STAGE");
    if (a.type === "ADVANCE_STAGE") {
      expect(a.nextStage).toBe("T1_PROTECTED");
      expect(a.nextProtection).toBe("BE");
      expect(a.reason).toBe("T1_RATCHET_SKIPPED_KEEP_BE");
    }
  });
});

describe("ladder design still approved", () => {
  it("cumulative 50/80 original; SL never backwards; TP3 on amend", () => {
    expect(desiredCumulativeCloseLots(17, 0.5)).toBe(8.5);
    expect(desiredCumulativeCloseLots(17, 0.8)).toBe(13.6);
    const t1 = planT1PartialClose({
      originalLots: 17,
      brokerRemainingLots: 17,
      rules: FINE_RULES
    });
    expect(t1.kind).toBe("CLOSE");
    expect(
      isStopImprovement({ side: "BUY", currentSl: 2359.7, proposedSl: 2350 })
    ).toBe(false);
    expect(
      brokerHardTakeProfitForAmend({ tp3: 2380, brokerHardTakeProfit: 2380 })
    ).toBe(2380);
  });

  it("BUY evaluator path T1→partial→BE", () => {
    const a = evaluateProfitLock({
      side: "BUY",
      stage: "OPEN",
      protectionLevel: "NONE",
      entry: 2350,
      currentSl: 2340,
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      brokerHardTakeProfit: 2380,
      originalLots: 10,
      brokerRemainingLots: 10,
      targetTouchPrice: 2360,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: false,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(a.type).toBe("ADVANCE_STAGE");
    const p = evaluateProfitLock({
      side: "BUY",
      stage: "T1_TRIGGERED",
      protectionLevel: "NONE",
      entry: 2350,
      currentSl: 2340,
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      brokerHardTakeProfit: 2380,
      originalLots: 10,
      brokerRemainingLots: 10,
      targetTouchPrice: 2360,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: false,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(p.type).toBe("PARTIAL_CLOSE");
    if (p.type === "PARTIAL_CLOSE") {
      expect(p.lots).toBe(5);
      expect(p.submittingStage).toBe("T1_CLOSE_SUBMITTING");
    }
  });

  it("SELL evaluator T1 partial + BE preserves TP3", () => {
    const be = evaluateProfitLock({
      side: "SELL",
      stage: "T1_PARTIAL_DONE_SL_PENDING",
      protectionLevel: "NONE",
      entry: 2380,
      currentSl: 2390,
      tp1: 2370,
      tp2: 2360,
      tp3: 2350,
      brokerHardTakeProfit: 2350,
      originalLots: 10,
      brokerRemainingLots: 5,
      targetTouchPrice: 2369,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: false,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(be.type).toBe("AMEND_SL");
    if (be.type === "AMEND_SL") {
      expect(be.stopLoss).toBe(2380);
      expect(be.takeProfit).toBe(2350);
      expect(be.pendingStage).toBe("BE_AMEND_PENDING_RECONCILE");
    }
  });

  it("volume rounding + below-min skip", () => {
    const t2 = planT2PartialClose({
      originalLots: 0.02,
      brokerRemainingLots: 0.01,
      rules: FINE_RULES
    });
    expect(t2.kind).toBe("SKIP_INVALID");
  });

  it("Live ZERO mutations + flag default false", async () => {
    expect(defaultUserAutoTradeSettings("u", "demo").demoProfitLockLadderEnabled).toBe(
      false
    );
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
    const { deps, closes, amends } = makeDeps({
      remaining: 17,
      sl: 2340,
      tp: 2380,
      bid: 2361,
      ask: 2361.2,
      liveAccount: true
    });
    const r = await runDemoProfitLockPass(
      baseDoc({ profitLockStage: "T1_TRIGGERED" }),
      deps
    );
    expect(closes.length).toBe(0);
    expect(amends.length).toBe(0);
    expect(r.blockedReason).toBe("LIVE_ACCOUNT_MUTATION_DENIED");
  });

  it("ACTIVE_DEMO thresholds unchanged", async () => {
    const {
      loadDemoOpportunityConfig,
      classifyDemoSetupTier,
      demoRiskMultiplier
    } = await import(
      "../../../../src/services/broker/ctrader/demoOpportunityEngine"
    );
    const cfg = loadDemoOpportunityConfig();
    expect(cfg.aPlusMinScore).toBe(90);
    expect(cfg.aMinScore).toBe(80);
    expect(cfg.armedConfirmationBars5m).toBe(3);
    expect(cfg.asiaExperimentalEnabled).toBe(true);
    expect(classifyDemoSetupTier(90, cfg)).toBe("A_PLUS");
    expect(demoRiskMultiplier({ tier: "A", session: "Asia", config: cfg })).toBe(
      0.5
    );
  });
});
