/**
 * Deterministic Demo T1/T2/T3 profit-lock ladder tests.
 * Covers BUY/SELL ladders, restart safety, volume rounding, Live zero-mutation,
 * TP3 preservation, irreversible stops, and feature-flag default.
 */

import { describe, expect, it, vi } from "vitest";
import {
  evaluateProfitLock,
  m5CloseConfirmsContinuation
} from "../../../../src/services/broker/ctrader/demoProfitLockEvaluate";
import {
  computeBrokerSafeStopBuffer,
  brokerHardTakeProfitForAmend,
  isStopImprovement,
  proposeProtectedStop,
  selectStopIfImproved
} from "../../../../src/services/broker/ctrader/demoProfitLockStops";
import {
  planT1PartialClose,
  planT2PartialClose,
  planRemainderClose,
  desiredCumulativeCloseLots
} from "../../../../src/services/broker/ctrader/demoProfitLockVolume";
import {
  runDemoProfitLockPass,
  type ProfitLockDeps
} from "../../../../src/services/broker/ctrader/demoProfitLockManager";
import { isDemoProfitLockLadderEnabled } from "../../../../src/services/broker/ctrader/demoProfitLockFlag";
import { filterCompletedM5Bars } from "../../../../src/services/broker/ctrader/demoProfitLockCandles";
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

const FINE_RULES = { minLots: 0.01, maxLots: 100, stepLots: 0.01 };
const COARSE_RULES = { minLots: 1, maxLots: 100, stepLots: 1 };

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
    guaranteedStopAvailable: null,
    tradingScheduleId: null,
    metadataComplete: true,
    missingFields: []
  };
}

