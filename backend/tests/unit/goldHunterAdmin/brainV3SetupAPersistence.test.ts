import { describe, expect, it } from "vitest";
import {
  GOLD_HUNTER_BRAIN_REVISION,
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_STRATEGY_VARIANT,
  M1CandleFlowEngine,
  M1CandleTracker,
  defaultGhFastConfig,
  getFrozenGhFastIdentity,
  openGhAbcTrade,
  evaluateGhAbcOpenExit,
  resetFrozenGhFastIdentityForTests,
  updateGhAbcOpenTrade
} from "../../../src/services/goldHunterAdmin/abc";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import { GoldHunterStrategySelector } from "../../../src/services/goldHunterAdmin/strategySelector";

const CANDLE_MS = 60_000;
const BASE_MS = Math.floor(1_720_000_000_000 / CANDLE_MS) * CANDLE_MS;

function depth(over: Partial<DepthBookStats> = {}): DepthBookStats {
  return {
    available: true,
    topBidDepth: 12,
    topAskDepth: 12,
    bidDepthN: 12,
    askDepthN: 12,
    bidLevels: 4,
    askLevels: 4,
    depthRatio: 1,
    depthImbalance: 0.2,
    weightedImbalance: 0.2,
    liquidityAddedBid: 0,
    liquidityAddedAsk: 0,
    liquidityRemovedBid: 0,
    liquidityRemovedAsk: 0,
    addRateBid: 0,
    addRateAsk: 0,
    removeRateBid: 1,
    removeRateAsk: 3,
    bestBid: 0,
    bestAsk: 0,
    spread: 0.12,
    crossed: false,
    lastUpdateMs: BASE_MS,
    lastValidBookMs: BASE_MS,
    consecutiveInvalidSnapshots: 0,
    bookGeneration: 1,
    resyncCount: 0,
    deleteHits: 0,
    ...over
  };
}

function features(
  mid: number,
  side: "BUY" | "SELL",
  over: Partial<GhFastFeatureSnapshot> = {}
): GhFastFeatureSnapshot {
  const bid = mid - 0.06;
  const ask = mid + 0.06;
  const buy = side === "BUY";
  return {
    bid,
    ask,
    mid,
    spread: 0.12,
    bidVel250: 0,
    bidVel500: 0,
    bidVel1s: 0,
    bidVel2s: 0,
    bidVel3s: 0,
    askVel1s: 0,
    midVel250: buy ? 0.0003 : -0.0003,
    midVel500: buy ? 0.00028 : -0.00028,
    midVel1s: buy ? 0.00034 : -0.00034,
    midVel2s: 0,
    midVel3s: 0,
    acceleration: buy ? 0.00012 : -0.00012,
    updateRate1s: 14,
    signedImbalance1s: buy ? 0.35 : -0.35,
    efficiency1s: 0.65,
    efficiency3s: 0.6,
    high1s: ask,
    low1s: bid,
    high2s: ask,
    low2s: bid,
    high5s: ask + 0.25,
    low5s: bid - 0.25,
    high10s: ask + 0.28,
    low10s: bid - 0.28,
    high15s: ask + 0.3,
    low15s: bid - 0.3,
    high30s: ask + 0.32,
    low30s: bid - 0.32,
    priorHigh5s: ask,
    priorLow5s: bid,
    priorHigh10s: ask,
    priorLow10s: bid,
    distHigh1s: 0,
    distLow1s: 0,
    distHigh5s: 0,
    distLow5s: 0,
    distPriorHigh5s: 0,
    distPriorLow5s: 0,
    upTouches5s: 0,
    downTouches5s: 0,
    depth: depth(
      buy
        ? {
            depthImbalance: 0.22,
            removeRateAsk: 3,
            removeRateBid: 1,
            bestBid: bid,
            bestAsk: ask,
            spread: 0.12
          }
        : {
            depthImbalance: -0.22,
            removeRateAsk: 1,
            removeRateBid: 3,
            bestBid: bid,
            bestAsk: ask,
            spread: 0.12
          }
    ),
    ...over
  };
}

function feedCandle(
  engine: M1CandleFlowEngine,
  minuteIndex: number,
  points: [number, number, number, number]
) {
  const start = BASE_MS + minuteIndex * CANDLE_MS;
  engine.onSpot(start, points[0]);
  engine.onSpot(start + 15_000, points[1]);
  engine.onSpot(start + 30_000, points[2]);
  engine.onSpot(start + 59_000, points[3]);
}

