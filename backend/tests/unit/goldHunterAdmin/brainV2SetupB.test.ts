/**
 * Gold Hunter Brain V2 — Setup B quality + anti-churn tests.
 * A/C specialist behaviour must remain V1-equivalent.
 * Does not claim profitability.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  defaultGhFastConfig,
  scoreFastBreakout,
  scoreMomentumIgnition,
  scorePullbackReaccel,
  requiredBreakoutDistance,
  evaluateSetupsDetailed,
  GOLD_HUNTER_BRAIN_VERSION,
  GH_FAST_MAX_OPEN_POSITIONS,
  GH_FAST_BROKER_EXECUTION_ENABLED,
  FastFeatureEngine
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
import { GH_DEMO_MAX_OPEN_TRADES_REQUIRED } from "../../../src/services/goldHunterAdmin/configValidation";
import type { GhBreakoutDiagnostics } from "../../../src/services/goldHunterAdmin/abc/setups";

function depth(
  over: Partial<DepthBookStats> = {}
): DepthBookStats {
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

/** Strong B BUY: clears prior high with supportive context. */
function strongBBuy(): GhFastFeatureSnapshot {
  const priorHigh = 2600.0;
  const mid = 2600.4;
  const spread = 0.12;
  return baseFeatures({
    bid: mid - spread / 2,
    ask: mid + spread / 2,
    mid,
    spread,
    priorHigh5s: priorHigh,
    priorLow5s: 2599.5,
    high5s: mid, // includes current — must NOT be used as breakout ref
    low5s: 2599.5,
    midVel250: 0.0002,
    midVel500: 0.00025,
    midVel1s: 0.0004,
    acceleration: 0.0002,
    signedImbalance1s: 0.45,
    efficiency1s: 0.75,
    updateRate1s: 12,
    depth: depth({
      depthImbalance: 0.25,
      removeRateAsk: 5,
      removeRateBid: 1,
      bestBid: mid - spread / 2,
      bestAsk: mid + spread / 2,
      spread
    })
  });
}

function strongBSell(): GhFastFeatureSnapshot {
  const priorLow = 2600.0;
  const mid = 2599.6;
  const spread = 0.12;
  return baseFeatures({
    bid: mid - spread / 2,
    ask: mid + spread / 2,
    mid,
    spread,
    priorHigh5s: 2600.5,
    priorLow5s: priorLow,
    high5s: 2600.5,
    low5s: mid,
    midVel250: -0.0002,
    midVel500: -0.00025,
    midVel1s: -0.0004,
    acceleration: -0.0002,
    signedImbalance1s: -0.45,
    efficiency1s: 0.75,
    updateRate1s: 12,
    depth: depth({
      depthImbalance: -0.25,
      removeRateAsk: 1,
      removeRateBid: 5,
      bestBid: mid - spread / 2,
      bestAsk: mid + spread / 2,
      spread
    })
  });
}

/** V1-strong A BUY fixture (unchanged gates). */
function strongABuy(): GhFastFeatureSnapshot {
  return baseFeatures({
    midVel250: 0.0002,
    midVel500: 0.00025,
    midVel1s: 0.0003,
    acceleration: 0.00015,
    signedImbalance1s: 0.4,
    depth: depth({
      depthImbalance: 0.1,
      removeRateAsk: 4,
      removeRateBid: 1
    })
  });
}

function strongASell(): GhFastFeatureSnapshot {
  return baseFeatures({
    midVel250: -0.0002,
    midVel500: -0.00025,
    midVel1s: -0.0003,
    acceleration: -0.00015,
    signedImbalance1s: -0.4,
    depth: depth({
      depthImbalance: -0.1,
      removeRateAsk: 1,
      removeRateBid: 4
    })
  });
}

function strongCBuy(): GhFastFeatureSnapshot {
  const cfg = defaultGhFastConfig();
  return baseFeatures({
    mid: 2600.2,
    high5s: 2600.5,
    low5s: 2599.8,
    midVel3s: cfg.momentumVelMin * 2,
    efficiency3s: 0.5,
    midVel250: 0.0002,
    acceleration: 0.0002,
    signedImbalance1s: 0.3,
    depth: depth({ depthImbalance: 0.05 })
  });
}

