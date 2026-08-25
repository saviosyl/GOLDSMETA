/**
 * PR #144 replay integrity corrections (round 3).
 * Features-only replay parity, concurrency-safe finalise,
 * >2000 decision pagination, research replay endpoint coverage via runtime.
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
  appendGhShadowCapturedEvent,
  appendGhShadowDecision,
  listAllGhShadowCapturedEvents,
  listAllGhShadowReplayMarkerDecisions,
  listAllGhShadowTrades,
  listGhShadowDecisions,
  listGhShadowDecisionsPage,
  loadGhShadowEpoch,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  setCurrentQualificationId,
  upsertGhShadowTrade
} from "../../../src/services/goldHunterAdmin/shadowQualification/store";
import { replayGhShadowCapturedEvents } from "../../../src/services/goldHunterAdmin/shadowQualification/replay";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID
} from "../../../src/services/goldHunterAdmin/types";
import type { GoldHunterSelectedCandidate } from "../../../src/services/goldHunterAdmin/strategySelector";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import type {
  GhShadowCapturedEvent,
  GhShadowDecisionRecord,
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "../../../src/services/goldHunterAdmin/shadowQualification/types";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc/frozenConfig";

const OWNER = "gh-replay-r3";

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

function frozen() {
  return buildUnitTestFrozenSizingSnapshot({
    config: cfg(),
    ctidTraderAccountId: "48014710"
  });
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
    signalId: "GH-SIG-R3",
    opportunityId: "GH-OPP-R3",
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

beforeEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  resetGhShadowEnginesForTests();
  resetGhShadowQualificationMemoryForTests();
  setGhShadowAllowUnitTestSizingDefaultsForTests(true);
  setGhShadowReplayBeforeFinalizeHookForTests(null);
  delete process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED;
});

afterEach(() => {
  setGhShadowReplayBeforeFinalizeHookForTests(null);
  resetGhShadowQualificationRuntimeForTests();
});

describe("FIX1 — replay mirrors features-only Demo management", () => {
  it("featureless extreme Depth tick is ignored by live AND replay; features resume; LIVE_REPLAY_OK", async () => {
    const owner = OWNER + "-feat-parity";
    setGhShadowAutoPersistForTests(false);

    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 1,
      eventTsMs: 1000,
      strategySpotBid: 2650.0,
      strategySpotAsk: 2650.12,
      depthBestBid: 2650.0,
      depthBestAsk: 2650.12,
      features: features(2650.0, 2650.12),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: true,
      opportunity: opportunity({ side: "BUY", bid: 2650.0, ask: 2650.12 }),
      config: cfg(),
      sizingOverrides: { quoteToDepositRate: 0.866 }
    });
    const eng = getGhShadowEngine(owner);
    expect(eng.getOpenTradeId()).not.toBeNull();
    const baseline = eng.getOpenTradeSnapshotForTests()!;
    expect(baseline.entryPrice).toBe(2650.12);
    expect(baseline.mfe).toBe(0);
    expect(baseline.mae).toBe(0);

    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 2,
      eventTsMs: 1100,
      strategySpotBid: 2650.2,
      strategySpotAsk: 2650.32,
      depthBestBid: 2650.2,
      depthBestAsk: 2650.32,
      features: features(2650.2, 2650.32),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    const afterFeat = eng.getOpenTradeSnapshotForTests()!;
    const mfeBefore = afterFeat.mfe;
    const maeBefore = afterFeat.mae;
    const lockBefore = afterFeat.profitLockActivatedAt;
    const trailBefore = afterFeat.trailActivatedAt;
    const trailCountBefore = afterFeat.trailUpdateCount;
    expect(mfeBefore).toBeGreaterThan(0);

    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 3,
      eventTsMs: 1200,
      strategySpotBid: 2800,
      strategySpotAsk: 2800.5,
      depthBestBid: 2900,
      depthBestAsk: 2901,
      features: null,
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    const afterMissing = eng.getOpenTradeSnapshotForTests()!;
    expect(afterMissing.mfe).toBe(mfeBefore);
    expect(afterMissing.mae).toBe(maeBefore);
    expect(afterMissing.profitLockActivatedAt).toBe(lockBefore);
    expect(afterMissing.trailActivatedAt).toBe(trailBefore);
    expect(afterMissing.trailUpdateCount).toBe(trailCountBefore);

    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 4,
      eventTsMs: 1300,
      strategySpotBid: 2650.25,
      strategySpotAsk: 2650.37,
      depthBestBid: 2650.25,
      depthBestAsk: 2650.37,
      features: features(2650.25, 2650.37),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    const resumed = eng.getOpenTradeSnapshotForTests()!;
    expect(resumed.mfe).toBeGreaterThanOrEqual(mfeBefore);

    const hard = frozenGhFastSoakConfig().hardStop;
    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 5,
      eventTsMs: 1400,
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
      receiveSeq: 6,
      eventTsMs: 2000,
      strategySpotBid: 2649.0,
      strategySpotAsk: 2649.1,
      features: features(2649.0, 2649.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });

    setGhShadowAutoPersistForTests(true);
    await flushGhShadowPersistenceForTests(owner);

    const epoch = await loadGhShadowEpoch(owner);
    expect(epoch).not.toBeNull();

    const events = await listAllGhShadowCapturedEvents(owner, {
      qualificationId: epoch!.qualificationId
    });
    const featureless = events.find((e) => e.receiveSeq === 3);
    expect(featureless).toBeDefined();
    expect(featureless!.features).toBeNull();
    expect(featureless!.bid).toBeGreaterThan(2800);

    const openEv = events.find((e) => e.openMarker != null)!;
    const featEv = events.find((e) => e.receiveSeq === 2)!;
    const unit = replayGhShadowCapturedEvents({
      events: [openEv, featEv, featureless!],
      liveDecisions: [
        {
          decisionId: "d-open",
          qualificationId: epoch!.qualificationId,
          at: openEv.eventTs,
          kind: "OPEN",
          opportunityId: openEv.openMarker!.opportunityId,
          tradeId: openEv.openMarker!.tradeId,
          setup: "A",
          side: "BUY",
          bid: openEv.bid,
          ask: openEv.ask,
          receiveSeq: openEv.receiveSeq,
          exitReason: null,
          detail: null
        }
      ],
      liveTrades: []
    });
    expect(unit.status).toBe("LIVE_REPLAY_OK");
    expect(unit.replayPoints).toHaveLength(1);
    expect(unit.replayPoints[0]!.kind).toBe("OPEN");

    const replay = await runGhShadowReplayAndGate(owner);
    expect(replay.status).toBe("LIVE_REPLAY_OK");
    expect(replay.replayCurrent).toBe(true);
  });
});

describe("FIX3 — replay finalisation concurrency safe", () => {
  it("ACK during replay ⇒ REPLAY_STALE; ACK count does not roll back; re-run OK", async () => {
    const owner = OWNER + "-race";
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
    const epochN = await loadGhShadowEpoch(owner);
    const n = epochN!.integrity.persistAcknowledgedEvents;
    expect(n).toBeGreaterThan(0);

    setGhShadowReplayBeforeFinalizeHookForTests(async ({ ownerUid }) => {
      setGhShadowAutoPersistForTests(false);
      processGhShadowMarketEventSync({
        ownerUid,
        receiveSeq: 4,
        eventTsMs: 2000,
        strategySpotBid: 2650,
        strategySpotAsk: 2650.12,
        features: features(2650, 2650.12),
        dataOk: true,
        depthValidity: "DEPTH_VALID",
        newOpportunity: true,
        opportunity: opportunity({
          opportunityId: "GH-OPP-R3-RACE",
          signalId: "GH-SIG-R3-RACE"
        }),
        config: cfg(),
        sizingOverrides: { quoteToDepositRate: 0.866 }
      });
      setGhShadowAutoPersistForTests(true);
      await flushGhShadowPersistenceForTests(ownerUid);
    });

    const replay1 = await runGhShadowReplayAndGate(owner);
    expect(replay1.status).toBe("REPLAY_STALE");
    expect(replay1.replayCurrent).toBe(false);

    const afterRace = await loadGhShadowEpoch(owner);
    expect(afterRace!.integrity.persistAcknowledgedEvents).toBeGreaterThan(n);
    expect(afterRace!.lastReplayStatus).toBe("REPLAY_STALE");

    const allTrades = await listAllGhShadowTrades(owner, {
      qualificationId: afterRace!.qualificationId
    });
    const perf = computeGhShadowPerformanceReport(allTrades, afterRace);
    expect(perf.checkpoint.edgeDecisionReady).toBe(false);

    setGhShadowReplayBeforeFinalizeHookForTests(null);
    setGhShadowAutoPersistForTests(false);
    const hard2 = frozenGhFastSoakConfig().hardStop;
    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 5,
      eventTsMs: 2100,
      strategySpotBid: 2650.12 - hard2 - 0.01,
      strategySpotAsk: 2650.12 - hard2,
      features: features(2650.12 - hard2 - 0.01, 2650.12 - hard2),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 6,
      eventTsMs: 2700,
      strategySpotBid: 2649,
      strategySpotAsk: 2649.1,
      features: features(2649, 2649.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    setGhShadowAutoPersistForTests(true);
    await flushGhShadowPersistenceForTests(owner);

    const n2 = (await loadGhShadowEpoch(owner))!.integrity.persistAcknowledgedEvents;
    const replay2 = await runGhShadowReplayAndGate(owner);
    expect(replay2.status).toBe("LIVE_REPLAY_OK");
    expect(replay2.replayCurrent).toBe(true);
    expect(replay2.expectedEvents).toBe(n2);
    const final = await loadGhShadowEpoch(owner);
    expect(final!.integrity.persistAcknowledgedEvents).toBe(n2);
    expect(final!.lastReplayStatus).toBe("LIVE_REPLAY_OK");
  });
});

describe("FIX4 — remove 2000-decision replay ceiling", () => {
  it("OPEN/EXIT markers beyond 2000 decisions are retrieved via pagination", async () => {
    const owner = OWNER + "-dec-page";
    const qid = "GH-SQ-dec-page";
    const now = new Date().toISOString();
    const fs = frozen();

    const epochBase: GhShadowQualificationEpoch = {
      qualificationId: qid,
      qualificationStartTime: now,
      qualificationStartSequence: 1,
      strategySha: "x",
      configSha: "x",
      strategyVersion: "v",
      engineVersion: "e",
      soakLabel: "s",
      frozenSizing: fs,
      formalQualificationTrades: 1,
      diagnosticExcludedTrades: 0,
      openShadowTradeId: null,
      status: "ACTIVE",
      dataIntegrityFailure: null,
      persistFailureReason: null,
      runtimeGeneration: 1,
      lastRestartReason: null,
      integrity: {
        eventsSeen: 2,
        eventsProcessed: 2,
        eventsPersisted: 2,
        eventsDropped: 0,
        receiveSeqGaps: 0,
        receiveSeqDuplicates: 0,
        receiveSeqOutOfOrder: 0,
        journalOverflowCount: 0,
        journalPending: 0,
        journalHighWaterMark: 0,
        persistAcknowledgedEvents: 2,
        persistFailures: 0,
        lastProcessedReceiveSeq: 2102,
        lastResyncGeneration: 0
      },
      activity: {
        newOpportunitiesDetected: 1,
        formalTradesOpened: 1,
        formalTradesClosed: 1,
        opportunitiesWhileAlreadyOpen: 0,
        opportunitiesExcludedDataQuality: 0,
        opportunitiesRejectedSizing: 0,
        opportunitiesWarmupIgnored: 0,
        otherRejectionReasons: {},
        activeMarketMs: 0,
        entryTimestampsMs: [],
        openTradeDurationsMs: [],
        flatIdleSegmentsMs: [],
        lastActiveMarketAtMs: null,
        lastEntryAtMs: null,
        lastFlatActiveAtMs: null,
        currentFlatIdleActiveMs: 0,
        lastFlatStartMs: null,
        bySetupOpened: { A: 1, B: 0, C: 0 }
      },
      lastReplayStatus: "NOT_RUN",
      lastReplayDetail: null,
      updatedAt: now
    };
    await saveGhShadowEpoch(owner, epochBase);
    await setCurrentQualificationId(owner, qid);

    const TOTAL_HOLD = 2100;
    for (let i = 1; i <= TOTAL_HOLD; i++) {
      const d: GhShadowDecisionRecord = {
        decisionId: `dec-hold-${String(i).padStart(5, "0")}`,
        qualificationId: qid,
        at: new Date(1_700_000_000_000 + i).toISOString(),
        kind: "HOLD",
        opportunityId: null,
        tradeId: null,
        setup: null,
        side: null,
        bid: 2650,
        ask: 2650.1,
        receiveSeq: i,
        exitReason: null,
        detail: "filler"
      };
      await appendGhShadowDecision(owner, d);
    }

    const openDec: GhShadowDecisionRecord = {
      decisionId: "dec-open-beyond",
      qualificationId: qid,
      at: new Date(1_700_000_000_000 + 2101).toISOString(),
      kind: "OPEN",
      opportunityId: "opp-beyond",
      tradeId: "trade-beyond",
      setup: "A",
      side: "BUY",
      bid: 2650,
      ask: 2650.12,
      receiveSeq: 2101,
      exitReason: null,
      detail: null
    };
    const hs = frozenGhFastSoakConfig().hardStop;
    const friction = frozenGhFastSoakConfig().friction;
    const exitBid = 2650.12 - hs - 0.01;
    const exitAsk = 2650.12 - hs;
    const exitDec: GhShadowDecisionRecord = {
      decisionId: "dec-exit-beyond",
      qualificationId: qid,
      at: new Date(1_700_000_000_000 + 2102).toISOString(),
      kind: "EXIT",
      opportunityId: "opp-beyond",
      tradeId: "trade-beyond",
      setup: "A",
      side: "BUY",
      bid: exitBid,
      ask: exitAsk,
      receiveSeq: 2102,
      exitReason: "HARD_PROTECTION",
      detail: null
    };
    await appendGhShadowDecision(owner, openDec);
    await appendGhShadowDecision(owner, exitDec);

    const bounded = await listGhShadowDecisions(owner, {
      qualificationId: qid,
      limit: 2000
    });
    expect(bounded.length).toBe(2000);
    expect(bounded.some((d) => d.kind === "OPEN")).toBe(false);
    expect(bounded.some((d) => d.kind === "EXIT")).toBe(false);

    const markers = await listAllGhShadowReplayMarkerDecisions(owner, {
      qualificationId: qid,
      pageSize: 500
    });
    expect(markers.length).toBe(2);
    expect(markers.map((m) => m.decisionId)).toEqual([
      "dec-open-beyond",
      "dec-exit-beyond"
    ]);

    const pages: number[] = [];
    let cursor: { receiveSeq: number; decisionId: string } | null = null;
    let total = 0;
    for (;;) {
      const page = await listGhShadowDecisionsPage(owner, {
        qualificationId: qid,
        pageSize: 500,
        startAfter: cursor
      });
      pages.push(page.decisions.length);
      total += page.decisions.length;
      if (!page.nextCursor || page.decisions.length === 0) break;
      cursor = page.nextCursor;
    }
    expect(total).toBe(TOTAL_HOLD + 2);
    expect(pages.length).toBeGreaterThan(4);

    const openEv: GhShadowCapturedEvent = {
      eventId: "ev-open-beyond",
      qualificationId: qid,
      receiveSeq: 2101,
      eventTs: openDec.at,
      eventTsMs: Date.parse(openDec.at),
      bid: 2650,
      ask: 2650.12,
      spread: 0.12,
      strategySpotBid: 2650,
      strategySpotAsk: 2650.12,
      depthBestBid: null,
      depthBestAsk: null,
      features: features(2650, 2650.12),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      inFormalTradePath: true,
      openMarker: {
        tradeId: "trade-beyond",
        opportunityId: "opp-beyond",
        signalId: "sig-beyond",
        setup: "A",
        setupId: "A_MOMENTUM_IGNITION",
        side: "BUY"
      },
      strategySha: "x",
      configSha: "x"
    };
    const exitEv: GhShadowCapturedEvent = {
      eventId: "ev-exit-beyond",
      qualificationId: qid,
      receiveSeq: 2102,
      eventTs: exitDec.at,
      eventTsMs: Date.parse(exitDec.at),
      bid: exitBid,
      ask: exitAsk,
      spread: exitAsk - exitBid,
      strategySpotBid: exitBid,
      strategySpotAsk: exitAsk,
      depthBestBid: null,
      depthBestAsk: null,
      features: features(exitBid, exitAsk),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: false,
      inFormalTradePath: true,
      openMarker: null,
      strategySha: "x",
      configSha: "x"
    };
    await appendGhShadowCapturedEvent(owner, openEv);
    await appendGhShadowCapturedEvent(owner, exitEv);

    const netMove = exitBid - 2650.12 - friction;
    const trade: GhShadowTrade = {
      tradeId: "trade-beyond",
      qualificationId: qid,
      opportunityId: "opp-beyond",
      signalId: "sig-beyond",
      setup: "A",
      setupId: "A_MOMENTUM_IGNITION",
      side: "BUY",
      status: "CLOSED",
      dataQuality: "FORMAL_ELIGIBLE",
      exclusionReason: null,
      signalTs: openDec.at,
      entryTs: openDec.at,
      entryBid: 2650,
      entryAsk: 2650.12,
      entryPrice: 2650.12,
      entrySpread: 0.12,
      initialStop: 2650.12 - hs,
      exitTs: exitDec.at,
      exitBid,
      exitAsk,
      exitPrice: exitBid,
      exitReason: "HARD_PROTECTION",
      mfe: 0,
      mae: -(hs + 0.01),
      durationMs: 1000,
      grossPriceMove: exitBid - 2650.12,
      frictionPrice: friction,
      netPriceMove: netMove,
      simulatedGrossPnlQuote: null,
      simulatedFrictionPnlQuote: null,
      simulatedNetPnlQuote: null,
      quoteCurrency: "USD",
      plannedRiskR: null,
      netR: null,
      geometryR: null,
      geometryRiskQuote: null,
      simulatedGrossPnlEur: null,
      simulatedFrictionEur: null,
      simulatedNetPnlEur: null,
      eurPnlAvailable: false,
      economic: null,
      latency: null,
      profitLockActivatedAt: null,
      trailActivatedAt: null,
      trailUpdateCount: 0,
      lockFloorAtActivation: null,
      lockFloorLatest: null,
      maxFavorableBeforeExit: 0,
      maxAdverseBeforeExit: -(hs + 0.01),
      strategySha: "x",
      configSha: "x",
      receiveSeqAtEntry: 2101,
      receiveSeqAtExit: 2102,
      bookGeneration: 1,
      resyncGeneration: 0,
      runtimeGeneration: 1,
      path: {
        profitLockActivateMfeAtActivation: null,
        lockFloorAtActivation: null,
        lockFloorAtExit: null,
        bestExitAtExit: exitBid
      }
    };
    await upsertGhShadowTrade(owner, trade);

    const replay = await runGhShadowReplayAndGate(owner);
    expect(replay.livePoints.some((p) => p.kind === "OPEN")).toBe(true);
    expect(replay.livePoints.some((p) => p.kind === "EXIT")).toBe(true);
    expect(replay.status).not.toBe("REPLAY_INCOMPLETE");
    expect(replay.status).toBe("LIVE_REPLAY_OK");
  });
});

describe("strategy freeze smoke", () => {
  it("frozen soak params unchanged", () => {
    const c = frozenGhFastSoakConfig();
    expect(c.hardStop).toBe(0.55);
    expect(c.profitLockActivateMfe).toBe(0.18);
    expect(c.profitLockFraction).toBe(0.45);
    expect(c.trailDistance).toBe(0.12);
    expect(c.friction).toBe(0.06);
  });
});
