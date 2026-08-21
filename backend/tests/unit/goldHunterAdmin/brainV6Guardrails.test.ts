import { describe, expect, it } from "vitest";
import { defaultGhFastConfig } from "../../../src/services/goldHunterAdmin/abc/defaults";
import {
  evaluateSetupsDetailed
} from "../../../src/services/goldHunterAdmin/abc/setups";
import type { M1CandleFlowEvaluation } from "../../../src/services/goldHunterAdmin/abc/m1CandleFlow";
import {
  evaluateOpenExit,
  openTrade,
  updateOpenTrade
} from "../../../src/services/goldHunterAdmin/abc/exits";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";

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
    bestAsk: 2600.05,
    spread: 0.05,
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

function feature(
  mid: number,
  side: "BUY" | "SELL",
  over: Partial<GhFastFeatureSnapshot> = {}
): GhFastFeatureSnapshot {
  const buy = side === "BUY";
  const bid = mid - 0.025;
  const ask = mid + 0.025;
  return {
    bid,
    ask,
    mid,
    spread: 0.05,
    bidVel250: 0,
    bidVel500: 0,
    bidVel1s: 0,
    bidVel2s: 0,
    bidVel3s: 0,
    askVel1s: 0,
    midVel250: buy ? 0.0003 : -0.0003,
    midVel500: buy ? 0.00028 : -0.00028,
    midVel1s: buy ? 0.00034 : -0.00034,
    midVel2s: buy ? 0.0003 : -0.0003,
    midVel3s: buy ? 0.00028 : -0.00028,
    acceleration: buy ? 0.00012 : -0.00012,
    updateRate1s: 12,
    signedImbalance1s: buy ? 0.35 : -0.35,
    efficiency1s: 0.65,
    efficiency3s: 0.6,
    high1s: mid + 0.05,
    low1s: mid - 0.05,
    high2s: mid + 0.08,
    low2s: mid - 0.08,
    high5s: mid + 0.2,
    low5s: mid - 0.2,
    high10s: mid + 0.25,
    low10s: mid - 0.25,
    high15s: mid + 0.3,
    low15s: mid - 0.3,
    high30s: mid + 0.35,
    low30s: mid - 0.35,
    priorHigh5s: mid + 0.1,
    priorLow5s: mid - 0.1,
    priorHigh10s: mid + 0.15,
    priorLow10s: mid - 0.15,
    distHigh1s: 0.05,
    distLow1s: 0.05,
    distHigh5s: 0.2,
    distLow5s: 0.2,
    distPriorHigh5s: 0.1,
    distPriorLow5s: 0.1,
    upTouches5s: 2,
    downTouches5s: 1,
    depth: depth(
      buy
        ? { depthImbalance: 0.22, removeRateAsk: 3, removeRateBid: 1 }
        : { depthImbalance: -0.22, removeRateAsk: 1, removeRateBid: 3 }
    ),
    ...over
  };
}

function validFlow(
  over: Partial<M1CandleFlowEvaluation> = {}
): M1CandleFlowEvaluation {
  return {
    eligible: true,
    side: "BUY",
    waitReason: null,
    stage: "TRIGGERED",
    regime: "TREND_UP",
    regimeEpoch: 3,
    pulseId: "PS-V6-BUY-1",
    pulseDirection: "BUY",
    pulseStart: 2599.5,
    pulseExtreme: 2600.4,
    pulseDistance: 0.9,
    pulseDurationSec: 18,
    pulseEfficiency: 0.62,
    retracementPct: 34,
    baseHoldTicks: 5,
    baseHoldDurationMs: 1800,
    continuationBreakLevel: 2600.1,
    currentCandleStartMs: 1_720_000_000_000,
    currentCandleAgeSec: 24,
    currentM1Open: 2599.7,
    currentM1High: 2600.4,
    currentM1Low: 2599.6,
    currentM1Displacement: 0.45,
    signalRange: 1.2,
    medianRange5: 1.1,
    directionalDisplacement: 0.45,
    remainingExpectedRange: 0.65,
    pullbackRatio: 0.34,
    reclaimDistance: 0.25,
    recentNoise: 0.18,
    remainingMovementBudget: 0.65,
    pulseHealthAtEntry: 68,
    entryQuality: 0.74,
    candleTrendScore: 0.72,
    pullbackScore: 0.8,
    microstructureScore: 0.8,
    rewardSpaceScore: 0.65,
    finalQuality: 0.74,
    qualityThreshold: 0.62,
    reasons: ["pulse_structure_confirmed"],
    latestClosedCandle: null,
    previousClosedCandle: null,
    ...over
  };
}

function setupA(flow: M1CandleFlowEvaluation) {
  return evaluateSetupsDetailed(feature(2600.15, flow.side ?? "BUY"), defaultGhFastConfig(), {
    m1CandleFlow: flow
  });
}