function pos(lots: number, sl: number | null = 2340, tp: number | null = 2380): BrokerOpenPosition {
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

function makeDeps(state: {
  remaining: number;
  sl: number | null;
  tp: number | null;
  price: number;
  m5Close?: number | null;
  liveAccount?: boolean;
  closeImpl?: ProfitLockDeps["closePosition"];
  amendImpl?: ProfitLockDeps["amendStopLoss"];
}): {
  deps: ProfitLockDeps;
  closes: Array<{ volumeUnits: number }>;
  amends: Array<{ stopLoss: number; takeProfit?: number | null }>;
  saved: DemoPositionLifecycle[];
} {
  const closes: Array<{ volumeUnits: number }> = [];
  const amends: Array<{ stopLoss: number; takeProfit?: number | null }> = [];
  const saved: DemoPositionLifecycle[] = [];
  let remaining = state.remaining;
  let sl = state.sl;
  let tp = state.tp;

  const deps: ProfitLockDeps = {
    reconcilePositions: async () =>
      remaining > 1e-8 ? [pos(remaining, sl, tp)] : [],
    amendStopLoss: state.amendImpl
      ?? (async (args) => {
        amends.push({ stopLoss: args.stopLoss, takeProfit: args.takeProfit });
        sl = args.stopLoss;
        if (args.takeProfit != null) tp = args.takeProfit;
        return { accepted: true };
      }),
    closePosition:
      state.closeImpl ??
      (async (args) => {
        closes.push({ volumeUnits: args.volumeUnits });
        remaining = Number(
          (remaining - args.volumeUnits / 100).toFixed(8)
        );
        return { accepted: true };
      }),
    loadSymbol: async () => symbolFine(),
    getQuote: async () => ({
      symbolId: "41",
      symbolName: "XAUUSD",
      bid: state.price - 0.05,
      ask: state.price + 0.05,
      spread: 0.1,
      timestamp: new Date().toISOString(),
      marketStatus: "OPEN",
      stale: false,
      source: "LIVE"
    }),
    getCompletedM5Bars: async () =>
      state.m5Close == null
        ? []
        : [
            {
              time: Math.floor(Date.now() / 1000) - 600,
              open: state.m5Close,
              high: state.m5Close,
              low: state.m5Close,
              close: state.m5Close,
              volume: 1
            }
          ],
    isSelectedAccountLive: async () => Boolean(state.liveAccount),
    save: async (doc) => {
      saved.push(doc);
    }
  };
  return { deps, closes, amends, saved };
}

describe("demo profit-lock volume accounting", () => {
  it("H: uses cumulative 50/80 of ORIGINAL lots (not half remaining)", () => {
    expect(desiredCumulativeCloseLots(17, 0.5)).toBe(8.5);
    expect(desiredCumulativeCloseLots(17, 0.8)).toBe(13.6);
    const t1 = planT1PartialClose({
      originalLots: 17,
      brokerRemainingLots: 17,
      rules: FINE_RULES
    });
    expect(t1.kind).toBe("CLOSE");
    if (t1.kind === "CLOSE") {
      expect(t1.roundedLots).toBe(8.5);
      expect(t1.orderVolumeUnits).toBe(850);
    }
    const t2 = planT2PartialClose({
      originalLots: 17,
      brokerRemainingLots: 8.5,
      rules: FINE_RULES
    });
    expect(t2.kind).toBe("CLOSE");
    if (t2.kind === "CLOSE") {
      expect(t2.desiredCumulativeLots).toBe(13.6);
      expect(t2.roundedLots).toBe(5.1);
    }
  });

  it("H: broker volume-step rounding (coarse 1.0 lot step)", () => {
    const t1 = planT1PartialClose({
      originalLots: 3,
      brokerRemainingLots: 3,
      rules: COARSE_RULES
    });
    expect(t1.kind).toBe("CLOSE");
    if (t1.kind === "CLOSE") {
      // 50% of 3 = 1.5 → round down to 1.0
      expect(t1.roundedLots).toBe(1);
    }
  });

  it("I: small position where 30% is below min volume — no invalid request", () => {
    const t2 = planT2PartialClose({
      originalLots: 0.02,
      brokerRemainingLots: 0.01, // after T1 of 0.01
      rules: { minLots: 0.01, maxLots: 100, stepLots: 0.01 }
    });
    // desired cumulative 0.016; already closed 0.01; additional 0.006 → below min
    expect(t2.kind).toBe("SKIP_INVALID");
    if (t2.kind === "SKIP_INVALID") {
      expect(t2.reason).toMatch(/VOLUME_BELOW_MINIMUM/);
    }
  });

  it("restart: already satisfied cumulative does not request another close", () => {
    const t1 = planT1PartialClose({
      originalLots: 17,
      brokerRemainingLots: 8.5,
      rules: FINE_RULES
    });
    expect(t1.kind).toBe("ALREADY_SATISFIED");
  });
});

describe("demo profit-lock stops", () => {
  it("10/11: buffer from broker constraints; SL never backwards; preserve TP3", () => {
    const buffer = computeBrokerSafeStopBuffer({
      minStopDistance: 0.3,
      spread: 0.1,
      tickSize: 0.01,
      digits: 2
    });
    expect(buffer).toBe(0.3);
    const buySl = proposeProtectedStop({ side: "BUY", level: 2360, buffer: buffer! });
    expect(buySl).toBeCloseTo(2359.7, 5);
    expect(
      isStopImprovement({ side: "BUY", currentSl: 2350, proposedSl: buySl })
    ).toBe(true);
    expect(
      selectStopIfImproved({
        side: "BUY",
        currentSl: 2359.7,
        proposedSl: 2350
      })
    ).toBeNull();
    expect(
      brokerHardTakeProfitForAmend({ tp3: 2380, brokerHardTakeProfit: 2380 })
    ).toBe(2380);
    expect(brokerHardTakeProfitForAmend({ tp3: null })).toBeUndefined();
  });

  it("J: SELL irreversible stop mirrors BUY", () => {
    expect(
      isStopImprovement({ side: "SELL", currentSl: 2360, proposedSl: 2355 })
    ).toBe(true);
    expect(
      isStopImprovement({ side: "SELL", currentSl: 2355, proposedSl: 2360 })
    ).toBe(false);
  });
});

describe("demo profit-lock evaluator", () => {
  const stopBuffer = {
    minStopDistance: 0.3,
    spread: 0.1,
    tickSize: 0.01,
    digits: 2
  };

  it("A: BUY full ladder stages through T3 remainder", () => {
    let stage = "OPEN" as const;
    const run = (over: Partial<Parameters<typeof evaluateProfitLock>[0]>) =>
      evaluateProfitLock({
        side: "BUY",
        stage,
        protectionLevel: "NONE",
        entry: 2350,
        currentSl: 2340,
        tp1: 2360,
        tp2: 2370,
        tp3: 2380,
        brokerHardTakeProfit: 2380,
        originalLots: 10,
        brokerRemainingLots: 10,
        currentPrice: 2350,
        brokerPositionOpen: true,
        m5ContinuationBeyondTp1: false,
        m5ContinuationBeyondTp2: false,
        completedM5BarTime: null,
        t1ContinuationBarTime: null,
        t2ContinuationBarTime: null,
        volumeRules: FINE_RULES,
        stopBuffer,
        ...over
      });

    let a = run({ currentPrice: 2360 });
    expect(a.type).toBe("ADVANCE_STAGE");
    if (a.type === "ADVANCE_STAGE") stage = a.nextStage as typeof stage;

    a = run({ stage: "T1_TRIGGERED", currentPrice: 2360, brokerRemainingLots: 10 });
    expect(a.type).toBe("PARTIAL_CLOSE");
    if (a.type === "PARTIAL_CLOSE") {
      expect(a.tag).toBe("T1");
      expect(a.lots).toBe(5);
      stage = a.nextStage as typeof stage;
    }

    a = run({
      stage: "T1_PARTIAL_DONE_SL_PENDING",
      brokerRemainingLots: 5,
      currentSl: 2340
    });
    expect(a.type).toBe("AMEND_SL");
    if (a.type === "AMEND_SL") {
      expect(a.stopLoss).toBe(2350);
      expect(a.takeProfit).toBe(2380);
      stage = a.nextStage as typeof stage;
    }

    a = run({
      stage: "T1_SECURED_BE",
      brokerRemainingLots: 5,
      currentSl: 2350,
      protectionLevel: "BE",
      m5ContinuationBeyondTp1: false
    });
    expect(a.type).toBe("NONE");
    expect(a.type === "NONE" && a.reason).toBe("WAITING_T1_CONTINUATION_5M");

    a = run({
      stage: "T1_SECURED_BE",
      brokerRemainingLots: 5,
      currentSl: 2350,
      protectionLevel: "BE",
      m5ContinuationBeyondTp1: true,
      completedM5BarTime: 100
    });
    expect(a.type).toBe("ADVANCE_STAGE");

    a = run({
      stage: "T1_CONTINUATION_CONFIRMED",
      brokerRemainingLots: 5,
      currentSl: 2350,
      protectionLevel: "BE"
    });
    expect(a.type).toBe("AMEND_SL");
    if (a.type === "AMEND_SL") {
      expect(a.stopLoss).toBeCloseTo(2359.7, 5);
      expect(a.takeProfit).toBe(2380);
    }

    a = run({
      stage: "T1_PROTECTED",
      brokerRemainingLots: 5,
      currentSl: 2359.7,
      currentPrice: 2370,
      protectionLevel: "TP1"
    });
    expect(a.type).toBe("ADVANCE_STAGE");

    a = run({
      stage: "T2_TRIGGERED",
      brokerRemainingLots: 5,
      currentPrice: 2370
    });
    expect(a.type).toBe("PARTIAL_CLOSE");
    if (a.type === "PARTIAL_CLOSE") {
      expect(a.tag).toBe("T2");
      expect(a.lots).toBe(3); // 80% of 10 = 8; already 5 closed → +3
    }

    a = run({
      stage: "T2_PARTIAL_DONE",
      brokerRemainingLots: 2,
      currentSl: 2359.7,
      protectionLevel: "TP1"
    });
    expect(a.type).toBe("ADVANCE_STAGE"); // already protected near TP1

    a = run({
      stage: "T2_SECURED",
      brokerRemainingLots: 2,
      m5ContinuationBeyondTp2: true,
      completedM5BarTime: 200
    });
    expect(a.type).toBe("ADVANCE_STAGE");

    a = run({
      stage: "T2_CONTINUATION_CONFIRMED",
      brokerRemainingLots: 2,
      currentSl: 2359.7,
      protectionLevel: "TP1"
    });
    expect(a.type).toBe("AMEND_SL");
    if (a.type === "AMEND_SL") {
      expect(a.stopLoss).toBeCloseTo(2369.7, 5);
      expect(a.takeProfit).toBe(2380);
    }

    a = run({
      stage: "T2_PROTECTED",
      brokerRemainingLots: 2,
      currentPrice: 2380,
      currentSl: 2369.7
    });
    expect(a.type).toBe("ADVANCE_STAGE");

    a = run({
      stage: "T3_TRIGGERED",
      brokerRemainingLots: 2,
      currentPrice: 2381
    });
    expect(a.type).toBe("PARTIAL_CLOSE");
    if (a.type === "PARTIAL_CLOSE") expect(a.tag).toBe("T3_REMAINDER");
  });

  it("B: SELL mirrored ladder T1 partial + BE + TP3 preserve", () => {
    const a = evaluateProfitLock({
      side: "SELL",
      stage: "T1_TRIGGERED",
      protectionLevel: "NONE",
      entry: 2380,
      currentSl: 2390,
      tp1: 2370,
      tp2: 2360,
      tp3: 2350,
      brokerHardTakeProfit: 2350,
      originalLots: 10,
      brokerRemainingLots: 10,
      currentPrice: 2369,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: false,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      t1ContinuationBarTime: null,
      t2ContinuationBarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(a.type).toBe("PARTIAL_CLOSE");

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
      currentPrice: 2369,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: false,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      t1ContinuationBarTime: null,
      t2ContinuationBarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(be.type).toBe("AMEND_SL");
    if (be.type === "AMEND_SL") {
      expect(be.stopLoss).toBe(2380);
      expect(be.takeProfit).toBe(2350);
    }

    expect(
      m5CloseConfirmsContinuation({
        side: "SELL",
        completedClose: 2369,
        level: 2370
      })
    ).toBe(true);
  });

  it("C/D: repeated T1/T2 evaluation does not re-partial after stage advance", () => {
    const t1Done = evaluateProfitLock({
      side: "BUY",
      stage: "T1_PARTIAL_DONE_SL_PENDING",
      protectionLevel: "NONE",
      entry: 2350,
      currentSl: 2340,
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      brokerHardTakeProfit: 2380,
      originalLots: 10,
      brokerRemainingLots: 5,
      currentPrice: 2365,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: false,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      t1ContinuationBarTime: null,
      t2ContinuationBarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(t1Done.type).toBe("AMEND_SL");

    const t2Done = evaluateProfitLock({
      side: "BUY",
      stage: "T2_PARTIAL_DONE",
      protectionLevel: "TP1",
      entry: 2350,
      currentSl: 2359.7,
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      brokerHardTakeProfit: 2380,
      originalLots: 10,
      brokerRemainingLots: 2,
      currentPrice: 2375,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: true,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      t1ContinuationBarTime: null,
      t2ContinuationBarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(t2Done.type).not.toBe("PARTIAL_CLOSE");
  });

  it("L: broker already flat — reconcile, no second close", () => {
    const a = evaluateProfitLock({
      side: "BUY",
      stage: "T2_PROTECTED",
      protectionLevel: "TP2",
      entry: 2350,
      currentSl: 2369.7,
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      brokerHardTakeProfit: 2380,
      originalLots: 10,
      brokerRemainingLots: 0,
      currentPrice: 2381,
      brokerPositionOpen: false,
      m5ContinuationBeyondTp1: true,
      m5ContinuationBeyondTp2: true,
      completedM5BarTime: null,
      t1ContinuationBarTime: null,
      t2ContinuationBarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(a.type).toBe("RECONCILE_CLOSED");
  });

  it("M/N: reverse before continuation keeps BE; continuation advances to T1 protect", () => {
    const wait = evaluateProfitLock({
      side: "BUY",
      stage: "T1_SECURED_BE",
      protectionLevel: "BE",
      entry: 2350,
      currentSl: 2350,
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      brokerHardTakeProfit: 2380,
      originalLots: 10,
      brokerRemainingLots: 5,
      currentPrice: 2355,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: false,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: null,
      t1ContinuationBarTime: null,
      t2ContinuationBarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(wait.type).toBe("NONE");

    const cont = evaluateProfitLock({
      side: "BUY",
      stage: "T1_CONTINUATION_CONFIRMED",
      protectionLevel: "BE",
      entry: 2350,
      currentSl: 2350,
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      brokerHardTakeProfit: 2380,
      originalLots: 10,
      brokerRemainingLots: 5,
      currentPrice: 2362,
      brokerPositionOpen: true,
      m5ContinuationBeyondTp1: true,
      m5ContinuationBeyondTp2: false,
      completedM5BarTime: 1,
      t1ContinuationBarTime: 1,
      t2ContinuationBarTime: null,
      volumeRules: FINE_RULES,
      stopBuffer
    });
    expect(cont.type).toBe("AMEND_SL");
  });
});

describe("demo profit-lock manager orchestration", () => {
  it("E: restart after T1 broker partial before Firestore — no duplicate close", async () => {
    // Simulate crash: broker already at 8.5 remaining, stage still T1_TRIGGERED
    const doc = baseDoc({
      profitLockStage: "T1_TRIGGERED",
      remainingLots: 17,
      currentPrice: 2361
    });
    const { deps, closes, saved } = makeDeps({
      remaining: 8.5,
      sl: 2340,
      tp: 2380,
      price: 2361
    });
    const result = await runDemoProfitLockPass(doc, deps);
    expect(closes.length).toBe(0);
    expect(result.doc.profitLockStage).toBe("T1_PARTIAL_DONE_SL_PENDING");
    expect(saved.length).toBeGreaterThan(0);
  });

  it("F: restart after T2 broker partial — no duplicate close", async () => {
    const doc = baseDoc({
      profitLockStage: "T2_TRIGGERED",
      remainingLots: 8.5,
      lots: 17,
      currentSl: 2359.7,
      profitLockProtectionLevel: "TP1",
      currentPrice: 2371
    });
    const { deps, closes } = makeDeps({
      remaining: 3.4, // already closed to ~80%
      sl: 2359.7,
      tp: 2380,
      price: 2371
    });
    const result = await runDemoProfitLockPass(doc, deps);
    expect(closes.length).toBe(0);
    expect(result.doc.profitLockStage).toBe("T2_PARTIAL_DONE");
  });

  it("G: T1 partial succeeds but BE amend fails — only BE retries", async () => {
    let remaining = 17;
    const closes: number[] = [];
    const amends: number[] = [];
    const doc = baseDoc({
      profitLockStage: "T1_TRIGGERED",
      currentPrice: 2361
    });
    const deps: ProfitLockDeps = {
      reconcilePositions: async () =>
        remaining > 0 ? [pos(remaining, 2340, 2380)] : [],
      closePosition: async (args) => {
        closes.push(args.volumeUnits);
        remaining = Number((remaining - args.volumeUnits / 100).toFixed(8));
        return { accepted: true };
      },
      amendStopLoss: async () => {
        amends.push(1);
        throw new Error("AMEND_TIMEOUT");
      },
      loadSymbol: async () => symbolFine(),
      getQuote: async () => ({
        symbolId: "41",
        symbolName: "XAUUSD",
        bid: 2360.9,
        ask: 2361.1,
        spread: 0.2,
        timestamp: new Date().toISOString(),
        marketStatus: "OPEN",
        stale: false,
        source: "LIVE"
      }),
      getCompletedM5Bars: async () => [],
      isSelectedAccountLive: async () => false,
      save: async () => undefined
    };

    const first = await runDemoProfitLockPass(doc, deps);
    expect(closes.length).toBe(1);
    expect(first.doc.profitLockStage).toBe("T1_PARTIAL_DONE_SL_PENDING");

    const second = await runDemoProfitLockPass(first.doc, deps);
    expect(closes.length).toBe(1); // no second partial
    expect(amends.length).toBeGreaterThanOrEqual(1);
    expect(second.doc.profitLockStage).toBe("T1_PARTIAL_DONE_SL_PENDING");
  });

  it("K: SL amend preserves TP3 (never TP1)", async () => {
    const doc = baseDoc({
      profitLockStage: "T1_PARTIAL_DONE_SL_PENDING",
      remainingLots: 8.5,
      lots: 17,
      currentPrice: 2361
    });
    const { deps, amends } = makeDeps({
      remaining: 8.5,
      sl: 2340,
      tp: 2380,
      price: 2361
    });
    await runDemoProfitLockPass(doc, deps);
    expect(amends.length).toBe(1);
    expect(amends[0].stopLoss).toBe(2350);
    expect(amends[0].takeProfit).toBe(2380);
  });

  it("P: Live account → ZERO mutations", async () => {
    const doc = baseDoc({
      profitLockStage: "T1_TRIGGERED",
      currentPrice: 2361
    });
    const { deps, closes, amends } = makeDeps({
      remaining: 17,
      sl: 2340,
      tp: 2380,
      price: 2361,
      liveAccount: true
    });
    const result = await runDemoProfitLockPass(doc, deps);
    expect(closes.length).toBe(0);
    expect(amends.length).toBe(0);
    expect(result.mutations).toEqual({
      partialCloses: 0,
      slAmends: 0,
      tpAmends: 0,
      positionCloses: 0
    });
    expect(result.blockedReason).toBe("LIVE_ACCOUNT_MUTATION_DENIED");
  });

  it("O: T2 continuation advances SL near TP2 with TP3 preserved", async () => {
    const doc = baseDoc({
      profitLockStage: "T2_CONTINUATION_CONFIRMED",
      remainingLots: 3.4,
      lots: 17,
      currentSl: 2359.7,
      profitLockProtectionLevel: "TP1",
      currentPrice: 2375
    });
    const { deps, amends } = makeDeps({
      remaining: 3.4,
      sl: 2359.7,
      tp: 2380,
      price: 2375,
      m5Close: 2375
    });
    const result = await runDemoProfitLockPass(doc, deps);
    expect(amends.length).toBe(1);
    expect(amends[0].takeProfit).toBe(2380);
    expect(amends[0].stopLoss).toBeGreaterThan(2359.7);
    expect(result.doc.profitLockStage).toBe("T2_PROTECTED");
  });
});

describe("demo profit-lock feature flag + hard locks", () => {
  it("Q: feature flag defaults FALSE", () => {
    const demo = defaultUserAutoTradeSettings("u1", "demo");
    expect(demo.demoProfitLockLadderEnabled).toBe(false);
    expect(isDemoProfitLockLadderEnabled(demo)).toBe(false);
    const live = defaultUserAutoTradeSettings("u1", "live");
    expect(live.demoProfitLockLadderEnabled).toBe(false);
    expect(
      isDemoProfitLockLadderEnabled({
        environment: "live",
        demoProfitLockLadderEnabled: true
      })
    ).toBe(false);
  });

  it("Live hard locks remain false", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
  });

  it("R: ACTIVE_DEMO entry thresholds unchanged in opportunity engine constants", async () => {
    const {
      loadDemoOpportunityConfig,
      classifyDemoSetupTier,
      demoRiskMultiplier
    } = await import(
      "../../../../src/services/broker/ctrader/demoOpportunityEngine"
    );
    const cfg = loadDemoOpportunityConfig();
    expect(cfg.armedConfirmationBars5m).toBe(3);
    expect(cfg.asiaExperimentalEnabled).toBe(true);
    expect(cfg.riskMultiplierAPlusMajor).toBe(1);
    expect(cfg.riskMultiplierAMajor).toBe(0.75);
    expect(cfg.riskMultiplierAsia).toBe(0.5);
    expect(cfg.aPlusMinScore).toBe(90);
    expect(cfg.aMinScore).toBe(80);
    expect(classifyDemoSetupTier(90, cfg)).toBe("A_PLUS");
    expect(classifyDemoSetupTier(80, cfg)).toBe("A");
    expect(classifyDemoSetupTier(79, cfg)).toBe("BELOW");
    expect(
      demoRiskMultiplier({
        tier: "A_PLUS",
        session: "London",
        config: cfg
      })
    ).toBe(1);
    expect(
      demoRiskMultiplier({
        tier: "A",
        session: "NewYork",
        config: cfg
      })
    ).toBe(0.75);
    expect(
      demoRiskMultiplier({
        tier: "A",
        session: "Asia",
        config: cfg
      })
    ).toBe(0.5);
  });

  it("completed M5 filter excludes forming bar", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const bars = filterCompletedM5Bars(
      [
        {
          time: nowSec - 600,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1
        },
        {
          time: nowSec - 60,
          open: 2,
          high: 2,
          low: 2,
          close: 2,
          volume: 1
        }
      ],
      Date.now()
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(1);
  });
});

describe("demo profit-lock remainder close", () => {
  it("plans T3 remainder safely", () => {
    const rem = planRemainderClose({
      brokerRemainingLots: 3.4,
      rules: FINE_RULES
    });
    expect(rem.kind).toBe("CLOSE");
    if (rem.kind === "CLOSE") {
      expect(rem.roundedLots).toBe(3.4);
      expect(rem.orderVolumeUnits).toBe(340);
    }
  });
});
