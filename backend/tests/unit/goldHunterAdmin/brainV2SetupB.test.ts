import { describe, expect, it } from "vitest";
import {
  defaultGhFastConfig,
  evaluateSetupsDetailed,
  type M1CandleFlowEvaluation
} from "../../../src/services/goldHunterAdmin/abc";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import { GoldHunterStrategySelector } from "../../../src/services/goldHunterAdmin/strategySelector";

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
    depthImbalance: 0.25,
    weightedImbalance: 0.25,
    liquidityAddedBid: 0,
    liquidityAddedAsk: 0,
    liquidityRemovedBid: 0,
    liquidityRemovedAsk: 0,
    addRateBid: 0,
    addRateAsk: 0,
    removeRateBid: 1,
    removeRateAsk: 4,
    bestBid: 2600,
    bestAsk: 2600.12,
    spread: 0.12,
    crossed: false,
    lastUpdateMs: 0,
    lastValidBookMs: 0,
    consecutiveInvalidSnapshots: 0,
    bookGeneration: 1,
    resyncCount: 0,
    deleteHits: 0,
    ...over
  };
}

function feat(over: Partial<GhFastFeatureSnapshot> = {}): GhFastFeatureSnapshot {
  const bid = over.bid ?? 2600;
  const ask = over.ask ?? 2600.12;
  const mid = over.mid ?? (bid + ask) / 2;
  const spread = ask - bid;
  return {
    bid,
    ask,
    mid,
    spread,
    bidVel250: 0,
    bidVel500: 0,
    bidVel1s: 0,
    bidVel2s: 0,
    bidVel3s: 0,
    askVel1s: 0,
    midVel250: 0.00025,
    midVel500: 0.00025,
    midVel1s: 0.00035,
    midVel2s: 0,
    midVel3s: 0,
    acceleration: 0.0002,
    updateRate1s: 12,
    signedImbalance1s: 0.45,
    efficiency1s: 0.75,
    efficiency3s: 0.5,
    high1s: mid,
    low1s: mid,
    high2s: mid,
    low2s: mid,
    high5s: mid,
    low5s: mid,
    high10s: mid,
    low10s: mid,
    high15s: mid,
    low15s: mid,
    high30s: mid,
    low30s: mid,
    priorHigh5s: mid - 0.4,
    priorLow5s: mid - 1,
    priorHigh10s: mid - 0.4,
    priorLow10s: mid - 1,
    distHigh1s: 0,
    distLow1s: 0,
    distHigh5s: 0,
    distLow5s: 0,
    distPriorHigh5s: 0,
    distPriorLow5s: 0,
    upTouches5s: 0,
    downTouches5s: 0,
    depth: depth({ bestBid: bid, bestAsk: ask, spread }),
    ...over
  };
}

const m1Eligible: M1CandleFlowEvaluation = {
  eligible: true,
  side: "BUY",
  waitReason: null,
  stage: "TRIGGERED",
  currentCandleStartMs: 1_000_000,
  currentCandleAgeSec: 20,
  signalRange: 2.2,
  medianRange5: 2.0,
  directionalDisplacement: 0.5,
  remainingExpectedRange: 1.5,
  pullbackRatio: 0.3,
  reclaimDistance: 0.35,
  candleTrendScore: 0.88,
  pullbackScore: 0.84,
  microstructureScore: 1,
  rewardSpaceScore: 0.82,
  finalQuality: 0.86,
  qualityThreshold: 0.7,
  reasons: ["test_m1_flow"],
  latestClosedCandle: null,
  previousClosedCandle: null
};

describe("Gold Hunter Brain V4 setup gating", () => {
  it("keeps B/C specialist evals but only Setup A can be selected", () => {
    const cfg = defaultGhFastConfig();
    const f = feat();
    const out = evaluateSetupsDetailed(f, cfg, { m1CandleFlow: m1Eligible });
    const a = out.specialists.find((s) => s.setup === "A_MOMENTUM_IGNITION");
    const b = out.specialists.find((s) => s.setup === "B_FAST_BREAKOUT");
    expect(a?.eligible).toBe(true);
    expect(b?.eligible).toBe(true); // shadow evaluation retained
    expect(out.selected?.setup).toBe("A_MOMENTUM_IGNITION");
  });

  it("if M1 Candle Flow is not eligible, no setup is selected for execution", () => {
    const cfg = defaultGhFastConfig();
    const f = feat();
    const out = evaluateSetupsDetailed(f, cfg, {
      m1CandleFlow: { ...m1Eligible, eligible: false, waitReason: "WAIT_CANDLE_TOO_EARLY" }
    });
    expect(out.selected).toBeNull();
    expect(
      out.specialists.find((s) => s.setup === "B_FAST_BREAKOUT")?.eligible
    ).toBe(true);
    expect(
      out.specialists.find((s) => s.setup === "C_PULLBACK_REACCEL")?.eligible
    ).toBe(false);
  });

  it("selector never opens broker-eligible opportunity for injected B/C", () => {
    const sel = new GoldHunterStrategySelector();
    const b = sel.processInjectedSelectionForTests({
      selected: { setup: "B_FAST_BREAKOUT", side: "BUY", quality: 0.9 },
      receivedAtMs: 2_000_000
    });
    expect(b.newOpportunity).toBe(false);

    const c = sel.processInjectedSelectionForTests({
      selected: { setup: "C_PULLBACK_REACCEL", side: "SELL", quality: 0.9 },
      receivedAtMs: 2_060_000
    });
    expect(c.newOpportunity).toBe(false);
  });
});