describe("Brain V6 Pulse Guard entry gates", () => {
  it("accepts a healthy aligned pulse", () => {
    const out = setupA(validFlow());
    expect(out.selected?.side).toBe("BUY");
    expect(out.selected?.quality).toBeGreaterThanOrEqual(0.66);
  });

  it("blocks opening-seconds noise", () => {
    const out = setupA(validFlow({ currentCandleAgeSec: 3 }));
    expect(out.selected).toBeNull();
    expect(out.specialists[0]?.failedConditions).toContain("WAIT_CANDLE_TOO_EARLY");
  });

  it("blocks a pulse that disagrees with the forming M1 candle", () => {
    const out = setupA(validFlow({ currentM1Displacement: -0.05 }));
    expect(out.selected).toBeNull();
    expect(out.specialists[0]?.failedConditions).toContain(
      "WAIT_CURRENT_CANDLE_NOT_ALIGNED"
    );
  });

  it("blocks weak entry pulse health", () => {
    const out = setupA(validFlow({ pulseHealthAtEntry: 45 }));
    expect(out.selected).toBeNull();
    expect(out.specialists[0]?.failedConditions).toContain("WAIT_PULSE_HEALTH_WEAK");
  });

  it("blocks structurally inefficient pulses", () => {
    const out = setupA(validFlow({ pulseEfficiency: 0.2 }));
    expect(out.selected).toBeNull();
    expect(out.specialists[0]?.failedConditions).toContain(
      "WAIT_PULSE_EFFICIENCY_WEAK"
    );
  });

  it("requires the V6 0.66 execution-quality floor", () => {
    const out = setupA(validFlow({ finalQuality: 0.64, entryQuality: 0.64 }));
    expect(out.selected).toBeNull();
    expect(out.specialists[0]?.failedConditions).toContain("WAIT_QUALITY_BELOW_MIN");
  });
});

describe("Brain V6 loss and profit economics", () => {
  it("uses the tighter V6 safety/protection defaults", () => {
    const cfg = defaultGhFastConfig();
    expect(cfg.slcSoftMaxLossR).toBe(0.45);
    expect(cfg.slcEarlyFailureMinMaeR).toBe(0.12);
    expect(cfg.slcEarlyFailureMinConfirms).toBe(2);
    expect(cfg.spmProtectMfeR).toBe(0.6);
    expect(cfg.slcLossStreakCount).toBe(2);
    expect(cfg.slcLossStreakResetMs).toBe(120_000);
  });

  it("cuts an ordinary loser at roughly -0.45R instead of waiting for -0.70R", () => {
    const cfg = defaultGhFastConfig();
    const t = openTrade({
      tradeId: "v6-soft-cap",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2599.95,
      ask: 2600,
      trailDistance: 0.12
    });
    const bid = 2600 - cfg.hardStop * 0.46;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    const reason = evaluateOpenExit({
      trade: t,
      f: feature(bid + 0.025, "BUY", {
        bid,
        ask: bid + 0.05,
        mid: bid + 0.025,
        signedImbalance1s: 0,
        midVel250: 0,
        midVel500: 0,
        midVel1s: 0,
        acceleration: 0,
        efficiency1s: 0.5,
        depth: depth({ depthImbalance: 0, removeRateAsk: 1, removeRateBid: 1 })
      }),
      cfg,
      dataOk: true
    });
    expect(reason).toBe("SMART_SOFT_MAX_LOSS");
  });

  it("does not soft-stop ordinary noise before the new cap", () => {
    const cfg = defaultGhFastConfig();
    const t = openTrade({
      tradeId: "v6-below-cap",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2599.95,
      ask: 2600,
      trailDistance: 0.12
    });
    const bid = 2600 - cfg.hardStop * 0.3;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    const reason = evaluateOpenExit({
      trade: t,
      f: feature(bid + 0.025, "BUY", {
        bid,
        ask: bid + 0.05,
        mid: bid + 0.025,
        signedImbalance1s: 0,
        midVel250: 0,
        midVel500: 0,
        midVel1s: 0,
        acceleration: 0,
        efficiency1s: 0.5,
        depth: depth({ depthImbalance: 0, removeRateAsk: 1, removeRateBid: 1 })
      }),
      cfg,
      dataOk: true
    });
    expect(reason).toBeNull();
  });

  it("fails a rejected pulse after about 2.5s when it never produced MFE", () => {
    const cfg = defaultGhFastConfig();
    const t = openTrade({
      tradeId: "v6-fast-reject",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now() - 3_000,
      bid: 2599.95,
      ask: 2600,
      trailDistance: 0.12
    });
    const bid = 2600 - cfg.hardStop * 0.24;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    t.timeInTradeMs = 3_000;
    const reason = evaluateOpenExit({
      trade: t,
      f: feature(bid + 0.025, "BUY", {
        bid,
        ask: bid + 0.05,
        mid: bid + 0.025,
        midVel250: -cfg.momentumVelMin * 2,
        midVel500: -cfg.momentumVelMin * 2,
        midVel1s: -cfg.momentumVelMin,
        acceleration: -cfg.momentumVelMin * 2,
        signedImbalance1s: -0.3,
        efficiency1s: 0.18,
        depth: depth({ depthImbalance: -0.25, removeRateAsk: 0.5, removeRateBid: 3 })
      }),
      cfg,
      dataOk: true
    });
    expect(reason).toBe("FAILED_PULSE_EXIT");
  });

  it("moves a demonstrated +0.6R pulse into profit protection", () => {
    const cfg = defaultGhFastConfig();
    const t = openTrade({
      tradeId: "v6-early-protect",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2599.95,
      ask: 2600,
      trailDistance: 0.12
    });
    const bid = 2600 + cfg.hardStop * 0.65;
    updateOpenTrade(t, bid, bid + 0.05, cfg);
    expect(t.smartPmState).toBe("PROTECTED");
    expect(t.profitLockActive).toBe(true);
    expect(t.lockFloor).not.toBeNull();
    expect(t.lockFloor!).toBeGreaterThanOrEqual(t.entryPrice);
  });
});