function primeTrend(engine: M1CandleFlowEngine, side: "BUY" | "SELL") {
  if (side === "BUY") {
    feedCandle(engine, 0, [100.0, 100.8, 99.8, 100.6]);
    feedCandle(engine, 1, [100.6, 101.5, 100.4, 101.2]);
    feedCandle(engine, 2, [101.2, 102.3, 101.0, 102.0]);
    feedCandle(engine, 3, [102.0, 103.3, 101.8, 102.9]);
    feedCandle(engine, 4, [102.9, 104.1, 102.8, 103.8]);
    feedCandle(engine, 5, [103.8, 105.1, 103.6, 104.9]);
    engine.onSpot(BASE_MS + 6 * CANDLE_MS + 1_000, 104.9);
    return;
  }
  feedCandle(engine, 0, [105.0, 105.2, 104.3, 104.6]);
  feedCandle(engine, 1, [104.6, 104.8, 103.9, 104.1]);
  feedCandle(engine, 2, [104.1, 104.2, 103.2, 103.5]);
  feedCandle(engine, 3, [103.5, 103.7, 102.6, 102.9]);
  feedCandle(engine, 4, [102.9, 103.0, 101.9, 102.3]);
  feedCandle(engine, 5, [102.3, 102.5, 101.2, 101.5]);
  engine.onSpot(BASE_MS + 6 * CANDLE_MS + 1_000, 101.5);
}

describe("Gold Hunter Brain V6 identity", () => {
  it("stamps V6 brain/revision/variant and frozen identity", () => {
    resetFrozenGhFastIdentityForTests();
    expect(GOLD_HUNTER_BRAIN_VERSION).toBe("GOLD_HUNTER_BRAIN_V6");
    expect(GOLD_HUNTER_BRAIN_REVISION).toBe("GH-B6-20260821-01");
    expect(GOLD_HUNTER_STRATEGY_VARIANT).toBe("PULSE_GUARD_SCALPER");
    const id = getFrozenGhFastIdentity();
    expect(id.strategyVersion).toBe("GOLD_HUNTER_BRAIN_V6");
    expect(id.soakLabel).toBe(
      "BRAIN_V6_PULSE_GUARD_SCALPER_SMART_PM_V1_SMART_LOSS_V1_DEMO"
    );
  });
});

