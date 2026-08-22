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
    expect(GOLD_HUNTER_BRAIN_REVISION).toBe("GH-B6-20260821-02");
    expect(GOLD_HUNTER_STRATEGY_VARIANT).toBe("PULSE_GUARD_CONTINUATION");
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