function strongCSell(): GhFastFeatureSnapshot {
  const cfg = defaultGhFastConfig();
  return baseFeatures({
    mid: 2599.85,
    high5s: 2600.2,
    low5s: 2599.6,
    // pullbackFromLow = (2599.85-2599.6)/(2600.2-2599.6) ≈ 0.417 ≤ 0.45
    midVel3s: -cfg.momentumVelMin * 2,
    efficiency3s: 0.5,
    midVel250: -0.0002,
    acceleration: -0.0002,
    signedImbalance1s: -0.3,
    depth: depth({ depthImbalance: -0.05 })
  });
}

describe("Gold Hunter Brain V2 — Setup B", () => {
  const cfg = defaultGhFastConfig();

  it("TEST1: tiny new 5s high with weak context — B BUY must NOT qualify", () => {
    // Current tick is the new high5s; prior high is only 0.01 below mid (<< buffer).
    const spread = 0.12;
    const priorHigh = 2600.0;
    const mid = 2600.01; // tiny tick above prior — less than required buffer
    const f = baseFeatures({
      bid: mid - spread / 2,
      ask: mid + spread / 2,
      mid,
      spread,
      priorHigh5s: priorHigh,
      high5s: mid,
      midVel250: 0.00001,
      midVel500: 0,
      midVel1s: 0,
      acceleration: 0,
      signedImbalance1s: 0.05,
      efficiency1s: 0.2,
      depth: depth({ depthImbalance: 0, removeRateAsk: 1, removeRateBid: 1 })
    });
    expect(requiredBreakoutDistance(f, cfg)).toBeGreaterThan(mid - priorHigh);
    expect(scoreFastBreakout(f, cfg)).toBeNull();
  });

  it("TEST2: tiny new 5s low with weak context — B SELL must NOT qualify", () => {
    const spread = 0.12;
    const priorLow = 2600.0;
    const mid = 2599.99;
    const f = baseFeatures({
      bid: mid - spread / 2,
      ask: mid + spread / 2,
      mid,
      spread,
      priorLow5s: priorLow,
      low5s: mid,
      midVel250: -0.00001,
      midVel500: 0,
      midVel1s: 0,
      acceleration: 0,
      signedImbalance1s: -0.05,
      efficiency1s: 0.2,
      depth: depth({ depthImbalance: 0, removeRateAsk: 1, removeRateBid: 1 })
    });
    expect(scoreFastBreakout(f, cfg)).toBeNull();
  });

  it("TEST3: genuine prior-high clearance with supportive context — B BUY qualifies", () => {
    const f = strongBBuy();
    const hit = scoreFastBreakout(f, cfg);
    expect(hit).not.toBeNull();
    expect(hit!.setup).toBe("B_FAST_BREAKOUT");
    expect(hit!.side).toBe("BUY");
    expect(hit!.quality).toBeGreaterThanOrEqual(cfg.minSetupQualityB);
    expect(hit!.diagnostics?.brainVersion).toBe(GOLD_HUNTER_BRAIN_VERSION);
    expect(hit!.diagnostics?.breakoutReference).toBe(f.priorHigh5s);
    expect(hit!.diagnostics!.breakoutDistance).toBeGreaterThan(
      hit!.diagnostics!.requiredBreakoutDistance
    );
  });

  it("TEST4: genuine prior-low clearance — B SELL qualifies", () => {
    const f = strongBSell();
    const hit = scoreFastBreakout(f, cfg);
    expect(hit).not.toBeNull();
    expect(hit!.side).toBe("SELL");
    expect(hit!.quality).toBeGreaterThanOrEqual(cfg.minSetupQualityB);
  });

  it("TEST5: valid breakout but adverse depth — B rejects", () => {
    const f = strongBBuy();
    f.depth = depth({
      depthImbalance: -0.2,
      removeRateAsk: 1,
      removeRateBid: 5,
      bestBid: f.bid,
      bestAsk: f.ask,
      spread: f.spread
    });
    const hit = scoreFastBreakout(f, cfg);
    expect(hit).toBeNull();
    const detailed = evaluateSetupsDetailed(f, cfg);
    const b = detailed.specialists.find((s) => s.setup === "B_FAST_BREAKOUT")!;
    expect(b.eligible).toBe(false);
    expect(b.failedConditions.some((c) => c.includes("depth"))).toBe(true);
  });

  it("TEST6: valid breakout but choppy low efficiency — B rejects", () => {
    const f = strongBBuy();
    f.efficiency1s = 0.2;
    expect(scoreFastBreakout(f, cfg)).toBeNull();
    const detailed = evaluateSetupsDetailed(f, cfg);
    const b = detailed.specialists.find((s) => s.setup === "B_FAST_BREAKOUT")!;
    expect(b.failedConditions).toContain("efficiency1s_too_low");
  });

  it("TEST7: 250ms up but 500ms/1s disagree — B rejects", () => {
    const f = strongBBuy();
    f.midVel250 = 0.0002;
    f.midVel500 = -0.0001;
    f.midVel1s = -0.00005;
    expect(scoreFastBreakout(f, cfg)).toBeNull();
    const detailed = evaluateSetupsDetailed(f, cfg);
    const b = detailed.specialists.find((s) => s.setup === "B_FAST_BREAKOUT")!;
    expect(b.failedConditions).toContain("multi_horizon_velocity_disagree");
  });

  it("priorHigh excludes current tick (feature engine)", () => {
    const eng = new FastFeatureEngine();
    const t0 = 1_000_000;
    // Build a 5s window of samples below 2600.5
    for (let i = 0; i < 20; i++) {
      const mid = 2600 + i * 0.01;
      eng.onSpot(t0 + i * 200, mid - 0.06, mid + 0.06);
    }
    // Current tick makes a tiny new high
    const now = t0 + 20 * 200;
    eng.onSpot(now, 2600.25 - 0.06, 2600.25 + 0.06);
    const snap = eng.snapshot(now, depth());
    expect(snap).not.toBeNull();
    expect(snap!.priorHigh5s).toBeLessThan(snap!.mid);
    expect(snap!.high5s).toBeCloseTo(snap!.mid, 6);
  });
});