describe("Gold Hunter Brain V6 pulse-structure entry", () => {
  const cfg = defaultGhFastConfig();

  it("1) bullish impulse -> retrace -> hold -> break => BUY", () => {
    const engine = new M1CandleFlowEngine();
    primeTrend(engine, "BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 10_000, 105.35);
    engine.evaluate(start + 10_000, features(105.35, "BUY"), cfg);
    engine.onSpot(start + 20_000, 105.22);
    engine.evaluate(start + 20_000, features(105.22, "BUY"), cfg);
    engine.onSpot(start + 22_000, 105.23);
    engine.evaluate(start + 22_000, features(105.23, "BUY"), cfg);
    engine.onSpot(start + 23_300, 105.24);
    engine.evaluate(start + 23_300, features(105.24, "BUY"), cfg);
    engine.onSpot(start + 24_700, 105.23);
    engine.evaluate(start + 24_700, features(105.23, "BUY"), cfg);
    engine.onSpot(start + 29_000, 105.43);
    const out = engine.evaluate(start + 29_000, features(105.43, "BUY"), cfg);
    expect(out.eligible).toBe(true);
    expect(out.side).toBe("BUY");
    expect(out.pulseId).toBeTruthy();
  });

  it("2) bearish mirror => SELL", () => {
    const engine = new M1CandleFlowEngine();
    primeTrend(engine, "SELL");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 10_000, 101.1);
    engine.evaluate(start + 10_000, features(101.1, "SELL"), cfg);
    engine.onSpot(start + 20_000, 101.23);
    engine.evaluate(start + 20_000, features(101.23, "SELL"), cfg);
    engine.onSpot(start + 22_000, 101.22);
    engine.evaluate(start + 22_000, features(101.22, "SELL"), cfg);
    engine.onSpot(start + 23_300, 101.21);
    engine.evaluate(start + 23_300, features(101.21, "SELL"), cfg);
    engine.onSpot(start + 24_700, 101.22);
    engine.evaluate(start + 24_700, features(101.22, "SELL"), cfg);
    engine.onSpot(start + 29_000, 101.04);
    const out = engine.evaluate(start + 29_000, features(101.04, "SELL"), cfg);
    expect(out.eligible).toBe(true);
    expect(out.side).toBe("SELL");
  });

  it("3) initial spike without retrace => WAIT", () => {
    const engine = new M1CandleFlowEngine();
    primeTrend(engine, "BUY");
    const now = BASE_MS + 6 * CANDLE_MS + 15_000;
    engine.onSpot(now, 105.6);
    const out = engine.evaluate(now, features(105.6, "BUY"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_PULLBACK_TOO_SHALLOW");
  });

  it("4) pullback without hold => WAIT_BASE_NOT_CONFIRMED", () => {
    const engine = new M1CandleFlowEngine();
    primeTrend(engine, "BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 10_000, 105.35);
    engine.evaluate(start + 10_000, features(105.35, "BUY"), cfg);
    engine.onSpot(start + 19_000, 105.22);
    const out = engine.evaluate(start + 19_000, features(105.22, "BUY"), cfg);
    expect(out.waitReason).toBe("WAIT_BASE_NOT_CONFIRMED");
  });

  it("5) noisy/choppy movement => WAIT_CHOP", () => {
    const engine = new M1CandleFlowEngine();
    for (let i = 0; i < 6; i++) {
      feedCandle(engine, i, [100, 101.2, 98.8, 100.1]);
    }
    const now = BASE_MS + 6 * CANDLE_MS + 25_000;
    engine.onSpot(now, 100.05);
    const out = engine.evaluate(
      now,
      features(100.05, "BUY", {
        efficiency1s: 0.12,
        efficiency3s: 0.15,
        high5s: 101.4,
        low5s: 98.7
      }),
      cfg
    );
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_CHOP");
  });

  it("6) exhausted pulse => WAIT_PULSE_EXHAUSTED", () => {
    const engine = new M1CandleFlowEngine();
    primeTrend(engine, "BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 10_000, 105.35);
    engine.evaluate(start + 10_000, features(105.35, "BUY"), cfg);
    engine.onSpot(start + 20_000, 105.22);
    engine.evaluate(start + 20_000, features(105.22, "BUY"), cfg);
    engine.onSpot(start + 22_000, 105.23);
    engine.evaluate(start + 22_000, features(105.23, "BUY"), cfg);
    engine.onSpot(start + 23_300, 105.24);
    engine.evaluate(start + 23_300, features(105.24, "BUY"), cfg);
    engine.onSpot(start + 24_700, 105.23);
    engine.evaluate(start + 24_700, features(105.23, "BUY"), cfg);
    engine.onSpot(start + 29_000, 105.43);
    const out = engine.evaluate(
      start + 29_000,
      features(105.43, "BUY", {
        efficiency1s: 0.2,
        midVel250: 0.00002,
        midVel500: 0.00008
      }),
      cfg
    );
    expect(out.waitReason).toBe("WAIT_PULSE_EXHAUSTED");
  });

  it("7) insufficient movement budget => WAIT_NO_EDGE_LEFT", () => {
    const engine = new M1CandleFlowEngine();
    primeTrend(engine, "BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 10_000, 105.35);
    engine.evaluate(start + 10_000, features(105.35, "BUY"), cfg);
    engine.onSpot(start + 20_000, 105.22);
    engine.evaluate(start + 20_000, features(105.22, "BUY"), cfg);
    engine.onSpot(start + 22_000, 105.23);
    engine.evaluate(start + 22_000, features(105.23, "BUY"), cfg);
    engine.onSpot(start + 23_300, 105.24);
    engine.evaluate(start + 23_300, features(105.24, "BUY"), cfg);
    engine.onSpot(start + 24_700, 105.23);
    engine.evaluate(start + 24_700, features(105.23, "BUY"), cfg);
    engine.onSpot(start + 29_000, 105.75);
    const out = engine.evaluate(
      start + 29_000,
      features(105.75, "BUY"),
      cfg
    );
    expect(out.waitReason).toBe("WAIT_NO_EDGE_LEFT");
  });

  it("8) microstructure veto => WAIT_MICROSTRUCTURE_VETO", () => {
    const engine = new M1CandleFlowEngine();
    primeTrend(engine, "BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 10_000, 105.35);
    engine.evaluate(start + 10_000, features(105.35, "BUY"), cfg);
    engine.onSpot(start + 20_000, 105.22);
    engine.evaluate(start + 20_000, features(105.22, "BUY"), cfg);
    engine.onSpot(start + 22_000, 105.23);
    engine.evaluate(start + 22_000, features(105.23, "BUY"), cfg);
    engine.onSpot(start + 23_300, 105.24);
    engine.evaluate(start + 23_300, features(105.24, "BUY"), cfg);
    engine.onSpot(start + 24_700, 105.23);
    engine.evaluate(start + 24_700, features(105.23, "BUY"), cfg);
    engine.onSpot(start + 29_000, 105.43);
    const out = engine.evaluate(
      start + 29_000,
      features(105.43, "BUY", {
        midVel250: -0.0002,
        midVel500: -0.0002,
        midVel1s: -0.0002,
        signedImbalance1s: -0.2,
        depth: depth({
          depthImbalance: -0.4,
          removeRateAsk: 0.5,
          removeRateBid: 3.5
        })
      }),
      cfg
    );
    expect(out.waitReason).toBe("WAIT_MICROSTRUCTURE_VETO");
  });

  it("9) genuine reversal can flip side", () => {
    const engine = new M1CandleFlowEngine();
    primeTrend(engine, "BUY");
    feedCandle(engine, 6, [104.9, 105.0, 103.8, 104.0]);
    feedCandle(engine, 7, [104.0, 104.1, 102.8, 103.1]);
    feedCandle(engine, 8, [103.1, 103.2, 101.7, 102.0]);
    engine.onSpot(BASE_MS + 9 * CANDLE_MS + 1_000, 102.0);
    const start = BASE_MS + 9 * CANDLE_MS;
    engine.onSpot(start + 10_000, 101.55);
    engine.evaluate(start + 10_000, features(101.55, "SELL"), cfg);
    engine.onSpot(start + 20_000, 101.68);
    engine.evaluate(start + 20_000, features(101.68, "SELL"), cfg);
    engine.onSpot(start + 22_000, 101.67);
    engine.evaluate(start + 22_000, features(101.67, "SELL"), cfg);
    engine.onSpot(start + 23_400, 101.66);
    engine.evaluate(start + 23_400, features(101.66, "SELL"), cfg);
    engine.onSpot(start + 24_800, 101.67);
    engine.evaluate(start + 24_800, features(101.67, "SELL"), cfg);
    engine.onSpot(start + 29_500, 101.4);
    const out = engine.evaluate(start + 29_500, features(101.4, "SELL"), cfg);
    expect(out.eligible).toBe(true);
    expect(out.side).toBe("SELL");
  });
});

describe("Gold Hunter Brain V6 selector and exit controls", () => {
  it("10) noise cannot create BUY/SELL ping-pong", () => {
    const sel = new GoldHunterStrategySelector();
    const minuteStart = 8_400_000;
    const first = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.8 },
      receivedAtMs: minuteStart + 10_000,
      bookGeneration: 200
    });
    expect(first.newOpportunity).toBe(true);
    sel.markOpportunityConsumed(first.opportunity!.opportunityId);
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: minuteStart + 10_500,
      bookGeneration: 200
    });

    const second = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "SELL", quality: 0.81 },
      receivedAtMs: minuteStart + 21_000,
      bookGeneration: 200
    });
    expect(second.newOpportunity).toBe(true);
    sel.markOpportunityConsumed(second.opportunity!.opportunityId);

    const third = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.82 },
      receivedAtMs: minuteStart + 30_000,
      bookGeneration: 200
    });
    expect(third.newOpportunity).toBe(false);
    expect(third.candidate?.antiChurnState?.rejectionReason).toBe(
      "WAIT_CANDLE_ENTRY_LIMIT_REACHED"
    );
  });

  it("11) failed pulse after entry triggers early exit", () => {
    const cfg = defaultGhFastConfig();
    const t = openGhAbcTrade({
      tradeId: "v6-pulse-fail",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now() - 5_500,
      bid: 2600,
      ask: 2600.05,
      trailDistance: 0.12
    });
    const bid = 2599.98;
    updateGhAbcOpenTrade(t, bid, bid + 0.05, cfg);
    t.timeInTradeMs = 5_500;
    const reason = evaluateGhAbcOpenExit({
      trade: t,
      f: features(bid + 0.025, "BUY", {
        midVel250: -cfg.momentumVelMin * 2,
        midVel500: -cfg.momentumVelMin * 2,
        signedImbalance1s: -0.3,
        efficiency1s: 0.2
      }),
      cfg,
      dataOk: true
    });
    expect(reason).toBe("FAILED_PULSE_EXIT");
  });

  it("12) healthy pulse is not exited prematurely", () => {
    const cfg = defaultGhFastConfig();
    const t = openGhAbcTrade({
      tradeId: "v6-pulse-healthy",
      side: "SELL",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now() - 4_500,
      bid: 2600,
      ask: 2600.05,
      trailDistance: 0.12
    });
    const ask = 2599.8;
    updateGhAbcOpenTrade(t, ask - 0.05, ask, cfg);
    t.timeInTradeMs = 4_500;
    const reason = evaluateGhAbcOpenExit({
      trade: t,
      f: features(2599.82, "SELL", {
        midVel250: -cfg.momentumVelMin * 2,
        midVel500: -cfg.momentumVelMin * 2,
        signedImbalance1s: -0.25,
        efficiency1s: 0.58
      }),
      cfg,
      dataOk: true
    });
    expect(reason).toBeNull();
  });

  it("13) two-loss sequence forces fresh-regime reset", () => {
    const sel = new GoldHunterStrategySelector();
    const minuteStart = 9_000_000;
    const first = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.82 },
      receivedAtMs: minuteStart + 10_000,
      bookGeneration: 300
    });
    expect(first.newOpportunity).toBe(true);
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: minuteStart + 10_500,
      bookGeneration: 300
    });
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: 2600,
      result: "LOSS",
      opportunityId: first.opportunity!.opportunityId,
      tradeId: "v6-loss-1",
      closedAtMs: minuteStart + 20_000
    });

    const second = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.83 },
      receivedAtMs: minuteStart + 52_000,
      bookGeneration: 300,
      bid: 2599.7,
      ask: 2599.82
    });
    expect(second.newOpportunity).toBe(true);
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: minuteStart + 52_500,
      bookGeneration: 300
    });
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: 2600,
      result: "LOSS",
      opportunityId: second.opportunity!.opportunityId,
      tradeId: "v6-loss-2",
      closedAtMs: minuteStart + 53_000
    });
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: minuteStart + 53_500,
      bookGeneration: 300
    });

    const blockedBeforeFloor = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: minuteStart + 100_000,
      mid: 2599.76,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(blockedBeforeFloor.ok).toBe(false);
    expect(blockedBeforeFloor.timeFloorOk).toBe(false);
    expect(blockedBeforeFloor.rejectionReason).toBe("WAIT_LOSS_STREAK_GUARD");

    const staleRegimeAfterFloor = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.84 },
      receivedAtMs: minuteStart + 175_000,
      bookGeneration: 300,
      bid: 2599.7,
      ask: 2599.82
    });
    expect(staleRegimeAfterFloor.newOpportunity).toBe(false);
    expect(staleRegimeAfterFloor.candidate?.antiChurnState?.rejectionReason).toBe(
      "WAIT_REGIME_RESET_AFTER_LOSSES"
    );

    const freshRegime = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.84 },
      receivedAtMs: minuteStart + 176_000,
      bookGeneration: 302,
      bid: 2599.7,
      ask: 2599.82
    });
    expect(freshRegime.newOpportunity).toBe(true);
  });

  it("14) maximum two entries per M1 candle", () => {
    const sel = new GoldHunterStrategySelector();
    const minuteStart = 10_200_000;
    const first = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.82 },
      receivedAtMs: minuteStart + 10_000,
      bookGeneration: 400
    });
    expect(first.newOpportunity).toBe(true);
    sel.markOpportunityConsumed(first.opportunity!.opportunityId);
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: minuteStart + 10_500,
      bookGeneration: 400
    });

    const second = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "SELL", quality: 0.83 },
      receivedAtMs: minuteStart + 21_000,
      bookGeneration: 400
    });
    expect(second.newOpportunity).toBe(true);
    sel.markOpportunityConsumed(second.opportunity!.opportunityId);

    const third = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "SELL", quality: 0.84 },
      receivedAtMs: minuteStart + 30_000,
      bookGeneration: 400
    });
    expect(third.newOpportunity).toBe(false);
    expect(third.candidate?.antiChurnState?.rejectionReason).toBe(
      "WAIT_CANDLE_ENTRY_LIMIT_REACHED"
    );
  });
});

describe("M1 tracker rollover and no look-ahead", () => {
  it("rolls candles on minute boundaries and never closes with future ticks", () => {
    const t = new M1CandleTracker();
    const m0 = BASE_MS;
    t.onMidPrice(m0 + 5_000, 100);
    t.onMidPrice(m0 + 20_000, 101);
    t.onMidPrice(m0 + 50_000, 99);
    let snap = t.snapshot();
    expect(snap.closed).toHaveLength(0);
    expect(snap.current?.close).toBe(99);

    t.onMidPrice(m0 + 65_000, 100.5);
    snap = t.snapshot();
    expect(snap.closed).toHaveLength(1);
    expect(snap.closed[0]?.open).toBe(100);
    expect(snap.closed[0]?.high).toBe(101);
    expect(snap.closed[0]?.low).toBe(99);
    expect(snap.closed[0]?.close).toBe(99);
    expect(snap.current?.startMs).toBe(m0 + CANDLE_MS);
  });
});
