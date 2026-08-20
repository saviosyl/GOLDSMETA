/**
 * Gold Hunter Brain V3 — Setup A persistence + post-loss anti-churn.
 * Does not retune B/C, efficiency, or execution plumbing.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  defaultGhFastConfig,
  scoreMomentumIgnition,
  evaluateSetupsDetailed,
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_FAST_STRATEGY_VERSION,
  GH_FAST_MAX_OPEN_POSITIONS,
  GH_FAST_BROKER_EXECUTION_ENABLED,
  getFrozenGhFastIdentity,
  resetFrozenGhFastIdentityForTests
} from "../../../src/services/goldHunterAdmin/abc";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import {
  GoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_EXECUTION_MODE
} from "../../../src/services/goldHunterAdmin/types";

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

function baseFeatures(
  over: Partial<GhFastFeatureSnapshot> = {}
): GhFastFeatureSnapshot {
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
    midVel250: 0,
    midVel500: 0,
    midVel1s: 0,
    midVel2s: 0,
    midVel3s: 0,
    acceleration: 0,
    updateRate1s: 10,
    signedImbalance1s: 0,
    efficiency1s: 0.5,
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
    priorHigh5s: mid,
    priorLow5s: mid,
    priorHigh10s: mid,
    priorLow10s: mid,
    distHigh1s: 0,
    distLow1s: 0,
    distHigh5s: 0,
    distLow5s: 0,
    distPriorHigh5s: 0,
    distPriorLow5s: 0,
    upTouches5s: 0,
    downTouches5s: 0,
    depth: depth({ bestBid: bid, bestAsk: ask, spread }),
    ...over,
    mid: over.mid ?? mid,
    spread: over.spread ?? spread
  };
}

/** Existing valid A BUY fixture — all V3 gates pass. */
function strongABuy(
  over: Partial<GhFastFeatureSnapshot> = {}
): GhFastFeatureSnapshot {
  return baseFeatures({
    midVel250: 0.0002,
    midVel500: 0.00025,
    midVel1s: 0.0003,
    acceleration: 0.00015,
    signedImbalance1s: 0.4,
    updateRate1s: 10,
    depth: depth({
      depthImbalance: 0.1,
      removeRateAsk: 4,
      removeRateBid: 1
    }),
    ...over
  });
}

function strongASell(
  over: Partial<GhFastFeatureSnapshot> = {}
): GhFastFeatureSnapshot {
  return baseFeatures({
    midVel250: -0.0002,
    midVel500: -0.00025,
    midVel1s: -0.0003,
    acceleration: -0.00015,
    signedImbalance1s: -0.4,
    updateRate1s: 10,
    depth: depth({
      depthImbalance: -0.1,
      removeRateAsk: 1,
      removeRateBid: 4
    }),
    ...over
  });
}

function specialistA(f: GhFastFeatureSnapshot) {
  const detailed = evaluateSetupsDetailed(f, defaultGhFastConfig());
  const a = detailed.specialists.find((s) => s.setup === "A_MOMENTUM_IGNITION");
  expect(a).toBeDefined();
  return a!;
}

describe("Gold Hunter Brain V3 — identity + safety", () => {
  it("stamps GOLD_HUNTER_BRAIN_V3 and Demo-only identity", () => {
    resetFrozenGhFastIdentityForTests();
    expect(GOLD_HUNTER_BRAIN_VERSION).toBe("GOLD_HUNTER_BRAIN_V3");
    expect(GOLD_HUNTER_FAST_STRATEGY_VERSION).toBe("GOLD_HUNTER_BRAIN_V3");
    const id = getFrozenGhFastIdentity();
    expect(id.soakLabel).toBe("BRAIN_V3_SMART_PM_V1_SMART_LOSS_V1_DEMO");
    expect(id.strategyVersion).toBe("GOLD_HUNTER_BRAIN_V3");
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(GH_FAST_BROKER_EXECUTION_ENABLED).toBe(false);
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(GH_FAST_MAX_OPEN_POSITIONS).toBe(1);
  });

  it("anti-churn floors are 30s / 30s (Brain V3)", () => {
    const cfg = defaultGhFastConfig();
    expect(cfg.antiChurnLossMinMs).toBe(30_000);
    expect(cfg.antiChurnOppositeFlipMinMs).toBe(30_000);
    expect(cfg.rearmFloorMs).toBe(350);
    expect(cfg.hardStop).toBe(0.55);
    expect(cfg.minSetupQuality).toBe(0.55);
    expect(cfg.minSetupQualityB).toBe(0.7);
  });
});

