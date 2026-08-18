/**
 * PR #144 — atomic replay finalisation TOCTOU race.
 * Proves ACK/activity cannot roll back when concurrent ACK lands
 * between patch read and replay-field commit.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getGhShadowEngine,
  resetGhShadowEnginesForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/engine";
import { computeGhShadowPerformanceReport } from "../../../src/services/goldHunterAdmin/shadowQualification/performance";
import {
  flushGhShadowPersistenceForTests,
  processGhShadowMarketEventSync,
  resetGhShadowQualificationRuntimeForTests,
  runGhShadowReplayAndGate,
  setGhShadowAllowUnitTestSizingDefaultsForTests,
  setGhShadowAutoPersistForTests,
  setGhShadowReplayBeforeFinalizeHookForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/runtime";
import {
  listAllGhShadowTrades,
  loadGhShadowEpoch,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  setGhShadowReplayPatchAfterReadHookForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/store";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID
} from "../../../src/services/goldHunterAdmin/types";
import type { GoldHunterSelectedCandidate } from "../../../src/services/goldHunterAdmin/strategySelector";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc/frozenConfig";

const OWNER = "gh-atomic-replay";

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
    signalId: "GH-SIG-ATOMIC",
    opportunityId: "GH-OPP-ATOMIC",
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

async function seedClosedTradeEpoch(owner: string): Promise<number> {
  setGhShadowAutoPersistForTests(false);
  processGhShadowMarketEventSync({
    ownerUid: owner,
    receiveSeq: 1,
    eventTsMs: 1000,
    strategySpotBid: 2650,
    strategySpotAsk: 2650.12,
    features: features(2650, 2650.12),
    dataOk: true,
    depthValidity: "DEPTH_VALID",
    newOpportunity: true,
    opportunity: opportunity(),
    config: cfg(),
    sizingOverrides: { quoteToDepositRate: 0.866 }
  });
  const hard = frozenGhFastSoakConfig().hardStop;
  processGhShadowMarketEventSync({
    ownerUid: owner,
    receiveSeq: 2,
    eventTsMs: 1100,
    strategySpotBid: 2650.12 - hard - 0.01,
    strategySpotAsk: 2650.12 - hard,
    features: features(2650.12 - hard - 0.01, 2650.12 - hard),
    dataOk: true,
    depthValidity: "DEPTH_VALID",
    newOpportunity: false,
    opportunity: null,
    config: cfg()
  });
  processGhShadowMarketEventSync({
    ownerUid: owner,
    receiveSeq: 3,
    eventTsMs: 1700,
    strategySpotBid: 2649.3,
    strategySpotAsk: 2649.4,
    features: features(2649.3, 2649.4),
    dataOk: true,
    depthValidity: "DEPTH_VALID",
    newOpportunity: false,
    opportunity: null,
    config: cfg()
  });
  setGhShadowAutoPersistForTests(true);
  await flushGhShadowPersistenceForTests(owner);
  const ep = await loadGhShadowEpoch(owner);
  expect(ep).not.toBeNull();
  return ep!.integrity.persistAcknowledgedEvents;
}

beforeEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  resetGhShadowEnginesForTests();
  resetGhShadowQualificationMemoryForTests();
  setGhShadowAllowUnitTestSizingDefaultsForTests(true);
  setGhShadowReplayBeforeFinalizeHookForTests(null);
  setGhShadowReplayPatchAfterReadHookForTests(null);
  delete process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED;
});

afterEach(() => {
  setGhShadowReplayPatchAfterReadHookForTests(null);
  setGhShadowReplayBeforeFinalizeHookForTests(null);
  resetGhShadowQualificationRuntimeForTests();
});

describe("atomic replay patch — narrow TOCTOU race", () => {
  it("ACK injected after patch read cannot roll back; LIVE_REPLAY_OK refused", async () => {
    const owner = OWNER + "-patch-race";
    const n = await seedClosedTradeEpoch(owner);
    expect(n).toBeGreaterThan(0);

    const before = await loadGhShadowEpoch(owner);
    const markerOpened = before!.formalQualificationTrades;
    const markerActivity = before!.activity.formalTradesOpened;
    let hookFired = 0;

    setGhShadowReplayPatchAfterReadHookForTests(async ({ ownerUid, expectedEvents }) => {
      hookFired += 1;
      if (hookFired > 1) return; // once only
      const ep = await loadGhShadowEpoch(ownerUid);
      expect(ep).not.toBeNull();
      expect(ep!.integrity.persistAcknowledgedEvents).toBe(expectedEvents);
      // Replace epoch object with ACK=N+1 + activity markers that a stale
      // full-document write of the N snapshot would destroy.
      await saveGhShadowEpoch(ownerUid, {
        ...ep!,
        formalQualificationTrades: markerOpened + 7,
        diagnosticExcludedTrades: (ep!.diagnosticExcludedTrades ?? 0) + 3,
        integrity: {
          ...ep!.integrity,
          persistAcknowledgedEvents: expectedEvents + 1,
          eventsPersisted: expectedEvents + 1,
          eventsSeen: (ep!.integrity.eventsSeen ?? 0) + 1
        },
        activity: {
          ...ep!.activity,
          formalTradesOpened: markerActivity + 11,
          newOpportunitiesDetected:
            (ep!.activity.newOpportunitiesDetected ?? 0) + 5
        }
      });
    });

    const replay1 = await runGhShadowReplayAndGate(owner);
    expect(hookFired).toBeGreaterThanOrEqual(1);
    expect(replay1.status).toBe("REPLAY_STALE");
    expect(replay1.replayCurrent).toBe(false);

    const after = await loadGhShadowEpoch(owner);
    expect(after!.integrity.persistAcknowledgedEvents).toBe(n + 1);
    expect(after!.integrity.persistAcknowledgedEvents).not.toBe(n);
    expect(after!.formalQualificationTrades).toBe(markerOpened + 7);
    expect(after!.diagnosticExcludedTrades).toBe(
      (before!.diagnosticExcludedTrades ?? 0) + 3
    );
    expect(after!.activity.formalTradesOpened).toBe(markerActivity + 11);
    expect(after!.activity.newOpportunitiesDetected).toBe(
      (before!.activity.newOpportunitiesDetected ?? 0) + 5
    );
    expect(after!.lastReplayStatus).toBe("REPLAY_STALE");

    const trades = await listAllGhShadowTrades(owner, {
      qualificationId: after!.qualificationId
    });
    const perf = computeGhShadowPerformanceReport(trades, after);
    expect(perf.checkpoint.edgeDecisionReady).toBe(false);

    // Stabilize: align ACK to actual persisted events (synthetic +1 had no event),
    // then re-run replay — LIVE_REPLAY_OK may become current.
    setGhShadowReplayPatchAfterReadHookForTests(null);
    const { listAllGhShadowCapturedEvents } = await import(
      "../../../src/services/goldHunterAdmin/shadowQualification/store"
    );
    const events = await listAllGhShadowCapturedEvents(owner, {
      qualificationId: after!.qualificationId
    });
    const stable = await loadGhShadowEpoch(owner);
    stable!.integrity.persistAcknowledgedEvents = events.length;
    stable!.integrity.eventsPersisted = events.length;
    // Preserve race markers that proved no rollback.
    expect(stable!.formalQualificationTrades).toBe(markerOpened + 7);
    await saveGhShadowEpoch(owner, stable!);
    const eng = getGhShadowEngine(owner);
    if (eng.getEpoch()) {
      eng.getEpoch()!.integrity.persistAcknowledgedEvents = events.length;
      eng.getEpoch()!.lastReplayStatus = "REPLAY_STALE";
    }

    const replay2 = await runGhShadowReplayAndGate(owner);
    expect(replay2.status).toBe("LIVE_REPLAY_OK");
    expect(replay2.replayCurrent).toBe(true);
    expect(replay2.expectedEvents).toBe(events.length);
    const final = await loadGhShadowEpoch(owner);
    expect(final!.integrity.persistAcknowledgedEvents).toBe(events.length);
    expect(final!.formalQualificationTrades).toBe(markerOpened + 7);
    expect(final!.lastReplayStatus).toBe("LIVE_REPLAY_OK");
  });
});
