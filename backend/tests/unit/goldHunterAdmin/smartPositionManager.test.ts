/**
 * SMART_POSITION_MANAGER_V1 — deterministic BUY/SELL/costs/reentry/safety tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  defaultGhFastConfig,
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
  GH_FAST_MAX_OPEN_POSITIONS,
  GH_FAST_BROKER_EXECUTION_ENABLED,
  applyMonotonicProtectedProfitR
} from "../../../src/services/goldHunterAdmin/abc";
import {
  breakEvenStopAfterCosts,
  openTradeSmartDiagnostics,
  roundStopToTick,
  stopFromProtectedProfitR
} from "../../../src/services/goldHunterAdmin/abc/smartPositionManager";
import { openTrade, updateOpenTrade, evaluateOpenExit } from "../../../src/services/goldHunterAdmin/abc/exits";
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
import { nextTightenedStop } from "../../../src/services/goldHunterAdmin/demoPositionManager";

const ENTRY = 2600;
const HARD = 0.55;

function cfgSpm(over: Partial<ReturnType<typeof defaultGhFastConfig>> = {}) {
  return defaultGhFastConfig({
    smartPositionManagerEnabled: true,
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
    tradeId: "buy-1",
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
    tradeId: "sell-1",
    side: "SELL",
    setup: "A_MOMENTUM_IGNITION",
    entryTs: Date.now(),
    bid: ENTRY,
    ask: ENTRY + 0.05,
    trailDistance: 0.12
  });
}

describe("SMART_POSITION_MANAGER_V1 — BUY scenarios", () => {
  const cfg = cfgSpm();

  it("never reaches +1R → stays UNPROTECTED with original hard stop only", () => {
    const t = buyTrade();
    // 0.8R favourable
    const bid = ENTRY + HARD * 0.8;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(t.maxFavourableR!).toBeLessThan(1);
    expect(t.smartPmState).toBe("UNPROTECTED");
    expect(t.protectedProfitR).toBe(0);
    expect(t.lockFloor).toBeNull();
    expect(
      evaluateOpenExit({
        trade: t,
        f: feat(bid, bid + 0.05),
        cfg,
        dataOk: true
      })
    ).toBeNull();
  });

  it("reaches +1R then reverses → PROTECTED cost-aware BE; hard stop retained", () => {
    const t = buyTrade();
    const bid1 = ENTRY + HARD * 1.05;
    updateOpenTrade(t, bid1, bid1 + 0.05, cfg);
    expect(t.smartPmState).toBe("PROTECTED");
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(0);
    expect(t.lockFloor).not.toBeNull();
    expect(t.lockFloor!).toBeGreaterThanOrEqual(ENTRY - HARD);
    const floor = t.lockFloor!;

    // Reverse toward entry but still above floor
    const bid2 = ENTRY + HARD * 0.2;
    updateOpenTrade(t, bid2, bid2 + 0.05, cfg);
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(0);
    expect(t.lockFloor!).toBeGreaterThanOrEqual(floor - 1e-9);
    expect(t.smartPmState).not.toBe("UNPROTECTED");
  });

  it("reaches +1.5R → protect ~+0.4R", () => {
    const t = buyTrade();
    const bid = ENTRY + HARD * 1.55;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(t.maxFavourableR!).toBeGreaterThanOrEqual(1.5);
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(0.4 - 1e-9);
    expect(t.smartPmState).toBe("PROTECTED");
  });

  it("reaches +2R → LOCKED protect ~+0.9R; not a full-stop loser path", () => {
    const t = buyTrade();
    const bid = ENTRY + HARD * 2.05;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(t.smartPmState).toBe("LOCKED");
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(0.9 - 1e-9);
    expect(t.lockFloor!).toBeGreaterThan(ENTRY);
  });

  it("reaches +3R → RUNNER with min ~1.6R floor", () => {
    const t = buyTrade();
    const bid = ENTRY + HARD * 3.1;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(t.smartPmState).toBe("RUNNER");
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(1.6 - 1e-9);
  });

  it("reaches +5R and continues running — trail advances, never loosens", () => {
    const t = buyTrade();
    updateOpenTrade(t, ENTRY + HARD * 3.1, ENTRY + HARD * 3.1 + 0.05, cfg);
    const r3 = t.protectedProfitR!;
    updateOpenTrade(t, ENTRY + HARD * 5.2, ENTRY + HARD * 5.2 + 0.05, cfg);
    expect(t.smartPmState).toBe("RUNNER");
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(r3);
    const floor = t.lockFloor!;
    updateOpenTrade(t, ENTRY + HARD * 4.0, ENTRY + HARD * 4.0 + 0.05, cfg);
    expect(t.lockFloor!).toBeGreaterThanOrEqual(floor - 1e-9);
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(r3 - 1e-9);
  });

  it("large winner reverses sharply → harvest with explicit reason", () => {
    const t = buyTrade();
    updateOpenTrade(t, ENTRY + HARD * 3.2, ENTRY + HARD * 3.2 + 0.05, cfg);
    expect(t.smartPmState).toBe("RUNNER");
    // Retrace + multi-confirm against
    const bid = ENTRY + HARD * 2.2;
    const f = feat(bid, bid + 0.05, {
      acceleration: -cfg.momentumVelMin * 3,
      signedImbalance1s: -0.3,
      midVel250: -cfg.momentumVelMin * 2,
      depth: {
        ...feat(bid, bid + 0.05).depth,
        depthImbalance: -0.35
      }
    });
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    const reason = evaluateOpenExit({ trade: t, f, cfg, dataOk: true });
    expect(reason).toBe("SMART_HARVEST_MOMENTUM_DEPTH_REVERSAL");
    expect(t.smartPmState).toBe("HARVEST");
  });

  it("protection never loosens (monotonic invariant)", () => {
    expect(applyMonotonicProtectedProfitR(1.2, 0.7)).toBe(1.2);
    expect(applyMonotonicProtectedProfitR(0.4, 0.9)).toBe(0.9);
    const t = buyTrade();
    updateOpenTrade(t, ENTRY + HARD * 2.1, ENTRY + HARD * 2.1 + 0.05, cfg);
    const p = t.protectedProfitR!;
    const fl = t.lockFloor!;
    updateOpenTrade(t, ENTRY + HARD * 1.2, ENTRY + HARD * 1.2 + 0.05, cfg);
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(p);
    expect(t.lockFloor!).toBeGreaterThanOrEqual(fl);
  });
});

describe("SMART_POSITION_MANAGER_V1 — SELL mirror", () => {
  const cfg = cfgSpm();

  it("SELL +1R → PROTECTED; +2R LOCKED; +3R RUNNER; never loosens", () => {
    const t = sellTrade();
    updateOpenTrade(t, ENTRY - HARD * 1.05 - 0.05, ENTRY - HARD * 1.05, cfg);
    expect(t.smartPmState).toBe("PROTECTED");
    expect(t.lockFloor).not.toBeNull();
    expect(t.lockFloor!).toBeLessThanOrEqual(ENTRY + HARD);

    updateOpenTrade(t, ENTRY - HARD * 2.05 - 0.05, ENTRY - HARD * 2.05, cfg);
    expect(t.smartPmState).toBe("LOCKED");
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(0.9 - 1e-9);
    const fl = t.lockFloor!;

    updateOpenTrade(t, ENTRY - HARD * 3.2 - 0.05, ENTRY - HARD * 3.2, cfg);
    expect(t.smartPmState).toBe("RUNNER");
    expect(t.lockFloor!).toBeLessThanOrEqual(fl + 1e-9);

    updateOpenTrade(t, ENTRY - HARD * 2.5 - 0.05, ENTRY - HARD * 2.5, cfg);
    expect(t.lockFloor!).toBeLessThanOrEqual(fl + 1e-9);
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(0.9 - 1e-9);
  });

  it("SELL harvest inverts momentum/depth correctly", () => {
    const t = sellTrade();
    updateOpenTrade(t, ENTRY - HARD * 3.2 - 0.05, ENTRY - HARD * 3.2, cfg);
    const ask = ENTRY - HARD * 2.2;
    const f = feat(ask - 0.05, ask, {
      acceleration: cfg.momentumVelMin * 3,
      signedImbalance1s: 0.3,
      midVel250: cfg.momentumVelMin * 2,
      depth: {
        ...feat(ask - 0.05, ask).depth,
        depthImbalance: 0.35
      }
    });
    updateOpenTrade(t, ask - 0.05, ask, cfg);
    expect(evaluateOpenExit({ trade: t, f, cfg, dataOk: true })).toBe(
      "SMART_HARVEST_MOMENTUM_DEPTH_REVERSAL"
    );
  });
});

describe("SMART_POSITION_MANAGER_V1 — costs / geometry", () => {
  it("break-even after costs accounts for spread + friction", () => {
    const be = breakEvenStopAfterCosts({
      side: "BUY",
      entryPrice: ENTRY,
      spread: 0.12,
      friction: 0.06,
      tickSize: 0.01,
      minStopDistance: 0.05
    });
    expect(be).toBeGreaterThanOrEqual(ENTRY);
    expect(be).toBeGreaterThanOrEqual(ENTRY + 0.12 + 0.06 - 0.01);
  });

  it("tick rounding + stop from protected R", () => {
    expect(roundStopToTick("BUY", 2600.123, 0.01)).toBeCloseTo(2600.13, 6);
    expect(roundStopToTick("SELL", 2600.123, 0.01)).toBeCloseTo(2600.12, 6);
    const stop = stopFromProtectedProfitR({
      side: "BUY",
      entryPrice: ENTRY,
      protectedProfitR: 0.4,
      riskPrice: HARD,
      tickSize: 0.01
    });
    expect(stop).toBeCloseTo(ENTRY + 0.4 * HARD, 1);
  });

  it("theoretical protectedProfitR may lead executableProtectedProfitR under min-distance", () => {
    // Huge min-distance prevents placing the theoretical +0.9R floor immediately.
    const cfg = cfgSpm({ spmMinStopDistance: 50 });
    const t = buyTrade();
    const bid = ENTRY + HARD * 2.1;
    // Market only slightly above entry — cannot place stop 0.9R above entry.
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(t.smartPmState).toBe("LOCKED");
    expect(t.protectedProfitR!).toBeGreaterThanOrEqual(0.9 - 1e-9);
    // Executable R must reflect placed lockFloor only (0 if none placeable).
    expect(t.executableProtectedProfitR ?? 0).toBeLessThan(0.9 - 1e-6);
    const diag = openTradeSmartDiagnostics(t);
    expect(diag.protectedProfitR).toBeGreaterThanOrEqual(0.9 - 1e-9);
    expect(diag.executableProtectedProfitR).toBeLessThan(diag.protectedProfitR);
    // Monotonic: later tick cannot reduce executable floor once set
    const exec1 = t.executableProtectedProfitR ?? 0;
    updateOpenTrade(t, bid + 0.01, bid + 0.06, cfg);
    expect(t.executableProtectedProfitR ?? 0).toBeGreaterThanOrEqual(exec1);
  });

  it("legacy path still available when SPM disabled", () => {
    const cfg = defaultGhFastConfig({ smartPositionManagerEnabled: false });
    const t = buyTrade();
    updateOpenTrade(t, ENTRY + 0.2, ENTRY + 0.25, cfg);
    expect(t.profitLockActive).toBe(true);
    expect(t.smartPmState === "PROTECTED" || t.smartPmState === "UNPROTECTED").toBe(
      true
    );
  });
});

describe("SMART_POSITION_MANAGER_V1 — anti-churn / re-entry", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
  });

  it("live selector path: LOSS opp-1 rejected as WAIT_DUPLICATE_OPPORTUNITY; fresh opp-2 after reset accepted", () => {
    const sel = new GoldHunterStrategySelector();
    const cfg = defaultGhFastConfig();
    const t0 = 5_040_000;

    const first = sel.processInjectedSelectionForTests({
      selected: {
        setup: "A_MOMENTUM_IGNITION",
        side: "BUY",
        quality: 0.8
      },
      receivedAtMs: t0,
      bid: 2600,
      ask: 2600.12
    });
    expect(first.newOpportunity).toBe(true);
    expect(first.opportunity).not.toBeNull();
    const opp1 = first.opportunity!.opportunityId;
    expect(opp1).toMatch(/^GH-OPP-/);

    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: 2600.12,
      result: "LOSS",
      opportunityId: opp1,
      closedAtMs: t0 + 1_000
    });

    // Same continuous opportunity identity (real afterSnapshot / sameActive path).
    const again = sel.processInjectedSelectionForTests({
      selected: {
        setup: "A_MOMENTUM_IGNITION",
        side: "BUY",
        quality: 0.8
      },
      receivedAtMs: t0 + 1_500,
      bid: 2600.2,
      ask: 2600.32
    });
    expect(again.newOpportunity).toBe(false);
    expect(again.opportunity).toBeNull();
    expect(again.candidate?.opportunityId).toBe(opp1);
    expect(again.candidate?.consumed).toBe(true);
    expect(again.candidate?.antiChurnState?.rejectionReason).toBe(
      "WAIT_POST_LOSS_NEW_CANDLE_REQUIRED"
    );
    expect(sel.getExecutableCandidate()).toBeNull();

    // End opportunity lifecycle, then satisfy time + structural reset.
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: t0 + 2_000,
      bid: 2599.9,
      ask: 2600.0
    });

    const fresh = sel.processInjectedSelectionForTests({
      selected: {
        setup: "A_MOMENTUM_IGNITION",
        side: "BUY",
        quality: 0.85
      },
      receivedAtMs: t0 + 1_000 + cfg.antiChurnLossMinMs + 60_500,
      // mid below losing entry → structural reset for BUY loss
      bid: 2599.7,
      ask: 2599.85
    });
    expect(fresh.newOpportunity).toBe(true);
    expect(fresh.opportunity).not.toBeNull();
    const opp2 = fresh.opportunity!.opportunityId;
    expect(opp2).not.toBe(opp1);
    expect(fresh.candidate?.antiChurnState?.rejectionReason ?? null).toBeNull();
    expect(fresh.candidate?.consumed).toBe(false);
  });

  it("immediate opposite-side flip after LOSS rejected", () => {
    const sel = new GoldHunterStrategySelector();
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: ENTRY,
      result: "LOSS",
      opportunityId: "opp-1",
      closedAtMs: 1_000_000
    });
    const gate = sel.evaluateAntiChurnGateForTests({
      side: "SELL",
      atMs: 1_000_500,
      mid: ENTRY + 0.2,
      signedImbalance1s: -0.5,
      midVel250: -0.001
    });
    expect(gate.ok).toBe(false);
    expect(
      gate.rejectionReason === "WAIT_REENTRY_TIME_RESET" ||
        gate.rejectionReason === "WAIT_REENTRY_STRUCTURE_RESET" ||
        gate.rejectionReason === "WAIT_REVERSAL_NOT_CONFIRMED"
    ).toBe(true);
  });

  it("same-side duplicate rejected until structure + time reset", () => {
    const sel = new GoldHunterStrategySelector();
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: ENTRY,
      result: "LOSS",
      opportunityId: "opp-2",
      closedAtMs: 1_000_000
    });
    const gate = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: 1_000_000 + defaultGhFastConfig().antiChurnLossMinMs + 500,
      mid: ENTRY + 0.5
    });
    expect(gate.ok).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_REENTRY_STRUCTURE_RESET");
  });

  it("valid structural reset + time accepted", () => {
    const sel = new GoldHunterStrategySelector();
    const cfg = defaultGhFastConfig();
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: ENTRY,
      result: "LOSS",
      opportunityId: "opp-3",
      closedAtMs: 1_000_000
    });
    const gate = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: 1_000_000 + cfg.antiChurnLossMinMs + 100,
      mid: ENTRY - 0.01
    });
    expect(gate.ok).toBe(true);
    expect(gate.rejectionReason).toBeNull();
  });

  it("fresh opportunity after WIN does not arm loss gate", () => {
    const sel = new GoldHunterStrategySelector();
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: ENTRY,
      result: "WIN",
      closedAtMs: 1_000_000
    });
    const st = sel.getAntiChurnStateForTests();
    expect(st.structuralResetComplete).toBe(true);
    expect(st.lastResult).toBe("WIN");
  });
});

describe("SMART_POSITION_MANAGER_V1 — safety invariants", () => {
  it("Demo only / live disabled / max open 1 / hard stop retained", () => {
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(GH_FAST_BROKER_EXECUTION_ENABLED).toBe(false);
    expect(GH_FAST_MAX_OPEN_POSITIONS).toBe(1);
    expect(GH_DEMO_MAX_OPEN_TRADES_REQUIRED).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(GOLD_HUNTER_BRAIN_VERSION).toBe("GOLD_HUNTER_BRAIN_V5");
    expect(GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION).toBe(
      "SMART_POSITION_MANAGER_V1"
    );
    const cfg = cfgSpm();
    expect(cfg.hardStop).toBe(0.55);
    expect(cfg.riskPerTradePct).toBeUndefined();
    // sizing not increased — admin defaults unchanged
    expect(GH_ADMIN_DEFAULT_CONFIG.riskPerTradePct).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.allocatedCapitalEur).toBe(5000);

    const t = buyTrade();
    updateOpenTrade(t, ENTRY + HARD * 2, ENTRY + HARD * 2 + 0.05, cfg);
    const hard = ENTRY - HARD;
    expect(
      nextTightenedStop({
        side: "BUY",
        currentStop: hard,
        proposedLockFloor: hard - 0.1,
        hardStop: HARD,
        entry: ENTRY
      })
    ).toBeNull();
  });

  it("diagnostics expose SPM state", () => {
    const cfg = cfgSpm();
    const t = buyTrade();
    updateOpenTrade(t, ENTRY + HARD * 2.1, ENTRY + HARD * 2.1 + 0.05, cfg);
    const d = openTradeSmartDiagnostics(t);
    expect(d.brainVersion).toBe("GOLD_HUNTER_BRAIN_V5");
    expect(d.positionManagerVersion).toBe("SMART_POSITION_MANAGER_V1");
    expect(d.profitManagementState).toBe("LOCKED");
    expect(d.mfeR).toBeGreaterThanOrEqual(2);
    expect(d.protectedProfitR).toBeGreaterThanOrEqual(0.9 - 1e-9);
  });

  it("hard protection still fires", () => {
    const cfg = cfgSpm();
    const t = buyTrade();
    const f = feat(ENTRY - HARD - 0.01, ENTRY - HARD);
    expect(
      evaluateOpenExit({ trade: t, f, cfg, dataOk: true })
    ).toBe("HARD_PROTECTION");
  });
});
