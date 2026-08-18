/**
 * PR #144 — qualification rollover isolation.
 * Old Q1 replay must not mutate Q2 after current qualification rotates.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getGhShadowEngine,
  resetGhShadowEnginesForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/engine";
import { computeGhShadowPerformanceReport } from "../../../src/services/goldHunterAdmin/shadowQualification/performance";
import { buildUnitTestFrozenSizingSnapshot } from "../../../src/services/goldHunterAdmin/shadowQualification/frozenSizing";
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
  setCurrentQualificationId,
  setGhShadowReplayPatchAfterReadHookForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/store";
import type { GhShadowQualificationEpoch } from "../../../src/services/goldHunterAdmin/shadowQualification/types";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID
} from "../../../src/services/goldHunterAdmin/types";
import type { GoldHunterSelectedCandidate } from "../../../src/services/goldHunterAdmin/strategySelector";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc/frozenConfig";

const OWNER = "gh-qual-rollover";

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
    signalId: "GH-SIG-ROLL",
    opportunityId: "GH-OPP-ROLL",
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

function q2Epoch(qid: string): GhShadowQualificationEpoch {
  const now = new Date().toISOString();
  const frozen = buildUnitTestFrozenSizingSnapshot({
    config: cfg(),
    ctidTraderAccountId: "48014710"
  });
  return {
    qualificationId: qid,
    qualificationStartTime: now,
    qualificationStartSequence: 100,
    strategySha: "q2-sha",
    configSha: "q2-cfg",
    strategyVersion: "v",
    engineVersion: "e",
    soakLabel: "s",
    frozenSizing: frozen,
    formalQualificationTrades: 77,
    diagnosticExcludedTrades: 13,
    openShadowTradeId: null,
    status: "ACTIVE",
    dataIntegrityFailure: null,
    persistFailureReason: null,
    runtimeGeneration: 9,
    lastRestartReason: "qual_rollover_test",
    integrity: {
      eventsSeen: 42,
      eventsProcessed: 42,
      eventsPersisted: 42,
      eventsDropped: 0,
      receiveSeqGaps: 0,
      receiveSeqDuplicates: 0,
      receiveSeqOutOfOrder: 0,
      journalOverflowCount: 0,
      journalPending: 0,
      journalHighWaterMark: 0,
      persistAcknowledgedEvents: 42,
      persistFailures: 0,
      lastProcessedReceiveSeq: 42,
      lastResyncGeneration: 0
    },
    activity: {
      newOpportunitiesDetected: 55,
      formalTradesOpened: 77,
      formalTradesClosed: 70,
      opportunitiesWhileAlreadyOpen: 3,
      opportunitiesExcludedDataQuality: 1,
      opportunitiesRejectedSizing: 2,
      opportunitiesWarmupIgnored: 0,
      otherRejectionReasons: { ROLLOVER_MARKER: 1 },
      activeMarketMs: 99_000,
      entryTimestampsMs: [1, 2, 3],
      openTradeDurationsMs: [10],
      flatIdleSegmentsMs: [20],
      lastActiveMarketAtMs: 12345,
      lastEntryAtMs: 12340,
      lastFlatActiveAtMs: null,
      currentFlatIdleActiveMs: 0,
      lastFlatStartMs: null,
      bySetupOpened: { A: 40, B: 20, C: 17 }
    },
    lastReplayStatus: "NOT_RUN",
    lastReplayDetail: null,
    updatedAt: now
  };
}

async function seedClosedTradeEpoch(owner: string): Promise<string> {
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
  return ep!.qualificationId;
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
  setGhShadowReplayBeforeFinalizeHookForTests(null);
  setGhShadowReplayPatchAfterReadHookForTests(null);
  resetGhShadowQualificationRuntimeForTests();
});

describe("qualification rollover — Q1 replay must not mutate Q2", () => {
  it("Q1 replay finishing after rotate-to-Q2 leaves Q2 untouched", async () => {
    const owner = OWNER + "-iso";
    const q1 = await seedClosedTradeEpoch(owner);
    expect(q1).toBeTruthy();

    const q2 = "GH-SQ-ROLLOVER-Q2";
    const q2Snap = q2Epoch(q2);
    const q2Fingerprint = {
      qualificationId: q2Snap.qualificationId,
      ack: q2Snap.integrity.persistAcknowledgedEvents,
      eventsPersisted: q2Snap.integrity.eventsPersisted,
      eventsSeen: q2Snap.integrity.eventsSeen,
      formalQualificationTrades: q2Snap.formalQualificationTrades,
      diagnosticExcludedTrades: q2Snap.diagnosticExcludedTrades,
      runtimeGeneration: q2Snap.runtimeGeneration,
      activityOpened: q2Snap.activity.formalTradesOpened,
      activityNewOpp: q2Snap.activity.newOpportunitiesDetected,
      activityMarker: q2Snap.activity.otherRejectionReasons.ROLLOVER_MARKER,
      activeMarketMs: q2Snap.activity.activeMarketMs,
      lastReplayStatus: q2Snap.lastReplayStatus,
      lastReplayDetail: q2Snap.lastReplayDetail
    };

    setGhShadowReplayBeforeFinalizeHookForTests(async ({ qualificationId }) => {
      expect(qualificationId).toBe(q1);
      // Rotate current qualification to distinctive Q2 mid-replay.
      await saveGhShadowEpoch(owner, q2Snap);
      await setCurrentQualificationId(owner, q2);
      // Engine follows the new current epoch identity for live path.
      const eng = getGhShadowEngine(owner);
      const live = eng.getEpoch();
      if (live) {
        Object.assign(live, structuredClone(q2Snap));
      }
      const cur = await loadGhShadowEpoch(owner);
      expect(cur!.qualificationId).toBe(q2);
      expect(cur!.lastReplayStatus).toBe("NOT_RUN");
      expect(cur!.lastReplayDetail).toBeNull();
    });

    const replay1 = await runGhShadowReplayAndGate(owner);
    expect(replay1.status).toBe("REPLAY_STALE");
    expect(replay1.replayCurrent).toBe(false);
    expect(String(replay1.divergenceDetail ?? "")).toContain(
      "replay_stale_qualification_rollover"
    );

    const afterQ2 = await loadGhShadowEpoch(owner);
    expect(afterQ2).not.toBeNull();
    expect(afterQ2!.qualificationId).toBe(q2Fingerprint.qualificationId);
    expect(afterQ2!.integrity.persistAcknowledgedEvents).toBe(q2Fingerprint.ack);
    expect(afterQ2!.integrity.eventsPersisted).toBe(q2Fingerprint.eventsPersisted);
    expect(afterQ2!.integrity.eventsSeen).toBe(q2Fingerprint.eventsSeen);
    expect(afterQ2!.formalQualificationTrades).toBe(
      q2Fingerprint.formalQualificationTrades
    );
    expect(afterQ2!.diagnosticExcludedTrades).toBe(
      q2Fingerprint.diagnosticExcludedTrades
    );
    expect(afterQ2!.runtimeGeneration).toBe(q2Fingerprint.runtimeGeneration);
    expect(afterQ2!.activity.formalTradesOpened).toBe(
      q2Fingerprint.activityOpened
    );
    expect(afterQ2!.activity.newOpportunitiesDetected).toBe(
      q2Fingerprint.activityNewOpp
    );
    expect(afterQ2!.activity.otherRejectionReasons.ROLLOVER_MARKER).toBe(
      q2Fingerprint.activityMarker
    );
    expect(afterQ2!.activity.activeMarketMs).toBe(q2Fingerprint.activeMarketMs);
    expect(afterQ2!.lastReplayStatus).toBe("NOT_RUN");
    expect(afterQ2!.lastReplayDetail).toBeNull();

    const eng = getGhShadowEngine(owner);
    expect(eng.getEpoch()?.qualificationId).toBe(q2);
    expect(eng.getEpoch()?.lastReplayStatus).toBe("NOT_RUN");
    expect(eng.getEpoch()?.lastReplayDetail).toBeNull();

    const trades = await listAllGhShadowTrades(owner, { qualificationId: q2 });
    const perf = computeGhShadowPerformanceReport(trades, afterQ2);
    expect(perf.checkpoint.edgeDecisionReady).toBe(false);

    // Q2 may become LIVE_REPLAY_OK once replayed against its own dataset.
    // Align ACK to zero events for empty Q2 → INCOMPLETE/STALE is fine; seed
    // a valid Q2 closed trade via a fresh owner path instead.
    setGhShadowReplayBeforeFinalizeHookForTests(null);
    const owner2 = OWNER + "-q2-ok";
    await seedClosedTradeEpoch(owner2);
    const replay2 = await runGhShadowReplayAndGate(owner2);
    expect(replay2.status).toBe("LIVE_REPLAY_OK");
    expect(replay2.replayCurrent).toBe(true);
  });
});
