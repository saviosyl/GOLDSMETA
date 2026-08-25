/**
 * SMART_LOSS_CONTROLLER_V1 — BUY/SELL exit + entry-gate + safety tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  defaultGhFastConfig,
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION,
  GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
  GH_FAST_MAX_OPEN_POSITIONS,
  GH_FAST_BROKER_EXECUTION_ENABLED,
  getFrozenGhFastIdentity,
  resetFrozenGhFastIdentityForTests,
  computeSettledRealisedR
} from "../../../src/services/goldHunterAdmin/abc";
import {
  openTrade,
  updateOpenTrade,
  evaluateOpenExit
} from "../../../src/services/goldHunterAdmin/abc/exits";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import {
  GoldHunterStrategySelector,
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  applyBrokerSettledClose,
  notifySelectorOfSettledGoldHunterClose,
  realisedRFromSettledDemoTrade
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_EXECUTION_MODE,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { GH_DEMO_MAX_OPEN_TRADES_REQUIRED } from "../../../src/services/goldHunterAdmin/configValidation";

const ENTRY = 2600;
const HARD = 0.55;

function cfgLc(
  over: Partial<ReturnType<typeof defaultGhFastConfig>> = {}
) {
  return defaultGhFastConfig({
    smartPositionManagerEnabled: true,
    smartLossControllerEnabled: true,
    spmMinStopDistance: 0.01,
    ...over
  });
}

function feat(
  bid: number,
  ask: number,
  over: Partial<GhFastFeatureSnapshot> = {}
): GhFastFeatureSnapshot {
  const mid = (bid + ask) / 2;
  const depthBase: DepthBookStats = {
    available: true,
    topBidDepth: 10,
    topAskDepth: 10,
    bidDepthN: 10,
    askDepthN: 10,
    bidLevels: 3,
    askLevels: 3,
    depthRatio: 1,
    depthImbalance: 0,
    weightedImbalance: 0,
    liquidityAddedBid: 0,
    liquidityAddedAsk: 0,
    liquidityRemovedBid: 0,
    liquidityRemovedAsk: 0,
    addRateBid: 0,
    addRateAsk: 0,
    removeRateBid: 0,
    removeRateAsk: 0,
    bestBid: bid,
    bestAsk: ask,
    spread: ask - bid,
    crossed: false,
    lastUpdateMs: 0,
    lastValidBookMs: 0,
    consecutiveInvalidSnapshots: 0,
    bookGeneration: 1,
    resyncCount: 0,
    deleteHits: 0
  };
  return {
    bid,
    ask,
    mid,
    spread: ask - bid,
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
    depth: depthBase,
    ...over,
    depth: (over.depth
      ? { ...depthBase, ...over.depth }
      : depthBase) as DepthBookStats
  };
}

function buyTrade() {
  return openTrade({
    tradeId: "buy-lc-1",
    side: "BUY",
    setup: "A_MOMENTUM_IGNITION",
    entryTs: Date.now(),
    bid: ENTRY - 0.05,
    ask: ENTRY,
    trailDistance: 0.12
  });
}

function sellTrade() {
  return openTrade({
    tradeId: "sell-lc-1",
    side: "SELL",
    setup: "A_MOMENTUM_IGNITION",
    entryTs: Date.now(),
    bid: ENTRY,
    ask: ENTRY + 0.05,
    trailDistance: 0.12
  });
}

describe("SMART_LOSS_CONTROLLER_V1 — BUY exits", () => {
  const cfg = cfgLc();

  it("normal noise survives (no exit)", () => {
    const t = buyTrade();
    const bid = ENTRY - HARD * 0.1;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05, {
          acceleration: -cfg.momentumVelMin * 0.5,
          signedImbalance1s: -0.05,
          midVel250: -cfg.momentumVelMin * 0.5
        }),
        cfg,
        dataOk: true
      })
    ).toBeNull();
  });

  it("single bad tick does not early-exit", () => {
    const t = buyTrade();
    const bid = ENTRY - HARD * 0.25;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    // Only velocity against — 1 confirm
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05, {
          midVel250: -cfg.momentumVelMin * 3,
          acceleration: 0,
          signedImbalance1s: 0,
          depth: { ...feat(bid, bid + 0.05).depth, depthImbalance: 0 }
        }),
        cfg,
        dataOk: true
      })
    ).toBeNull();
  });

  it("3-confirm thesis failure exits only after 2 consecutive snapshots", () => {
    const t = buyTrade();
    const bid = ENTRY - HARD * 0.25;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    t.timeInTradeMs = 2_000;
    const hostile = feat(bid, bid + 0.05, {
      acceleration: -cfg.momentumVelMin * 2,
      signedImbalance1s: -0.3,
      midVel250: -cfg.momentumVelMin * 2,
      depth: { ...feat(bid, bid + 0.05).depth, depthImbalance: -0.35 }
    });
    expect(evaluateOpenExit({ trade: t, f: hostile, cfg, dataOk: true })).toBeNull();
    expect(t.slcEarlyFailurePersistCount).toBe(1);
    expect(
      evaluateOpenExit({ trade: t, f: hostile, cfg, dataOk: true })
    ).toBe("SMART_EARLY_THESIS_FAILURE");
  });

  it("isolated 3-confirm snapshot does not early-exit (persistence reset)", () => {
    const t = buyTrade();
    const bid = ENTRY - HARD * 0.25;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    t.timeInTradeMs = 2_000;
    const hostile = feat(bid, bid + 0.05, {
      acceleration: -cfg.momentumVelMin * 2,
      signedImbalance1s: -0.3,
      midVel250: -cfg.momentumVelMin * 2,
      depth: { ...feat(bid, bid + 0.05).depth, depthImbalance: -0.35 }
    });
    expect(evaluateOpenExit({ trade: t, f: hostile, cfg, dataOk: true })).toBeNull();
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05),
        cfg,
        dataOk: true
      })
    ).toBeNull();
    expect(t.slcEarlyFailurePersistCount).toBe(0);
    expect(evaluateOpenExit({ trade: t, f: hostile, cfg, dataOk: true })).toBeNull();
    expect(t.slcEarlyFailurePersistCount).toBe(1);
  });

  it("-0.45R soft loss exits SMART_SOFT_MAX_LOSS", () => {
    const t = buyTrade();
    const bid = ENTRY - HARD * (cfg.slcSoftMaxLossR + 0.01);
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05),
        cfg,
        dataOk: true
      })
    ).toBe("SMART_SOFT_MAX_LOSS");
  });

  it("existing -1R hard protection remains", () => {
    const t = buyTrade();
    const bid = ENTRY - HARD - 0.02;
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05),
        cfg,
        dataOk: true
      })
    ).toBe("HARD_PROTECTION");
  });

  it("small profitable deterioration harvests after 2 consecutive snapshots", () => {
    const harvestCfg = cfgLc({ slcSmallProfitHarvestEnabled: true });
    const t = buyTrade();
    // MFE ~0.4R
    const peak = ENTRY + HARD * 0.4;
    updateOpenTrade(t, peak, peak + 0.05, harvestCfg);
    // Retrace to ~0.22R — still net profitable after friction+spread costs
    const bid = ENTRY + HARD * 0.22;
    updateOpenTrade(t, bid, bid + 0.05, harvestCfg);
    t.timeInTradeMs = 2_000;
    const fade = feat(bid, bid + 0.05, {
      acceleration: -harvestCfg.momentumVelMin,
      signedImbalance1s: -0.25,
      midVel250: -harvestCfg.momentumVelMin * 0.5,
      depth: { ...feat(bid, bid + 0.05).depth, depthImbalance: -0.3 }
    });
    expect(
      evaluateOpenExit({ trade: t, f: fade, cfg: harvestCfg, dataOk: true })
    ).toBeNull();
    expect(
      evaluateOpenExit({ trade: t, f: fade, cfg: harvestCfg, dataOk: true })
    ).toBe("SMART_SMALL_PROFIT_HARVEST");
  });

  it("Revision 03 default does not force a tiny-profit harvest", () => {
    const t = buyTrade();
    const peak = ENTRY + HARD * 0.4;
    updateOpenTrade(t, peak, peak + 0.05, cfg);
    const bid = ENTRY + HARD * 0.22;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    t.timeInTradeMs = 2_000;
    const fade = feat(bid, bid + 0.05, {
      acceleration: -cfg.momentumVelMin,
      signedImbalance1s: -0.25,
      midVel250: -cfg.momentumVelMin * 0.5,
      depth: { ...feat(bid, bid + 0.05).depth, depthImbalance: -0.3 }
    });
    expect(evaluateOpenExit({ trade: t, f: fade, cfg, dataOk: true })).toBeNull();
    expect(evaluateOpenExit({ trade: t, f: fade, cfg, dataOk: true })).toBeNull();
  });

  it("healthy small-profit trade stays open", () => {
    const t = buyTrade();
    const peak = ENTRY + HARD * 0.4;
    updateOpenTrade(t, peak, peak + 0.05, cfg);
    const bid = ENTRY + HARD * 0.35;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05, {
          acceleration: cfg.momentumVelMin,
          signedImbalance1s: 0.2,
          midVel250: cfg.momentumVelMin * 2,
          depth: { ...feat(bid, bid + 0.05).depth, depthImbalance: 0.2 }
        }),
        cfg,
        dataOk: true
      })
    ).toBeNull();
  });

  it("+1R hands management to Smart PM (PROTECTED)", () => {
    const t = buyTrade();
    const bid = ENTRY + HARD * 1.05;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(t.smartPmState).toBe("PROTECTED");
    expect(t.maxFavourableR!).toBeGreaterThanOrEqual(1);
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05),
        cfg,
        dataOk: true
      })
    ).toBeNull();
    expect(t.lastLossControllerAssessment?.handedOffToSmartPm).toBe(true);
  });

  it("+3R RUNNER is not interrupted by loss controller", () => {
    const t = buyTrade();
    const peak = ENTRY + HARD * 3.2;
    updateOpenTrade(t, peak, peak + 0.05, cfg);
    expect(t.smartPmState).toBe("RUNNER");
    const bid = ENTRY + HARD * 2.8;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    // Adverse flow that would early-fail below 1R must NOT soft LC exit
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05, {
          acceleration: -cfg.momentumVelMin * 3,
          signedImbalance1s: -0.4,
          midVel250: -cfg.momentumVelMin * 3,
          depth: { ...feat(bid, bid + 0.05).depth, depthImbalance: -0.4 }
        }),
        cfg,
        dataOk: true
      })
    ).toBeNull();
    expect(t.smartPmState).toBe("RUNNER");
  });
});

describe("SMART_LOSS_CONTROLLER_V1 — SELL mirror", () => {
  const cfg = cfgLc();

  it("SELL soft max loss + early thesis + small harvest invert correctly", () => {
    const soft = sellTrade();
    const askSoft = ENTRY + HARD * (cfg.slcSoftMaxLossR + 0.01);
    updateOpenTrade(soft, askSoft - 0.05, askSoft, cfg);
    expect(
      evaluateOpenExit({
        trade: soft,
        f: feat(askSoft - 0.05, askSoft),
        cfg,
        dataOk: true
      })
    ).toBe("SMART_SOFT_MAX_LOSS");

    const early = sellTrade();
    const askE = ENTRY + HARD * 0.25;
    updateOpenTrade(early, askE - 0.05, askE, cfg);
    early.timeInTradeMs = 2_000;
    const hostile = feat(askE - 0.05, askE, {
      acceleration: cfg.momentumVelMin * 2,
      signedImbalance1s: 0.3,
      midVel250: cfg.momentumVelMin * 2,
      depth: { ...feat(askE - 0.05, askE).depth, depthImbalance: 0.35 }
    });
    expect(evaluateOpenExit({ trade: early, f: hostile, cfg, dataOk: true })).toBeNull();
    expect(
      evaluateOpenExit({ trade: early, f: hostile, cfg, dataOk: true })
    ).toBe("SMART_EARLY_THESIS_FAILURE");

    const harvestCfg = cfgLc({ slcSmallProfitHarvestEnabled: true });
    const harvest = sellTrade();
    const peak = ENTRY - HARD * 0.4;
    updateOpenTrade(harvest, peak - 0.05, peak, harvestCfg);
    const askH = ENTRY - HARD * 0.22;
    updateOpenTrade(harvest, askH - 0.05, askH, harvestCfg);
    harvest.timeInTradeMs = 2_000;
    const fade = feat(askH - 0.05, askH, {
      acceleration: harvestCfg.momentumVelMin,
      signedImbalance1s: 0.25,
      midVel250: harvestCfg.momentumVelMin * 0.5,
      depth: { ...feat(askH - 0.05, askH).depth, depthImbalance: 0.3 }
    });
    expect(
      evaluateOpenExit({ trade: harvest, f: fade, cfg: harvestCfg, dataOk: true })
    ).toBeNull();
    expect(
      evaluateOpenExit({
        trade: harvest,
        f: fade,
        cfg: harvestCfg,
        dataOk: true
      })
    ).toBe("SMART_SMALL_PROFIT_HARVEST");
  });

  it("SELL single bad tick does not early-exit", () => {
    const t = sellTrade();
    const ask = ENTRY + HARD * 0.25;
    updateOpenTrade(t, ask - 0.05, ask, cfg);
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(ask - 0.05, ask, {
          midVel250: cfg.momentumVelMin * 3
        }),
        cfg,
        dataOk: true
      })
    ).toBeNull();
  });

  it("SELL +3R RUNNER not interrupted", () => {
    const t = sellTrade();
    updateOpenTrade(t, ENTRY - HARD * 3.2 - 0.05, ENTRY - HARD * 3.2, cfg);
    expect(t.smartPmState).toBe("RUNNER");
    const ask = ENTRY - HARD * 2.8;
    updateOpenTrade(t, ask - 0.05, ask, cfg);
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(ask - 0.05, ask, {
          acceleration: cfg.momentumVelMin * 3,
          signedImbalance1s: 0.4,
          midVel250: cfg.momentumVelMin * 3,
          depth: { ...feat(ask - 0.05, ask).depth, depthImbalance: 0.4 }
        }),
        cfg,
        dataOk: true
      })
    ).toBeNull();
  });
});

describe("SMART_LOSS_CONTROLLER_V1 — streak + circuit breaker", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
  });

  it("2-loss streak activates LOSS_STREAK_GUARD; structural reset restores entry", () => {
    const sel = new GoldHunterStrategySelector();
    const cfg = cfgLc();
    const t0 = 8_000_000;

    for (let i = 0; i < 2; i++) {
      sel.notifyTradeClosed({
        side: "BUY",
        setup: "A",
        entryPrice: 2600,
        result: "LOSS",
        opportunityId: `opp-loss-${i}`,
        closedAtMs: t0 + i * 1000,
        realisedR: -0.5,
        tradeId: `gh-loss-${i}`
      });
    }
    const st = sel.getLossControllerEntryState();
    expect(st.consecutiveLosses).toBe(2);
    expect(st.lossStreakGuardActive).toBe(true);

    // Too soon — blocked
    const early = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: t0 + 2000 + 5_000,
      mid: 2599.5,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(early.ok).toBe(false);
    expect(early.rejectionReason).toBe("WAIT_LOSS_STREAK_GUARD");

    // Force structural reset via mid below entry, then wait 120s + direction
    sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: t0 + 2000 + cfg.slcLossStreakResetMs + 100,
      mid: 2599.0,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    // Second call after structure may clear (first call may have set structure)
    const recovered = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: t0 + 2000 + cfg.slcLossStreakResetMs + 200,
      mid: 2599.0,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(recovered.ok).toBe(true);
    expect(sel.getLossControllerEntryState().lossStreakGuardActive).toBe(false);
  });

  it("-2R rolling circuit breaker over 8 trades activates; recovery resets it", () => {
    const sel = new GoldHunterStrategySelector();
    const cfg = cfgLc();
    const t0 = 9_000_000;

    for (let i = 0; i < 8; i++) {
      sel.notifyTradeClosed({
        side: "BUY",
        setup: "A",
        entryPrice: 2600,
        result: "LOSS",
        opportunityId: `opp-cb-${i}`,
        closedAtMs: t0 + i * 500,
        realisedR: -0.25,
        tradeId: `gh-cb-${i}`
      });
    }
    const st = sel.getLossControllerEntryState();
    expect(st.rollingRealisedR).toBeLessThanOrEqual(-2);
    expect(st.lossCircuitBreakerActive).toBe(true);
    expect(st.circuitBreakerReason).toBe("ROLLING_REALISED_R");

    const blocked = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: t0 + 3600,
      mid: 2599.0,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.rejectionReason).toBe("WAIT_LOSS_CIRCUIT_BREAKER");

    // Structural mid + time + direction
    sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: t0 + 3500 + cfg.slcCircuitBreakerResetMs + 50,
      mid: 2599.0,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    const recovered = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: t0 + 3500 + cfg.slcCircuitBreakerResetMs + 100,
      mid: 2599.0,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(recovered.ok).toBe(true);
    const after = sel.getLossControllerEntryState();
    expect(after.lossCircuitBreakerActive).toBe(false);
    expect(after.rollingRealisedR).toBe(0);
  });
});

describe("SMART_LOSS_CONTROLLER_V1 — safety invariants", () => {
  it("versions + soak label + Demo safety unchanged", () => {
    resetFrozenGhFastIdentityForTests();
    const id = getFrozenGhFastIdentity();
    expect(id.soakLabel).toBe(
      "BRAIN_V6_R03_PULSE_GUARD_RELIABILITY_SMART_PM_V1_SMART_LOSS_V1_DEMO"
    );
    expect(GOLD_HUNTER_BRAIN_VERSION).toBe("GOLD_HUNTER_BRAIN_V6");
    expect(GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION).toBe(
      "SMART_POSITION_MANAGER_V1"
    );
    expect(GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION).toBe(
      "SMART_LOSS_CONTROLLER_V1"
    );
    const cfg = defaultGhFastConfig();
    expect(cfg.smartLossControllerEnabled).toBe(true);
    expect(cfg.slcSoftMaxLossR).toBe(0.45);
    expect(cfg.hardStop).toBe(0.55);
    expect(cfg.entrySlippageRiskBuffer).toBe(0.05);
    expect(cfg.entryMinRewardRisk).toBe(1.05);
    expect(cfg.slcSmallProfitHarvestEnabled).toBe(false);
    expect(GH_FAST_MAX_OPEN_POSITIONS).toBe(1);
    expect(GH_DEMO_MAX_OPEN_TRADES_REQUIRED).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.riskPerTradePct).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.allocatedCapitalEur).toBe(5000);
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(GH_FAST_BROKER_EXECUTION_ENABLED).toBe(false);
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
  });

  it("openTrade stamps lossControllerVersion", () => {
    const t = buyTrade();
    expect(t.brainVersion).toBe("GOLD_HUNTER_BRAIN_V6");
    expect(t.positionManagerVersion).toBe("SMART_POSITION_MANAGER_V1");
    expect(t.lossControllerVersion).toBe("SMART_LOSS_CONTROLLER_V1");
  });
});

describe("SMART_LOSS_CONTROLLER_V1 — exactly-once notify + true realised R", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
  });

  it("duplicate LOSS notify for same tradeId counts once", () => {
    const sel = new GoldHunterStrategySelector();
    const payload = {
      side: "BUY" as const,
      setup: "A" as const,
      entryPrice: 2600,
      result: "LOSS" as const,
      opportunityId: "opp-dup",
      closedAtMs: 1_000_000,
      realisedR: -0.7,
      tradeId: "gh-trade-dup-1"
    };
    sel.notifyTradeClosed(payload);
    sel.notifyTradeClosed(payload);
    sel.notifyTradeClosed({ ...payload, closedAtMs: 1_000_500 });
    const st = sel.getLossControllerEntryState();
    expect(st.consecutiveLosses).toBe(1);
    expect(st.rollingSampleCount).toBe(1);
    expect(st.rollingRealisedR).toBeCloseTo(-0.7, 9);
  });

  it("three DISTINCT losses → consecutiveLosses = 3", () => {
    const sel = new GoldHunterStrategySelector();
    for (let i = 0; i < 3; i++) {
      sel.notifyTradeClosed({
        side: "BUY",
        setup: "A",
        entryPrice: 2600,
        result: "LOSS",
        tradeId: `gh-distinct-${i}`,
        realisedR: -0.7,
        closedAtMs: 2_000_000 + i
      });
    }
    expect(sel.getLossControllerEntryState().consecutiveLosses).toBe(3);
    expect(sel.getLossControllerEntryState().rollingSampleCount).toBe(3);
  });

  it("computeSettledRealisedR BUY/SELL win/loss and soft-loss / small harvest", () => {
    // BUY loss soft ~-0.70R
    expect(
      computeSettledRealisedR({
        side: "BUY",
        entry: 2600,
        exit: 2600 - HARD * 0.7,
        originalRiskPrice: HARD
      })
    ).toBeCloseTo(-0.7, 9);
    // BUY win small harvest ~+0.22R
    expect(
      computeSettledRealisedR({
        side: "BUY",
        entry: 2600,
        exit: 2600 + HARD * 0.22,
        originalRiskPrice: HARD
      })
    ).toBeCloseTo(0.22, 9);
    // SELL loss
    expect(
      computeSettledRealisedR({
        side: "SELL",
        entry: 2600,
        exit: 2600 + HARD * 0.7,
        originalRiskPrice: HARD
      })
    ).toBeCloseTo(-0.7, 9);
    // SELL win
    expect(
      computeSettledRealisedR({
        side: "SELL",
        entry: 2600,
        exit: 2600 - HARD * 0.22,
        originalRiskPrice: HARD
      })
    ).toBeCloseTo(0.22, 9);
    // Missing exit → null (no invent)
    expect(
      computeSettledRealisedR({
        side: "BUY",
        entry: 2600,
        exit: null,
        originalRiskPrice: HARD
      })
    ).toBeNull();
  });

  it("settlement notify uses entry/exit/risk; delayed duplicate does not double-count", () => {
    const owner = "owner-slc-settle-test";
    getGoldHunterStrategySelector(owner);

    const baseTrade = {
      goldHunterTradeId: "gh-settle-1",
      strategy: "GOLD_HUNTER",
      environment: "DEMO",
      setup: "A",
      side: "BUY",
      signalTs: null,
      orderTs: null,
      fillTs: "2026-08-19T10:00:00.000Z",
      closeTs: null,
      entry: 2600,
      exit: null,
      stop: 2600 - HARD,
      initialRiskPrice: HARD,
      entrySpread: 0.1,
      durationMs: null,
      mfe: null,
      mae: null,
      grossPnlEur: null,
      netPnlEur: null,
      result: "OPEN",
      exitReason: "SMART_SOFT_MAX_LOSS",
      brokerOrderId: null,
      brokerPositionId: "pos-1",
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      signalId: "sig-1"
    } as GoldHunterDemoTrade;

    const settled = applyBrokerSettledClose({
      trade: baseTrade,
      deal: {
        dealId: "d1",
        orderId: "o1",
        positionId: "pos-1",
        netPnl: -3.5,
        grossPnl: -3.5,
        commission: 0,
        swap: 0,
        closePrice: 2600 - HARD * 0.7,
        closedAt: "2026-08-19T10:01:00.000Z",
        closedVolumeLots: 0.01
      }
    });
    expect(settled.exit).toBeCloseTo(2600 - HARD * 0.7, 6);
    expect(realisedRFromSettledDemoTrade(settled)).toBeCloseTo(-0.7, 9);

    notifySelectorOfSettledGoldHunterClose({ ownerUid: owner, trade: settled });
    // Delayed settlement retry
    notifySelectorOfSettledGoldHunterClose({ ownerUid: owner, trade: settled });

    const st = getGoldHunterStrategySelector(owner).getLossControllerEntryState();
    expect(st.consecutiveLosses).toBe(1);
    expect(st.rollingSampleCount).toBe(1);
    expect(st.rollingRealisedR).toBeCloseTo(-0.7, 9);
  });

  it("missing realised inputs do not invent rolling R", () => {
    const sel = new GoldHunterStrategySelector();
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: 2600,
      result: "LOSS",
      tradeId: "gh-no-r",
      realisedR: null,
      closedAtMs: 3_000_000
    });
    const st = sel.getLossControllerEntryState();
    expect(st.consecutiveLosses).toBe(1);
    expect(st.rollingSampleCount).toBe(0);
    expect(st.rollingRealisedR).toBe(0);
  });
});
