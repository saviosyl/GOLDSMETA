import { describe, expect, it } from "vitest";
import {
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_BRAIN_REVISION,
  GOLD_HUNTER_STRATEGY_VARIANT,
  defaultGhFastConfig,
  M1CandleFlowEngine,
  M1CandleTracker,
  getFrozenGhFastIdentity,
  resetFrozenGhFastIdentityForTests
} from "../../../src/services/goldHunterAdmin/abc";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import { GoldHunterStrategySelector } from "../../../src/services/goldHunterAdmin/strategySelector";

const BASE_MS = 1_720_000_000_000;
const CANDLE_MS = 60_000;

function depth(over: Partial<DepthBookStats> = {}): DepthBookStats {
  return {
    available: true,
    topBidDepth: 10,
    topAskDepth: 10,
    bidDepthN: 10,
    askDepthN: 10,
    bidLevels: 3,
    askLevels: 3,
    depthRatio: 1,
    depthImbalance: 0.1,
    weightedImbalance: 0.1,
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
  const bullish = side === "BUY";
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
    midVel250: bullish ? 0.0003 : -0.0003,
    midVel500: bullish ? 0.00035 : -0.00035,
    midVel1s: bullish ? 0.0004 : -0.0004,
    midVel2s: 0,
    midVel3s: 0,
    acceleration: bullish ? 0.00015 : -0.00015,
    updateRate1s: 12,
    signedImbalance1s: bullish ? 0.4 : -0.4,
    efficiency1s: 0.55,
    efficiency3s: 0.5,
    high1s: ask,
    low1s: bid,
    high2s: ask,
    low2s: bid,
    high5s: ask,
    low5s: bid,
    high10s: ask,
    low10s: bid,
    high15s: ask,
    low15s: bid,
    high30s: ask,
    low30s: bid,
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
    depth: depth({ bestBid: bid, bestAsk: ask, spread: 0.12 }),
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

function primeEngineForSide(side: "BUY" | "SELL") {
  const engine = new M1CandleFlowEngine();
  const history: [number, number, number, number][] = [
    [100.0, 101.5, 99.5, 100.5],
    [100.5, 102.0, 100.0, 101.0],
    [101.0, 102.5, 100.5, 101.5],
    [101.5, 103.0, 101.0, 102.0],
    [102.0, 103.5, 101.5, 102.5]
  ];
  for (let i = 0; i < history.length; i++) {
    feedCandle(engine, i, history[i]!);
  }
  if (side === "BUY") {
    feedCandle(engine, 5, [102.5, 104.5, 102.0, 104.2]);
    engine.onSpot(BASE_MS + 6 * CANDLE_MS + 1_000, 104.2);
  } else {
    feedCandle(engine, 5, [104.2, 104.5, 102.0, 102.3]);
    engine.onSpot(BASE_MS + 6 * CANDLE_MS + 1_000, 102.3);
  }
  return engine;
}

describe("Gold Hunter Brain V4 identity", () => {
  it("stamps V4 brain/revision/variant and frozen identity", () => {
    resetFrozenGhFastIdentityForTests();
    expect(GOLD_HUNTER_BRAIN_VERSION).toBe("GOLD_HUNTER_BRAIN_V4");
    expect(GOLD_HUNTER_BRAIN_REVISION).toBe("GH-B4-20260821-01");
    expect(GOLD_HUNTER_STRATEGY_VARIANT).toBe("M1_CANDLE_FLOW");
    const id = getFrozenGhFastIdentity();
    expect(id.strategyVersion).toBe("GOLD_HUNTER_BRAIN_V4");
    expect(id.soakLabel).toBe("BRAIN_V4_M1_CANDLE_FLOW_SMART_PM_V1_SMART_LOSS_V1_DEMO");
  });

  it("keeps anti-churn at 30 seconds", () => {
    const cfg = defaultGhFastConfig();
    expect(cfg.antiChurnLossMinMs).toBe(30_000);
    expect(cfg.antiChurnOppositeFlipMinMs).toBe(30_000);
  });
});

describe("Gold Hunter Brain V4 BUY M1 candle flow", () => {
  const cfg = defaultGhFastConfig();

  it("1) strong bullish closed candle + pullback + reacceleration => BUY eligible", () => {
    const engine = primeEngineForSide("BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 10_000, 104.8);
    engine.evaluate(start + 10_000, features(104.8, "BUY"), cfg);
    engine.onSpot(start + 20_000, 104.0);
    engine.evaluate(start + 20_000, features(104.0, "BUY"), cfg);
    engine.onSpot(start + 28_000, 104.35);
    const out = engine.evaluate(start + 28_000, features(104.35, "BUY"), cfg);
    expect(out.eligible).toBe(true);
    expect(out.side).toBe("BUY");
    expect(out.finalQuality).toBeGreaterThanOrEqual(0.7);
  });

  it("2) bullish micro-burst but bearish M1 structure => no BUY", () => {
    const engine = primeEngineForSide("SELL");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 18_000, 102.9);
    const out = engine.evaluate(start + 18_000, features(102.9, "BUY"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.side).not.toBe("BUY");
  });

  it("3) bullish candle but no pullback => no BUY", () => {
    const engine = primeEngineForSide("BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 18_000, 104.9);
    const out = engine.evaluate(start + 18_000, features(104.9, "BUY"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_PULLBACK_NOT_SEEN");
  });

  it("4) pullback still falling => no BUY", () => {
    const engine = primeEngineForSide("BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 14_000, 104.8);
    engine.evaluate(start + 14_000, features(104.8, "BUY"), cfg);
    engine.onSpot(start + 22_000, 104.0);
    const out = engine.evaluate(start + 22_000, features(104.0, "BUY"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_PULLBACK_STILL_FALLING");
  });

  it("5) pullback + recovery + microstructure => BUY", () => {
    const engine = primeEngineForSide("BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 12_000, 104.85);
    engine.evaluate(start + 12_000, features(104.85, "BUY"), cfg);
    engine.onSpot(start + 22_000, 104.0);
    engine.evaluate(start + 22_000, features(104.0, "BUY"), cfg);
    engine.onSpot(start + 30_000, 104.4);
    const out = engine.evaluate(start + 30_000, features(104.4, "BUY"), cfg);
    expect(out.eligible).toBe(true);
    expect(out.waitReason).toBeNull();
  });

  it("6) candle already >70% expected range => no BUY", () => {
    const engine = primeEngineForSide("BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 20_000, 105.75);
    const out = engine.evaluate(start + 20_000, features(105.75, "BUY"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_CANDLE_OVEREXTENDED");
  });

  it("7) insufficient reward space => no BUY", () => {
    const engine = primeEngineForSide("BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 12_000, 105.6);
    const out = engine.evaluate(start + 12_000, features(105.6, "BUY"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_INSUFFICIENT_REWARD_SPACE");
  });

  it("flat/doji signal candle => no trade", () => {
    const engine = new M1CandleFlowEngine();
    for (let i = 0; i < 5; i++) {
      feedCandle(engine, i, [100 + i, 101 + i, 99 + i, 100.5 + i]);
    }
    feedCandle(engine, 5, [106, 106.4, 105.6, 106]); // doji
    const now = BASE_MS + 6 * CANDLE_MS + 16_000;
    engine.onSpot(now, 106.1);
    const out = engine.evaluate(now, features(106.1, "BUY"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_CANDLE_DIRECTION_UNCLEAR");
  });

  it("weak-body signal candle => no trade", () => {
    const engine = new M1CandleFlowEngine();
    for (let i = 0; i < 5; i++) {
      feedCandle(engine, i, [100 + i, 101.4 + i, 99.4 + i, 100.4 + i]);
    }
    feedCandle(engine, 5, [106, 107.0, 105.0, 106.2]); // bodyRatio low
    const now = BASE_MS + 6 * CANDLE_MS + 20_000;
    engine.onSpot(now, 106.3);
    const out = engine.evaluate(now, features(106.3, "BUY"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_CANDLE_DIRECTION_UNCLEAR");
  });

  it("early (<8s) and late (>48s) windows are blocked", () => {
    const early = primeEngineForSide("BUY");
    const start = BASE_MS + 6 * CANDLE_MS;
    early.onSpot(start + 4_000, 104.7);
    expect(
      early.evaluate(start + 4_000, features(104.7, "BUY"), cfg).waitReason
    ).toBe("WAIT_CANDLE_TOO_EARLY");

    const late = primeEngineForSide("BUY");
    late.onSpot(start + 52_000, 104.6);
    expect(
      late.evaluate(start + 52_000, features(104.6, "BUY"), cfg).waitReason
    ).toBe("WAIT_CANDLE_TOO_LATE");
  });
});

describe("Gold Hunter Brain V4 SELL mirrors", () => {
  const cfg = defaultGhFastConfig();

  it("SELL pullback + reacceleration + microstructure => eligible SELL", () => {
    const engine = primeEngineForSide("SELL");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 10_000, 101.7);
    engine.evaluate(start + 10_000, features(101.7, "SELL"), cfg);
    engine.onSpot(start + 22_000, 102.5);
    engine.evaluate(start + 22_000, features(102.5, "SELL"), cfg);
    engine.onSpot(start + 30_000, 102.2);
    const out = engine.evaluate(start + 30_000, features(102.2, "SELL"), cfg);
    expect(out.eligible).toBe(true);
    expect(out.side).toBe("SELL");
  });

  it("SELL with no pullback => blocked", () => {
    const engine = primeEngineForSide("SELL");
    const start = BASE_MS + 6 * CANDLE_MS;
    engine.onSpot(start + 14_000, 101.5);
    const out = engine.evaluate(start + 14_000, features(101.5, "SELL"), cfg);
    expect(out.eligible).toBe(false);
    expect(out.waitReason).toBe("WAIT_PULLBACK_NOT_SEEN");
  });

  it("SELL overextended and insufficient space are blocked", () => {
    const over = primeEngineForSide("SELL");
    const start = BASE_MS + 6 * CANDLE_MS;
    over.onSpot(start + 20_000, 100.75);
    expect(
      over.evaluate(start + 20_000, features(100.75, "SELL"), cfg).waitReason
    ).toBe("WAIT_CANDLE_OVEREXTENDED");

    const noSpace = primeEngineForSide("SELL");
    noSpace.onSpot(start + 20_000, 100.9);
    expect(
      noSpace.evaluate(start + 20_000, features(100.9, "SELL"), cfg).waitReason
    ).toBe("WAIT_INSUFFICIENT_REWARD_SPACE");
  });
});

describe("Gold Hunter Brain V4 one-trade-per-M1 and post-loss gating", () => {
  it("8/9) second trade in same M1 blocked; new minute resets", () => {
    const sel = new GoldHunterStrategySelector();
    const minuteStart = 6_000_000;

    const first = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.82 },
      receivedAtMs: minuteStart + 10_000
    });
    expect(first.newOpportunity).toBe(true);
    expect(first.opportunity?.strategyVariant).toBe("M1_CANDLE_FLOW");
    sel.markOpportunityConsumed(first.opportunity!.opportunityId);

    const second = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "SELL", quality: 0.85 },
      receivedAtMs: minuteStart + 20_000
    });
    expect(second.newOpportunity).toBe(false);
    expect(second.candidate?.antiChurnState?.rejectionReason).toBe(
      "WAIT_CANDLE_ALREADY_TRADED"
    );

    const nextMinute = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.83 },
      receivedAtMs: minuteStart + 70_000
    });
    expect(nextMinute.newOpportunity).toBe(true);
  });

  it("10) trade after LOSS on same M1 candle is blocked", () => {
    const sel = new GoldHunterStrategySelector();
    const minuteStart = 7_000_000;
    const first = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.82 },
      receivedAtMs: minuteStart + 10_000
    });
    expect(first.newOpportunity).toBe(true);
    const oppId = first.opportunity!.opportunityId;

    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: null,
      result: "LOSS",
      opportunityId: oppId,
      closedAtMs: minuteStart + 20_000,
      tradeId: "GH-D-loss-v4"
    });

    const sameMinute = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.81 },
      receivedAtMs: minuteStart + 35_000
    });
    expect(sameMinute.newOpportunity).toBe(false);
    expect(sameMinute.candidate?.antiChurnState?.rejectionReason).toBe(
      "WAIT_POST_LOSS_NEW_CANDLE_REQUIRED"
    );

    const nextMinute = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.84 },
      receivedAtMs: minuteStart + 90_000
    });
    expect(nextMinute.newOpportunity).toBe(true);
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
    expect(snap.closed).toHaveLength(0); // no look-ahead close before next minute tick
    expect(snap.current?.close).toBe(99);

    t.onMidPrice(m0 + 65_000, 100.5); // first tick of minute 1 closes minute 0
    snap = t.snapshot();
    expect(snap.closed).toHaveLength(1);
    expect(snap.closed[0]?.open).toBe(100);
    expect(snap.closed[0]?.high).toBe(101);
    expect(snap.closed[0]?.low).toBe(99);
    expect(snap.closed[0]?.close).toBe(99);
    expect(snap.current?.startMs).toBe(m0 + CANDLE_MS);
  });
});