describe("Gold Hunter Brain V3 — Setup A persistence", () => {
  const cfg = defaultGhFastConfig();

  it("1. BUY 250/500 positive, 1s negative, other gates valid => A rejected", () => {
    const f = strongABuy({ midVel1s: -0.0003 });
    const a = specialistA(f);
    expect(scoreMomentumIgnition(f, cfg)).toBeNull();
    expect(a.eligible).toBe(false);
    expect(a.failedConditions).toContain("velocity_1s_not_aligned");
    expect(a.failedConditions).not.toContain("update_rate_insufficient");
  });

  it("2. SELL 250/500 negative, 1s positive => A rejected", () => {
    const f = strongASell({ midVel1s: 0.0003 });
    const a = specialistA(f);
    expect(scoreMomentumIgnition(f, cfg)).toBeNull();
    expect(a.eligible).toBe(false);
    expect(a.failedConditions).toContain("velocity_1s_not_aligned");
  });

  it("3. BUY all direction gates valid, updateRate1s=1 => A rejected", () => {
    const f = strongABuy({ updateRate1s: 1 });
    const a = specialistA(f);
    expect(scoreMomentumIgnition(f, cfg)).toBeNull();
    expect(a.eligible).toBe(false);
    expect(a.failedConditions).toContain("update_rate_insufficient");
    expect(a.failedConditions).not.toContain("velocity_1s_not_aligned");
  });

  it("4. BUY all gates valid, updateRate1s=2 => A rejected", () => {
    const f = strongABuy({ updateRate1s: 2 });
    const a = specialistA(f);
    expect(scoreMomentumIgnition(f, cfg)).toBeNull();
    expect(a.eligible).toBe(false);
    expect(a.failedConditions).toContain("update_rate_insufficient");
  });

  it("5. BUY all gates valid, updateRate1s=3 => may qualify if quality passes", () => {
    const f = strongABuy({ updateRate1s: 3 });
    const hit = scoreMomentumIgnition(f, cfg);
    const a = specialistA(f);
    expect(hit).not.toBeNull();
    expect(hit!.setup).toBe("A_MOMENTUM_IGNITION");
    expect(hit!.side).toBe("BUY");
    expect(hit!.quality).toBeGreaterThanOrEqual(cfg.minSetupQuality);
    expect(a.eligible).toBe(true);
    expect(a.failedConditions).toEqual([]);
  });

  it("6. SELL all gates valid, updateRate1s>=3 => may qualify", () => {
    const f = strongASell({ updateRate1s: 3 });
    const hit = scoreMomentumIgnition(f, cfg);
    const a = specialistA(f);
    expect(hit).not.toBeNull();
    expect(hit!.side).toBe("SELL");
    expect(hit!.quality).toBeGreaterThanOrEqual(cfg.minSetupQuality);
    expect(a.eligible).toBe(true);
    expect(a.failedConditions).toEqual([]);
  });

  it("7. existing valid A BUY fixture still qualifies", () => {
    const hit = scoreMomentumIgnition(strongABuy(), cfg);
    expect(hit).not.toBeNull();
    expect(hit!.setup).toBe("A_MOMENTUM_IGNITION");
    expect(hit!.side).toBe("BUY");
    expect(hit!.quality).toBeGreaterThanOrEqual(cfg.minSetupQuality);
  });

  it("does not add an efficiency1s gate on Setup A", () => {
    const f = strongABuy({ efficiency1s: 0 });
    const hit = scoreMomentumIgnition(f, cfg);
    expect(hit).not.toBeNull();
    const a = specialistA(f);
    expect(a.failedConditions).not.toContain("efficiency1s_too_low");
  });
});

describe("Gold Hunter Brain V3 — post-loss anti-churn", () => {
  const ENTRY = 2600;
  const CLOSE_MS = 1_000_000;

  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
  });

  function afterLoss(): GoldHunterStrategySelector {
    const sel = new GoldHunterStrategySelector();
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: ENTRY,
      result: "LOSS",
      opportunityId: "opp-loss-v3",
      closedAtMs: CLOSE_MS,
      tradeId: "GH-D-v3-loss"
    });
    return sel;
  }

  it("8. same-side candidate at +8s => blocked", () => {
    const gate = afterLoss().evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: CLOSE_MS + 8_000,
      mid: ENTRY - 0.01
    });
    expect(gate.ok).toBe(false);
    expect(gate.timeFloorOk).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_REENTRY_TIME_RESET");
  });

  it("9. same-side candidate at +23s => blocked", () => {
    const gate = afterLoss().evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: CLOSE_MS + 23_000,
      mid: ENTRY - 0.01
    });
    expect(gate.ok).toBe(false);
    expect(gate.timeFloorOk).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_REENTRY_TIME_RESET");
  });

  it("10. same-side candidate at +29.999s => blocked", () => {
    const gate = afterLoss().evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: CLOSE_MS + 29_999,
      mid: ENTRY - 0.01
    });
    expect(gate.ok).toBe(false);
    expect(gate.timeFloorOk).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_REENTRY_TIME_RESET");
  });

  it("11. same-side candidate at +30s => may proceed if other gates pass", () => {
    const gate = afterLoss().evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: CLOSE_MS + 30_000,
      mid: ENTRY - 0.01
    });
    expect(gate.ok).toBe(true);
    expect(gate.timeFloorOk).toBe(true);
    expect(gate.rejectionReason).toBeNull();
  });

  it("12. opposite-side candidate before +30s => blocked", () => {
    const gate = afterLoss().evaluateAntiChurnGateForTests({
      side: "SELL",
      atMs: CLOSE_MS + 15_000,
      mid: ENTRY - 0.01,
      signedImbalance1s: -0.5,
      midVel250: -0.001
    });
    expect(gate.ok).toBe(false);
    expect(gate.timeFloorOk).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_REENTRY_TIME_RESET");
  });

  it("13. opposite-side at/after +30s still requires directional confirmation", () => {
    const unconfirmed = afterLoss().evaluateAntiChurnGateForTests({
      side: "SELL",
      atMs: CLOSE_MS + 30_000,
      mid: ENTRY - 0.01
    });
    expect(unconfirmed.ok).toBe(false);
    expect(unconfirmed.timeFloorOk).toBe(true);
    expect(unconfirmed.rejectionReason).toBe("WAIT_REVERSAL_NOT_CONFIRMED");

    const confirmed = afterLoss().evaluateAntiChurnGateForTests({
      side: "SELL",
      atMs: CLOSE_MS + 30_000,
      mid: ENTRY - 0.01,
      signedImbalance1s: -0.5,
      midVel250: -0.001
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.rejectionReason).toBeNull();
  });
});