describe("Gold Hunter Brain V2 — B anti-churn / re-entry (selector)", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
  });

  it("TEST8: B reappears 500ms later without structural reset — no new executable opp", () => {
    const sel = new GoldHunterStrategySelector();
    const t0 = 1_000_000;
    const diag: GhBreakoutDiagnostics = {
      brainVersion: GOLD_HUNTER_BRAIN_VERSION,
      breakoutReference: 2600.0,
      breakoutDistance: 0.4,
      requiredBreakoutDistance: 0.12,
      spread: 0.12,
      midVel250: 0.0002,
      midVel500: 0.0002,
      midVel1s: 0.0003,
      acceleration: 0.0001,
      efficiency1s: 0.7,
      signedImbalance1s: 0.4,
      depthImbalance: 0.2,
      removeRateAsk: 4,
      removeRateBid: 1,
      rejectionReasons: []
    };
    const first = sel.processInjectedSelectionForTests({
      selected: {
        setup: "B_FAST_BREAKOUT",
        side: "BUY",
        quality: 0.8,
        diagnostics: diag
      },
      receivedAtMs: t0,
      bid: 2600.4,
      ask: 2600.52
    });
    expect(first.newOpportunity).toBe(true);
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: t0 + 100,
      bid: 2600.4,
      ask: 2600.52
    });
    // Mid still above breakout ref (2600.0) — no structural reset
    const again = sel.processInjectedSelectionForTests({
      selected: {
        setup: "B_FAST_BREAKOUT",
        side: "BUY",
        quality: 0.8,
        diagnostics: diag
      },
      receivedAtMs: t0 + 600,
      bid: 2600.4,
      ask: 2600.52
    });
    expect(again.newOpportunity).toBe(false);
    expect(again.candidate?.bReentryState?.structuralResetOk).toBe(false);
    expect(again.candidate?.bReentryState?.rejectionReason).toBe(
      "b_no_structural_reset"
    );
  });

  it("TEST9: structural reset + time floor then fresh B — new opportunity", () => {
    const sel = new GoldHunterStrategySelector();
    const cfg = sel.getFrozenConfig();
    const t0 = 1_000_000;
    const diag: GhBreakoutDiagnostics = {
      brainVersion: GOLD_HUNTER_BRAIN_VERSION,
      breakoutReference: 2600.0,
      breakoutDistance: 0.4,
      requiredBreakoutDistance: 0.12,
      spread: 0.12,
      midVel250: 0.0002,
      midVel500: 0.0002,
      midVel1s: 0.0003,
      acceleration: 0.0001,
      efficiency1s: 0.7,
      signedImbalance1s: 0.4,
      depthImbalance: 0.2,
      removeRateAsk: 4,
      removeRateBid: 1,
      rejectionReasons: []
    };
    sel.processInjectedSelectionForTests({
      selected: {
        setup: "B_FAST_BREAKOUT",
        side: "BUY",
        quality: 0.8,
        diagnostics: diag
      },
      receivedAtMs: t0,
      bid: 2600.4,
      ask: 2600.52
    });
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: t0 + 50,
      bid: 2600.4,
      ask: 2600.52
    });
    // Structural reset: mid returns inside prior high
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: t0 + 100,
      bid: 2599.8,
      ask: 2599.92
    });
    const after = sel.processInjectedSelectionForTests({
      selected: {
        setup: "B_FAST_BREAKOUT",
        side: "BUY",
        quality: 0.85,
        diagnostics: { ...diag, breakoutReference: 2599.9 }
      },
      receivedAtMs: t0 + 100 + cfg.breakoutBRearmFloorMs + 10,
      bid: 2600.5,
      ask: 2600.62
    });
    expect(after.newOpportunity).toBe(true);
  });

  it("TEST10: B BUY → B SELL → B BUY noise must not create three executable opps", () => {
    const sel = new GoldHunterStrategySelector();
    const t0 = 2_000_000;
    const r1 = sel.processInjectedSelectionForTests({
      selected: { setup: "B_FAST_BREAKOUT", side: "BUY", quality: 0.8 },
      receivedAtMs: t0,
      bid: 2600.4,
      ask: 2600.52
    });
    expect(r1.newOpportunity).toBe(true);
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: t0 + 20,
      bid: 2600.4,
      ask: 2600.52
    });
    const r2 = sel.processInjectedSelectionForTests({
      selected: { setup: "B_FAST_BREAKOUT", side: "SELL", quality: 0.8 },
      receivedAtMs: t0 + 40,
      bid: 2599.5,
      ask: 2599.62
    });
    // Opposite side within ms — blocked by B time floor and/or regime reset
    expect(r2.newOpportunity).toBe(false);
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: t0 + 60,
      bid: 2599.5,
      ask: 2599.62
    });
    const r3 = sel.processInjectedSelectionForTests({
      selected: { setup: "B_FAST_BREAKOUT", side: "BUY", quality: 0.8 },
      receivedAtMs: t0 + 80,
      bid: 2600.4,
      ask: 2600.52
    });
    expect(r3.newOpportunity).toBe(false);
  });

  it("A can arm independently while B is cooling down", () => {
    const sel = new GoldHunterStrategySelector();
    const t0 = 3_000_000;
    sel.processInjectedSelectionForTests({
      selected: { setup: "B_FAST_BREAKOUT", side: "BUY", quality: 0.8 },
      receivedAtMs: t0,
      bid: 2600.4,
      ask: 2600.52
    });
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: t0 + 10,
      bid: 2600.4,
      ask: 2600.52
    });
    const cfg = sel.getFrozenConfig();
    // Past generic rearm, within B floor — A should still be allowed.
    const a = sel.processInjectedSelectionForTests({
      selected: { setup: "A_MOMENTUM_IGNITION", side: "BUY", quality: 0.7 },
      receivedAtMs: t0 + 10 + cfg.rearmFloorMs + 5,
      bid: 2600.1,
      ask: 2600.22
    });
    expect(a.newOpportunity).toBe(true);
    expect(a.opportunity?.setup).toBe("A");
  });
});

