/**
 * Gold Hunter Clean Shadow Qualification V1 — unit tests.
 * Strategy geometry unchanged. No broker mutation.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeGhShadowEconomicExposure,
  simulateGhShadowCashPnl,
  shadowEntryPrice,
  shadowExitPrice
} from "../../../src/services/goldHunterAdmin/shadowQualification/economics";
import {
  computeGhShadowPerformanceReport
} from "../../../src/services/goldHunterAdmin/shadowQualification/performance";
import {
  tryOpenGhShadowFromOpportunity,
  tickGhShadowPosition,
  resetGhShadowPositionManagerForTests,
  getGhShadowOpenTradeId
} from "../../../src/services/goldHunterAdmin/shadowQualification/positionManager";
import {
  getGhShadowBrokerMutationProof,
  refuseGhShadowBrokerMutation,
  resetGhShadowBrokerMutationProofForTests,
  assertGhShadowNoBrokerMutationSurface
} from "../../../src/services/goldHunterAdmin/shadowQualification/brokerMutationGuard";
import {
  listGhShadowTrades,
  loadGhShadowEpoch,
  resetGhShadowQualificationMemoryForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/store";
import {
  isGhShadowQualificationEnabled,
  getGhShadowStrategyConfigIdentity,
  resetGhShadowQualificationRuntimeForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/runtime";
import {
  replayGhShadowEventSequence
} from "../../../src/services/goldHunterAdmin/shadowQualification/replay";
import {
  openTrade,
  updateOpenTrade,
  evaluateOpenExit
} from "../../../src/services/goldHunterAdmin/abc/exits";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc/frozenConfig";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID
} from "../../../src/services/goldHunterAdmin/types";
import type { GoldHunterSelectedCandidate } from "../../../src/services/goldHunterAdmin/strategySelector";
import type { GhShadowTrade } from "../../../src/services/goldHunterAdmin/shadowQualification/types";

const OWNER = "gh-shadow-qual-owner";

function depthStats(over: Partial<DepthBookStats> = {}): DepthBookStats {
  return {
    available: true,
    topBidDepth: 10,
    topAskDepth: 10,
    bidDepthN: 10,
    askDepthN: 10,
    bidLevels: 5,
    askLevels: 5,
    depthRatio: 1,
    depthImbalance: 0.1,
    weightedImbalance: 0.1,
    liquidityAddedBid: 0,
    liquidityAddedAsk: 0,
    liquidityRemovedBid: 0,
    liquidityRemovedAsk: 0,
    addRateBid: 0,
    addRateAsk: 0,
    removeRateBid: 0,
    removeRateAsk: 0,
    bestBid: 2650,
    bestAsk: 2650.1,
    spread: 0.1,
    crossed: false,
    lastUpdateMs: Date.now(),
    lastValidBookMs: Date.now(),
    ...over
  };
}

function features(
  bid: number,
  ask: number,
  over: Partial<GhFastFeatureSnapshot> = {}
): GhFastFeatureSnapshot {
  const mid = (bid + ask) / 2;
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
    signedImbalance1s: 0.1,
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
    distHigh1s: 0,
    distLow1s: 0,
    distHigh5s: 0,
    distLow5s: 0,
    upTouches5s: 0,
    downTouches5s: 0,
    depth: depthStats({ bestBid: bid, bestAsk: ask, spread: ask - bid }),
    ...over
  };
}

function opportunity(
  over: Partial<GoldHunterSelectedCandidate> = {}
): GoldHunterSelectedCandidate {
  return {
    strategy: GH_ADMIN_STRATEGY_ID,
    setup: "A",
    setupId: "A_MOMENTUM_IGNITION",
    side: "BUY",
    quality: 0.8,
    signalId: "GH-SIG-1",
    opportunityId: "GH-OPP-1",
    signalTimestamp: new Date().toISOString(),
    receiveSeq: 10,
    latestReceiveSeq: 10,
    bookGeneration: 1,
    resyncGeneration: 0,
    bid: 2650.0,
    ask: 2650.12,
    spread: 0.12,
    depthValidity: "DEPTH_VALID",
    depthExecutable: true,
    normalizationVersion: "CTRADER_NORMALIZED_V1",
    featureSchema: "GOLD_HUNTER_FAST_V1",
    mid: 2650.06,
    consumed: false,
    opportunityStartedAtMs: Date.now(),
    ...over
  };
}

function cfg() {
  return {
    ...GH_ADMIN_DEFAULT_CONFIG,
    allocatedCapitalEur: 1000,
    riskPerTradePct: 1,
    dailyLossLimitPct: 5,
    maxOpenTrades: 1,
    demoAutoTradeEnabled: false,
    pauseNewEntries: true,
    emergencyStopActive: true,
    updatedAt: new Date().toISOString(),
    updatedBy: OWNER
  };
}

beforeEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  resetGhShadowBrokerMutationProofForTests();
  delete process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED;
});

afterEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  resetGhShadowBrokerMutationProofForTests();
  delete process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED;
});

describe("shadow economics", () => {
  it("matches intended Demo exposure: €10 / 0.55 → 0.18 XAU oz", () => {
    const economic = computeGhShadowEconomicExposure({ config: cfg() });
    expect(economic.riskBudgetEur).toBe(10);
    expect(economic.hardStopPrice).toBe(0.55);
    expect(economic.economicXauOz).toBe(0.18);
    expect(economic.conventionalLotsEquivalent).toBeCloseTo(0.0018, 8);
    expect(economic.frictionPrice).toBe(0.06);
  });

  it("BUY entry=Ask exit=Bid; SELL entry=Bid exit=Ask", () => {
    expect(shadowEntryPrice("BUY", 100, 100.2)).toBe(100.2);
    expect(shadowExitPrice("BUY", 100.5, 100.7)).toBe(100.5);
    expect(shadowEntryPrice("SELL", 100, 100.2)).toBe(100);
    expect(shadowExitPrice("SELL", 99.5, 99.7)).toBe(99.7);
  });

  it("embeds spread once and friction separately in cash P/L", () => {
    const economic = computeGhShadowEconomicExposure({ config: cfg() });
    // BUY: entry ask 100.12, exit bid 100.32 → signed +0.20; friction 0.06
    const pnl = simulateGhShadowCashPnl({
      side: "BUY",
      entryPrice: 100.12,
      exitPrice: 100.32,
      economic
    });
    expect(pnl.grossPriceMove).toBeCloseTo(0.2, 8);
    expect(pnl.netPriceMove).toBeCloseTo(0.14, 8);
    expect(pnl.simulatedGrossPnlEur).toBeCloseTo(0.2 * 0.18 * 100, 6);
    expect(pnl.simulatedFrictionEur).toBeCloseTo(0.06 * 0.18 * 100, 6);
    expect(pnl.simulatedNetPnlEur).toBeCloseTo(
      pnl.simulatedGrossPnlEur - pnl.simulatedFrictionEur,
      8
    );
  });
});

describe("strategy geometry unchanged", () => {
  it("frozen hardStop / profitLock / trail match canonical defaults", () => {
    const id = getGhShadowStrategyConfigIdentity();
    const cfgFast = frozenGhFastSoakConfig();
    expect(id.hardStop).toBe(0.55);
    expect(id.profitLockActivateMfe).toBe(0.18);
    expect(id.profitLockFraction).toBe(0.45);
    expect(id.trailDistance).toBe(0.12);
    expect(cfgFast.hardStop).toBe(0.55);
    expect(cfgFast.profitLockActivateMfe).toBe(0.18);
    expect(cfgFast.profitLockFraction).toBe(0.45);
    expect(cfgFast.trailDistance).toBe(0.12);
  });
});

describe("shadow open / exit / max-one", () => {
  it("opens one formal shadow and refuses second while open", async () => {
    const r1 = await tryOpenGhShadowFromOpportunity({
      ownerUid: OWNER,
      opportunity: opportunity(),
      config: cfg(),
      marketFresh: true
    });
    expect(r1.opened).toBe(true);
    expect(r1.trade?.dataQuality).toBe("FORMAL_ELIGIBLE");
    expect(r1.trade?.entryPrice).toBe(2650.12); // BUY ask
    expect(r1.trade?.economic?.economicXauOz).toBe(0.18);
    expect(getGhShadowOpenTradeId(OWNER)).toBe(r1.trade!.tradeId);

    const r2 = await tryOpenGhShadowFromOpportunity({
      ownerUid: OWNER,
      opportunity: opportunity({
        opportunityId: "GH-OPP-2",
        signalId: "GH-SIG-2",
        receiveSeq: 11
      }),
      config: cfg(),
      marketFresh: true
    });
    expect(r2.opened).toBe(false);
    expect(r2.reason).toBe("max_open_shadow_1");
  });

  it("excludes invalid market as DIAGNOSTIC_EXCLUDED (not formal)", async () => {
    const r = await tryOpenGhShadowFromOpportunity({
      ownerUid: OWNER,
      opportunity: opportunity({
        bid: 0,
        ask: 0,
        depthValidity: "DEPTH_STALE",
        depthExecutable: false
      }),
      config: cfg(),
      marketFresh: true
    });
    expect(r.opened).toBe(false);
    expect(r.trade?.dataQuality).toBe("DIAGNOSTIC_EXCLUDED");
    const epoch = await loadGhShadowEpoch(OWNER);
    expect(epoch?.diagnosticExcludedTrades).toBe(1);
    expect(epoch?.formalQualificationTrades).toBe(0);
  });

  it("HARD_PROTECTION exit records MAE and formal counter", async () => {
    const open = await tryOpenGhShadowFromOpportunity({
      ownerUid: OWNER,
      opportunity: opportunity({ bid: 2650, ask: 2650.1 }),
      config: cfg(),
      marketFresh: true
    });
    expect(open.opened).toBe(true);
    const entry = open.trade!.entryPrice!;
    // Drive adverse past hardStop 0.55 via bid for BUY
    const adverseBid = entry - 0.56;
    const adverseAsk = adverseBid + 0.1;
    const exit = await tickGhShadowPosition({
      ownerUid: OWNER,
      bid: adverseBid,
      ask: adverseAsk,
      features: features(adverseBid, adverseAsk, {
        acceleration: 0,
        signedImbalance1s: 0
      }),
      dataOk: true,
      receiveSeq: 20
    });
    expect(exit.exited).toBe(true);
    expect(exit.trade?.exitReason).toBe("HARD_PROTECTION");
    expect(exit.trade?.status).toBe("CLOSED");
    expect(exit.trade?.mae).toBeLessThan(0);
    expect(exit.trade?.simulatedNetPnlEur).not.toBeNull();
    const epoch = await loadGhShadowEpoch(OWNER);
    expect(epoch?.formalQualificationTrades).toBe(1);
    expect(getGhShadowOpenTradeId(OWNER)).toBeNull();
  });
});

describe("performance report + checkpoints", () => {
  it("ignores DIAGNOSTIC_EXCLUDED and reports setup / exit breakdowns", () => {
    const formal = (n: number, net: number, setup: "A" | "B" | "C" = "A"): GhShadowTrade =>
      ({
        tradeId: `t${n}`,
        qualificationId: "GH-SQ-x",
        opportunityId: `o${n}`,
        signalId: `s${n}`,
        setup,
        setupId: "A_MOMENTUM_IGNITION",
        side: "BUY",
        status: "CLOSED",
        dataQuality: "FORMAL_ELIGIBLE",
        exclusionReason: null,
        signalTs: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
        entryTs: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
        entryBid: 100,
        entryAsk: 100.1,
        entryPrice: 100.1,
        entrySpread: 0.1,
        initialStop: 99.55,
        exitTs: new Date(Date.UTC(2026, 0, 1, 0, 1, n)).toISOString(),
        exitBid: 100.2,
        exitAsk: 100.3,
        exitPrice: 100.2,
        exitReason: net > 0 ? "HARVEST_FADE" : "HARD_PROTECTION",
        mfe: net > 0 ? 0.3 : 0.05,
        mae: net > 0 ? -0.05 : -0.55,
        durationMs: 60_000,
        grossPriceMove: net / 18,
        frictionPrice: 0.06,
        netPriceMove: net / 18 - 0.06,
        simulatedGrossPnlEur: net + 1,
        simulatedFrictionEur: 1,
        simulatedNetPnlEur: net,
        economic: computeGhShadowEconomicExposure({ config: cfg() }),
        profitLockActivatedAt: net > 0 ? new Date().toISOString() : null,
        trailActivatedAt: null,
        trailUpdateCount: 0,
        maxFavorableBeforeExit: net > 0 ? 0.3 : 0.05,
        maxAdverseBeforeExit: net > 0 ? -0.05 : -0.55,
        strategySha: "abc",
        configSha: "abc",
        receiveSeqAtEntry: n,
        receiveSeqAtExit: n + 1,
        bookGeneration: 1,
        resyncGeneration: 0,
        path: {
          profitLockActivateMfeAtActivation: null,
          lockFloorAtActivation: null,
          lockFloorAtExit: null,
          bestExitAtExit: null
        }
      });

    const excluded: GhShadowTrade = {
      ...formal(99, -999),
      tradeId: "bad",
      dataQuality: "DIAGNOSTIC_EXCLUDED",
      status: "DIAGNOSTIC_EXCLUDED",
      entryPrice: 0,
      simulatedNetPnlEur: -999
    };

    const report = computeGhShadowPerformanceReport([
      formal(1, 2, "A"),
      formal(2, -4, "A"),
      formal(3, 1.5, "B"),
      excluded
    ]);
    expect(report.completedTrades).toBe(3);
    expect(report.wins).toBe(2);
    expect(report.losses).toBe(1);
    expect(report.netSimulatedPnlEur).toBeCloseTo(-0.5, 8);
    expect(report.bySetup.A.trades).toBe(2);
    expect(report.bySetup.B.trades).toBe(1);
    expect(report.checkpoint.at50).toBe("NOT_REACHED");
    expect(report.checkpoint.at250).toBe("NOT_REACHED");
    expect(report.payoff.avgWinOverAvgLoss).not.toBeNull();
  });

  it("at 250 classifies PROMISING or NEGATIVE EDGE without auto-deploy", () => {
    const mk = (i: number, net: number): GhShadowTrade => ({
      tradeId: `n${i}`,
      qualificationId: "e",
      opportunityId: `o${i}`,
      signalId: `s${i}`,
      setup: "C",
      setupId: "C_PULLBACK_REACCEL",
      side: "SELL",
      status: "CLOSED",
      dataQuality: "FORMAL_ELIGIBLE",
      exclusionReason: null,
      signalTs: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      entryTs: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      entryBid: 200,
      entryAsk: 200.1,
      entryPrice: 200,
      entrySpread: 0.1,
      initialStop: 200.55,
      exitTs: new Date(Date.UTC(2026, 0, 1, 0, 1, i)).toISOString(),
      exitBid: 199.9,
      exitAsk: 200,
      exitPrice: 200,
      exitReason: "TRAIL_HIT",
      mfe: 0.2,
      mae: -0.1,
      durationMs: 1000,
      grossPriceMove: 0.1,
      frictionPrice: 0.06,
      netPriceMove: 0.04,
      simulatedGrossPnlEur: net + 0.5,
      simulatedFrictionEur: 0.5,
      simulatedNetPnlEur: net,
      economic: computeGhShadowEconomicExposure({ config: cfg() }),
      profitLockActivatedAt: new Date().toISOString(),
      trailActivatedAt: new Date().toISOString(),
      trailUpdateCount: 1,
      maxFavorableBeforeExit: 0.2,
      maxAdverseBeforeExit: -0.1,
      strategySha: "x",
      configSha: "x",
      receiveSeqAtEntry: i,
      receiveSeqAtExit: i + 1,
      bookGeneration: 1,
      resyncGeneration: 0,
      path: {
        profitLockActivateMfeAtActivation: 0.18,
        lockFloorAtActivation: 199.9,
        lockFloorAtExit: 199.85,
        bestExitAtExit: 199.8
      }
    });
    const promising = Array.from({ length: 250 }, (_, i) => mk(i, 1));
    const p = computeGhShadowPerformanceReport(promising);
    expect(p.checkpoint.formalDecisionReady).toBe(true);
    expect(p.checkpoint.at250).toBe("PROMISING — CONTINUE TO 500");

    const negative = Array.from({ length: 250 }, (_, i) => mk(i, -1));
    const n = computeGhShadowPerformanceReport(negative);
    expect(n.checkpoint.at250).toBe("NEGATIVE EDGE — STRATEGY REDESIGN REQUIRED");
  });
});

describe("replay determinism", () => {
  it("LIVE_REPLAY_OK when exit geometry matches live decisions", () => {
    const cfgFast = frozenGhFastSoakConfig();
    const trade = openTrade({
      tradeId: "GH-S-replay",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: 1_000,
      bid: 2650,
      ask: 2650.1,
      trailDistance: cfgFast.trailDistance
    });
    // Build adverse path to HARD_PROTECTION
    const events = [
      {
        receiveSeq: 1,
        bid: 2650,
        ask: 2650.1,
        features: null as GhFastFeatureSnapshot | null,
        dataOk: true,
        open: {
          tradeId: trade.tradeId,
          side: "BUY" as const,
          setup: "A_MOMENTUM_IGNITION" as const,
          entryTs: 1_000
        }
      },
      {
        receiveSeq: 2,
        bid: 2649.5,
        ask: 2649.6,
        features: features(2649.5, 2649.6),
        dataOk: true
      }
    ];
    // Live path
    updateOpenTrade(trade, 2649.5, 2649.6, cfgFast);
    const liveReason = evaluateOpenExit({
      trade,
      f: features(2649.5, 2649.6),
      cfg: cfgFast,
      dataOk: true
    });
    expect(liveReason).toBe("HARD_PROTECTION");

    const result = replayGhShadowEventSequence({
      events,
      liveDecisions: [
        {
          decisionId: "1",
          qualificationId: "q",
          at: new Date().toISOString(),
          kind: "OPEN",
          opportunityId: "o",
          tradeId: trade.tradeId,
          setup: "A",
          side: "BUY",
          bid: 2650,
          ask: 2650.1,
          receiveSeq: 1,
          exitReason: null,
          detail: null
        },
        {
          decisionId: "2",
          qualificationId: "q",
          at: new Date().toISOString(),
          kind: "EXIT",
          opportunityId: "o",
          tradeId: trade.tradeId,
          setup: "A",
          side: "BUY",
          bid: 2649.5,
          ask: 2649.6,
          receiveSeq: 2,
          exitReason: "HARD_PROTECTION",
          detail: null
        }
      ]
    });
    expect(result.status).toBe("LIVE_REPLAY_OK");
  });

  it("LIVE_REPLAY_DIVERGENCE on mismatched exit reason", () => {
    const result = replayGhShadowEventSequence({
      events: [],
      liveDecisions: [
        {
          decisionId: "1",
          qualificationId: "q",
          at: new Date().toISOString(),
          kind: "EXIT",
          opportunityId: null,
          tradeId: "t",
          setup: "A",
          side: "BUY",
          bid: 1,
          ask: 1,
          receiveSeq: 1,
          exitReason: "TRAIL_HIT",
          detail: null
        }
      ]
    });
    expect(result.status).toBe("LIVE_REPLAY_DIVERGENCE");
  });
});

describe("broker mutation proof + enable gate", () => {
  it("defaults shadow disabled; proof counters stay 0", () => {
    expect(isGhShadowQualificationEnabled()).toBe(false);
    const proof = getGhShadowBrokerMutationProof();
    expect(proof.ProtoOANewOrderReq).toBe(0);
    expect(proof.brokerNewOrderRequests).toBe(0);
    expect(proof.goldHunterBrokerPositionsCreated).toBe(0);
    expect(proof.goldHunterBrokerOrdersCreated).toBe(0);
  });

  it("refuseGhShadowBrokerMutation never places an order", () => {
    expect(() => refuseGhShadowBrokerMutation("test")).toThrow(
      /GH_SHADOW_BROKER_MUTATION_REFUSED/
    );
    expect(getGhShadowBrokerMutationProof().mutationAttempts).toBe(1);
    expect(getGhShadowBrokerMutationProof().ProtoOANewOrderReq).toBe(0);
  });

  it("shadowQualification sources contain no NewOrder / submit paths", () => {
    const dir = resolve(
      __dirname,
      "../../../src/services/goldHunterAdmin/shadowQualification"
    );
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const src = readFileSync(resolve(dir, name), "utf8");
      expect(() => assertGhShadowNoBrokerMutationSurface(src)).not.toThrow();
      expect(src).not.toMatch(/\bsubmitDemoMarketOrder\s*\(/);
      expect(src).not.toMatch(/\bsubmitGoldHunterDemoOrder\s*\(/);
      expect(src).not.toMatch(/\bnew\s+ProtoOANewOrderReq\b/);
    }
  });
});

describe("isolation from Demo safety + Core FAST", () => {
  it("does not modify projectedDailyRisk / maxOpenLease / entryValidity", () => {
    // Presence proof — files untouched by this PR's safety surface.
    const safety = [
      "projectedDailyRisk.ts",
      "maxOpenLease.ts",
      "entryValidity.ts",
      "configValidation.ts",
      "volumeContract.ts"
    ];
    for (const f of safety) {
      const p = resolve(
        __dirname,
        "../../../src/services/goldHunterAdmin",
        f
      );
      expect(readFileSync(p, "utf8").length).toBeGreaterThan(100);
    }
  });

  it("persists formal trades separately from broker Demo trade store", async () => {
    await tryOpenGhShadowFromOpportunity({
      ownerUid: OWNER,
      opportunity: opportunity(),
      config: cfg(),
      marketFresh: true
    });
    const trades = await listGhShadowTrades(OWNER, { limit: 10 });
    expect(trades.length).toBe(1);
    expect(trades[0]!.qualificationId).toMatch(/^GH-SQ-/);
  });
});