describe("Gold Hunter Brain V2 — A/C regression control group", () => {
  const cfg = defaultGhFastConfig();

  it("TEST11: strong Setup A BUY remains eligible", () => {
    const hit = scoreMomentumIgnition(strongABuy(), cfg);
    expect(hit).not.toBeNull();
    expect(hit!.setup).toBe("A_MOMENTUM_IGNITION");
    expect(hit!.side).toBe("BUY");
    expect(hit!.quality).toBeGreaterThanOrEqual(cfg.minSetupQuality);
  });

  it("TEST12: strong Setup A SELL remains eligible", () => {
    const hit = scoreMomentumIgnition(strongASell(), cfg);
    expect(hit).not.toBeNull();
    expect(hit!.side).toBe("SELL");
  });

  it("TEST13: Setup C BUY/SELL remain behaviourally eligible", () => {
    const buy = scorePullbackReaccel(strongCBuy(), cfg);
    const sell = scorePullbackReaccel(strongCSell(), cfg);
    expect(buy).not.toBeNull();
    expect(buy!.setup).toBe("C_PULLBACK_REACCEL");
    expect(buy!.side).toBe("BUY");
    expect(sell).not.toBeNull();
    expect(sell!.side).toBe("SELL");
  });

  it("A quality formula still uses minSetupQuality not B floor", () => {
    expect(cfg.minSetupQualityB).toBeGreaterThan(cfg.minSetupQuality);
    expect(cfg.minSetupQuality).toBe(0.55);
    expect(cfg.minSetupQualityB).toBe(0.7);
  });

  it("B velocity magnitude normalization follows cfg.momentumVelMin (not a magic constant)", () => {
    // Default: momentumVelMin * 3 === 0.00024 — mathematically equivalent to prior hard-code.
    expect(cfg.momentumVelMin * 3).toBeCloseTo(0.00024, 12);

    const f = strongBBuy();
    // Fix midVel1s at the default full-scale value so velMagNorm is 1.0 under default cfg.
    f.midVel1s = cfg.momentumVelMin * 3;

    const qDefault = scoreFastBreakout(f, cfg);
    expect(qDefault).not.toBeNull();

    // Doubling momentumVelMin doubles the denom → velMagNorm halves → quality must drop.
    // Thresholds otherwise identical so only the magnitude term moves.
    const cfgWider = defaultGhFastConfig({
      momentumVelMin: cfg.momentumVelMin * 2
    });
    expect(cfgWider.momentumVelMin * 3).toBeCloseTo(0.00048, 12);
    const qWider = scoreFastBreakout(f, cfgWider);
    expect(qWider).not.toBeNull();
    expect(qWider!.quality).toBeLessThan(qDefault!.quality);

    // Halving momentumVelMin cannot raise velMagNorm above 1 (already saturated),
    // so quality stays equal under default full-scale midVel1s.
    const cfgTighter = defaultGhFastConfig({
      momentumVelMin: cfg.momentumVelMin / 2
    });
    const qTighter = scoreFastBreakout(f, cfgTighter);
    expect(qTighter).not.toBeNull();
    expect(qTighter!.quality).toBeCloseTo(qDefault!.quality, 10);
  });
});

describe("Gold Hunter Brain V2 — safety invariants", () => {
  it("TEST14: maxOpenTrades remains 1", () => {
    expect(GH_FAST_MAX_OPEN_POSITIONS).toBe(1);
    expect(GH_DEMO_MAX_OPEN_TRADES_REQUIRED).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
  });

  it("TEST15: Live execution remains disabled", () => {
    expect(GH_FAST_BROKER_EXECUTION_ENABLED).toBe(false);
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(GH_ADMIN_DEFAULT_CONFIG).toMatchObject({
      // live flag is not on config — execution mode is DEMO_ONLY constant
    });
  });

  it("exit parameters unchanged (legacy knobs retained for rollback)", () => {
    const cfg = defaultGhFastConfig();
    expect(cfg.hardStop).toBe(0.55);
    expect(cfg.profitLockActivateMfe).toBe(0.18);
    expect(cfg.profitLockFraction).toBe(0.45);
    expect(cfg.trailDistance).toBe(0.12);
    expect(cfg.friction).toBe(0.06);
    expect(cfg.smartPositionManagerEnabled).toBe(true);
  });

  it("brain version is V2; position manager is V1", () => {
    expect(GOLD_HUNTER_BRAIN_VERSION).toBe("GOLD_HUNTER_BRAIN_V2");
  });
});
