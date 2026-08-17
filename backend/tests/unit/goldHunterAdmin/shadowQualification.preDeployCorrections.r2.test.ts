/**
 * PR #144 pre-deploy integrity corrections (round 2).
 * Features-only Demo management parity, stable sizing hash + account ID,
 * real >50k pagination, replay freshness after ACK.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  GhShadowQualificationEngine,
  getGhShadowEngine,
  resetGhShadowEnginesForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/engine";
import { computeGhShadowPerformanceReport } from "../../../src/services/goldHunterAdmin/shadowQualification/performance";
import {
  buildFrozenSizingSnapshot,
  hashAdminSizingConfig,
  sizingSnapshotChanged
} from "../../../src/services/goldHunterAdmin/shadowQualification/frozenSizing";
import {
  flushGhShadowPersistenceForTests,
  processGhShadowMarketEventSync,
  resetGhShadowQualificationRuntimeForTests,
  runGhShadowReplayAndGate,
  setGhShadowAllowUnitTestSizingDefaultsForTests,
  setGhShadowAutoPersistForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/runtime";
import {
  appendGhShadowCapturedEvent,
  listAllGhShadowCapturedEvents,
  listGhShadowCapturedEventsPage,
  loadGhShadowEpoch,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  setCurrentQualificationId
} from "../../../src/services/goldHunterAdmin/shadowQualification/store";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID
} from "../../../src/services/goldHunterAdmin/types";
import type { GoldHunterSelectedCandidate } from "../../../src/services/goldHunterAdmin/strategySelector";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import type { GhShadowCapturedEvent } from "../../../src/services/goldHunterAdmin/shadowQualification/types";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc/frozenConfig";

const OWNER = "gh-predeploy-r2";

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
    setup: "B",
    setupId: "B_FAST_BREAKOUT",
    side: "BUY",
    quality: 0.8,
    signalId: "GH-SIG-R2",
    opportunityId: "GH-OPP-R2",
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

function frozen(over: Parameters<typeof buildFrozenSizingSnapshot>[0] extends infer _T
  ? Partial<Parameters<typeof buildFrozenSizingSnapshot>[0]>
  : never = {}) {
  return buildFrozenSizingSnapshot({
    config: cfg(),
    quoteToDepositRate: 0.86624336,
    quoteToDepositRateSource: "test",
    symbolId: "41",
    ctidTraderAccountId: "48014710",
    accountMatched: true,
    environment: "DEMO",
    metadataSource: "CTRADER_WORKER_SYMBOL_BY_ID",
    metadataLoadedAt: "2026-08-17T00:00:00.000Z",
    ...over
  });
}

beforeEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  resetGhShadowEnginesForTests();
  resetGhShadowQualificationMemoryForTests();
  setGhShadowAllowUnitTestSizingDefaultsForTests(true);
  delete process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED;
});

afterEach(() => {
  resetGhShadowQualificationRuntimeForTests();
});

describe("FIX1 — Demo management features-only parity", () => {
  it("missing features does not update MFE/MAE/lock/trail; features resume management", () => {
    const eng = new GhShadowQualificationEngine({ ownerUid: OWNER + "-feat" });
    const fs = frozen();
    const opp = opportunity({ side: "BUY", bid: 2650.0, ask: 2650.12 });
    eng.processEvent({
      receiveSeq: 1,
      eventTsMs: 1000,
      strategySpotBid: 2650.0,
      strategySpotAsk: 2650.12,
      depthBestBid: 2700,
      depthBestAsk: 2700.5,
      features: features(2650.0, 2650.12),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opp,
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    expect(eng.getOpenTradeId()).not.toBeNull();
    const openId = eng.getOpenTradeId()!;

    // Favorable move with features first — establish baseline MFE
    eng.processEvent({
      receiveSeq: 2,
      eventTsMs: 1100,
      strategySpotBid: 2650.2,
      strategySpotAsk: 2650.32,
      depthBestBid: 2710,
      depthBestAsk: 2710.5,
      features: features(2650.2, 2650.32),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: false,
      opportunity: null,
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    const afterFeat = eng.getOpenTradeSnapshotForTests();
    expect(afterFeat?.tradeId).toBe(openId);
    const mfeBefore = afterFeat!.mfe;
    const maeBefore = afterFeat!.mae;
    const lockBefore = afterFeat!.profitLockActivatedAt;
    const trailBefore = afterFeat!.trailActivatedAt;
    const trailCountBefore = afterFeat!.trailUpdateCount;
    expect(mfeBefore).toBeGreaterThan(0);

    // Tick with Depth + fallback Spot prices BUT features ABSENT — must not manage
    eng.processEvent({
      receiveSeq: 3,
      eventTsMs: 1200,
      strategySpotBid: 2800, // would move MFE if wrongly used
      strategySpotAsk: 2800.1,
      depthBestBid: 2800,
      depthBestAsk: 2800.1,
      features: null,
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: false,
      opportunity: null,
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    const afterMissing = eng.getOpenTradeSnapshotForTests();
    expect(afterMissing?.tradeId).toBe(openId);
    expect(afterMissing!.mfe).toBe(mfeBefore);
    expect(afterMissing!.mae).toBe(maeBefore);
    expect(afterMissing!.profitLockActivatedAt).toBe(lockBefore);
    expect(afterMissing!.trailActivatedAt).toBe(trailBefore);
    expect(afterMissing!.trailUpdateCount).toBe(trailCountBefore);

    // Features return — management resumes with features.bid/ask (not depth)
    eng.processEvent({
      receiveSeq: 4,
      eventTsMs: 1300,
      strategySpotBid: 2650.35,
      strategySpotAsk: 2650.45,
      depthBestBid: 2900,
      depthBestAsk: 2900.5,
      features: features(2650.35, 2650.45),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: false,
      opportunity: null,
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    const resumed = eng.getOpenTradeSnapshotForTests();
    expect(resumed).toBeTruthy();
    expect(resumed!.mfe).toBeGreaterThan(mfeBefore);
    // Must not have used depth 2900 as exit/management price
    expect(resumed!.mfe).toBeLessThan(50);
  });

  it("depth best != strategy Spot: formal uses features only", () => {
    const eng = new GhShadowQualificationEngine({ ownerUid: OWNER + "-depth" });
    const fs = frozen();
    eng.processEvent({
      receiveSeq: 1,
      eventTsMs: 1000,
      strategySpotBid: 2650.0,
      strategySpotAsk: 2650.12,
      depthBestBid: 2999,
      depthBestAsk: 3000,
      features: features(2650.0, 2650.12),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity({ bid: 2650.0, ask: 2650.12 }),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    const trade = eng.drainPersistBatch()?.trades.find((t) => t.status === "OPEN");
    expect(trade?.entryPrice).toBe(2650.12);
    expect(trade?.entryPrice).not.toBe(3000);
  });
});

describe("FIX2 — account ID + stable sizing hash", () => {
  it("TEST A: volatile timestamps do not change stable hash", () => {
    const a = buildFrozenSizingSnapshot({
      config: cfg(),
      minLots: 1,
      maxLots: 5000,
      lotStep: 1,
      ozPerLot: 1,
      symbolId: "41",
      ctidTraderAccountId: "48014710",
      accountMatched: true,
      environment: "DEMO",
      metadataSource: "CTRADER_WORKER_SYMBOL_BY_ID",
      metadataLoadedAt: "2026-01-01T00:00:00.000Z"
    });
    const b = buildFrozenSizingSnapshot({
      config: cfg(),
      minLots: 1,
      maxLots: 5000,
      lotStep: 1,
      ozPerLot: 1,
      symbolId: "41",
      ctidTraderAccountId: "48014710",
      accountMatched: true,
      environment: "DEMO",
      metadataSource: "CTRADER_WORKER_SYMBOL_BY_ID",
      metadataLoadedAt: "2026-08-17T12:00:00.000Z"
    });
    expect(a.metadataLoadedAt).not.toBe(b.metadataLoadedAt);
    // snappedAt may collide within the same ms; hash must still ignore it.
    expect(a.adminSizingConfigSha).toBe(b.adminSizingConfigSha);
    expect(sizingSnapshotChanged(a, b)).toBe(false);
    // Explicitly prove timestamps are excluded even when present on the object
    const h1 = hashAdminSizingConfig({
      ...a,
      metadataLoadedAt: "2020-01-01T00:00:00.000Z"
    });
    const h2 = hashAdminSizingConfig({
      ...a,
      metadataLoadedAt: "2099-12-31T23:59:59.999Z"
    });
    expect(h1).toBe(h2);
    expect(h1).toBe(a.adminSizingConfigSha);
  });

  it("TEST B: different cTrader account ID changes hash", () => {
    const a = frozen({ ctidTraderAccountId: "48014710" });
    const b = frozen({ ctidTraderAccountId: "99999999" });
    expect(a.ctidTraderAccountId).toBe("48014710");
    expect(b.ctidTraderAccountId).toBe("99999999");
    expect(a.adminSizingConfigSha).not.toBe(b.adminSizingConfigSha);
    expect(sizingSnapshotChanged(a, b)).toBe(true);
  });

  it("TEST C: economically relevant volume step / ozPerLot changes hash", () => {
    const a = frozen({ lotStep: 1, ozPerLot: 1 });
    const b = frozen({ lotStep: 0.01, ozPerLot: 1 });
    const c = frozen({ lotStep: 1, ozPerLot: 100 });
    expect(sizingSnapshotChanged(a, b)).toBe(true);
    expect(sizingSnapshotChanged(a, c)).toBe(true);
  });
});

describe("FIX3 — real >50k pagination / replay", () => {
  it("retrieves exactly 52,500 events with no duplicates/missing; delete ⇒ REPLAY_INCOMPLETE", async () => {
    const TOTAL = 52_500;
    const PAGE = 5_000;
    const owner = OWNER + "-52k";
    const qid = "GH-SQ-52k";
    const epochBase = {
      qualificationId: qid,
      qualificationStartTime: new Date().toISOString(),
      qualificationStartSequence: 1,
      strategySha: "x",
      configSha: "x",
      strategyVersion: "v",
      engineVersion: "e",
      soakLabel: "s",
      frozenSizing: frozen(),
      formalQualificationTrades: 0,
      diagnosticExcludedTrades: 0,
      openShadowTradeId: null,
      status: "ACTIVE" as const,
      dataIntegrityFailure: null,
      persistFailureReason: null,
      runtimeGeneration: 1,
      lastRestartReason: null,
      integrity: {
        eventsSeen: TOTAL,
        eventsProcessed: TOTAL,
        eventsPersisted: TOTAL,
        eventsDropped: 0,
        receiveSeqGaps: 0,
        receiveSeqDuplicates: 0,
        receiveSeqOutOfOrder: 0,
        journalOverflowCount: 0,
        journalPending: 0,
        journalHighWaterMark: 0,
        persistAcknowledgedEvents: TOTAL,
        persistFailures: 0,
        lastProcessedReceiveSeq: TOTAL,
        lastResyncGeneration: 0
      },
      activity: {
        newOpportunitiesDetected: 0,
        formalTradesOpened: 0,
        formalTradesClosed: 0,
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
        bySetupOpened: { A: 0, B: 0, C: 0 }
      },
      lastReplayStatus: "NOT_RUN" as const,
      lastReplayDetail: null,
      updatedAt: new Date().toISOString()
    };
    await saveGhShadowEpoch(owner, epochBase);
    await setCurrentQualificationId(owner, qid);

    for (let i = 1; i <= TOTAL; i++) {
      const ev: GhShadowCapturedEvent = {
        eventId: `ev-${String(i).padStart(6, "0")}`,
        qualificationId: qid,
        receiveSeq: i,
        eventTs: new Date(i).toISOString(),
        eventTsMs: i,
        bid: 2650,
        ask: 2650.1,
        spread: 0.1,
        strategySpotBid: 2650,
        strategySpotAsk: 2650.1,
        depthBestBid: 2650,
        depthBestAsk: 2650.1,
        features: null,
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
      await appendGhShadowCapturedEvent(owner, ev);
    }

    const pages: number[] = [];
    let cursor: { receiveSeq: number; eventId: string } | null = null;
    const collected: GhShadowCapturedEvent[] = [];
    for (;;) {
      const page = await listGhShadowCapturedEventsPage(owner, {
        qualificationId: qid,
        pageSize: PAGE,
        startAfter: cursor
      });
      pages.push(page.events.length);
      collected.push(...page.events);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(pages.length).toBeGreaterThan(10); // 52500/5000 = 11 pages
    expect(collected.length).toBe(TOTAL);
    expect(pages.reduce((a, b) => a + b, 0)).toBe(TOTAL);

    const ids = collected.map((e) => e.eventId);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(collected[0]!.receiveSeq).toBe(1);
    expect(collected[0]!.eventId).toBe("ev-000001");
    expect(collected[TOTAL - 1]!.receiveSeq).toBe(TOTAL);
    expect(collected[TOTAL - 1]!.eventId).toBe("ev-052500");
    for (let i = 1; i < collected.length; i++) {
      const prev = collected[i - 1]!;
      const cur = collected[i]!;
      const prevKey = `${String(prev.receiveSeq).padStart(16, "0")}:${prev.eventId}`;
      const curKey = `${String(cur.receiveSeq).padStart(16, "0")}:${cur.eventId}`;
      expect(curKey > prevKey).toBe(true);
    }

    const all = await listAllGhShadowCapturedEvents(owner, {
      qualificationId: qid,
      pageSize: PAGE
    });
    expect(all.length).toBe(TOTAL);
    expect(all.length).toBe(epochBase.integrity.persistAcknowledgedEvents);

    // Delete one → REPLAY_INCOMPLETE
    const keep = collected.filter((_, i) => i !== 100);
    resetGhShadowQualificationMemoryForTests();
    await saveGhShadowEpoch(owner, {
      ...epochBase,
      integrity: {
        ...epochBase.integrity,
        persistAcknowledgedEvents: TOTAL,
        eventsPersisted: TOTAL
      }
    });
    await setCurrentQualificationId(owner, qid);
    for (const e of keep) {
      await appendGhShadowCapturedEvent(owner, e);
    }
    const replay = await runGhShadowReplayAndGate(owner);
    expect(replay.status).toBe("REPLAY_INCOMPLETE");
    expect(replay.expectedEvents).toBe(TOTAL);
    expect(replay.capturedEvents).toBe(TOTAL - 1);
  }, 120_000);
});

describe("FIX4 — replay freshness after new ACK", () => {
  it("LIVE_REPLAY_OK becomes STALE after additional ACK; edgeDecisionReady false until re-run", async () => {
    const owner = OWNER + "-fresh";
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
    // Close quickly
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
    // latency finalize tick
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
    const epoch1 = await loadGhShadowEpoch(owner);
    expect(epoch1).not.toBeNull();
    const n1 = epoch1!.integrity.persistAcknowledgedEvents;
    expect(n1).toBeGreaterThan(0);

    const replay1 = await runGhShadowReplayAndGate(owner);
    expect(replay1.status).toBe("LIVE_REPLAY_OK");
    const afterReplay = await loadGhShadowEpoch(owner);
    expect(afterReplay!.lastReplayStatus).toBe("LIVE_REPLAY_OK");
    expect(afterReplay!.lastReplayDetail?.expectedEvents).toBe(n1);

    // Sync engine epoch replay fields (runGhShadowReplay updates engine)
    const eng = getGhShadowEngine(owner);
    expect(eng.getEpoch()?.lastReplayStatus).toBe("LIVE_REPLAY_OK");

    // ACK additional formal-path events
    setGhShadowAutoPersistForTests(false);
    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 4,
      eventTsMs: 2000,
      strategySpotBid: 2650,
      strategySpotAsk: 2650.12,
      features: features(2650, 2650.12),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: true,
      opportunity: opportunity({
        opportunityId: "GH-OPP-R2B",
        signalId: "GH-SIG-R2B",
        receiveSeq: 4,
        latestReceiveSeq: 4
      }),
      config: cfg()
    });
    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 5,
      eventTsMs: 2100,
      strategySpotBid: 2650.12 - hard - 0.01,
      strategySpotAsk: 2650.12 - hard,
      features: features(2650.12 - hard - 0.01, 2650.12 - hard),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    setGhShadowAutoPersistForTests(true);
    await flushGhShadowPersistenceForTests(owner);

    const stale = await loadGhShadowEpoch(owner);
    expect(stale!.integrity.persistAcknowledgedEvents).toBeGreaterThan(n1);
    expect(stale!.lastReplayStatus).toBe("REPLAY_STALE");
    expect(stale!.lastReplayDetail?.divergenceDetail).toMatch(/replay_stale_after_ack/);

    // Stale replay must not satisfy edge gate even with 250 synthetic trades
    const trades = Array.from({ length: 250 }, (_, i) => ({
      tradeId: `t${i}`,
      qualificationId: stale!.qualificationId,
      opportunityId: `o${i}`,
      signalId: `s${i}`,
      setup: "A" as const,
      setupId: "A_MOMENTUM_IGNITION" as const,
      side: "BUY" as const,
      status: "CLOSED" as const,
      dataQuality: "FORMAL_ELIGIBLE" as const,
      exclusionReason: null,
      signalTs: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      entryTs: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      entryBid: 100,
      entryAsk: 100.1,
      entryPrice: 100.1,
      entrySpread: 0.1,
      initialStop: 99.55,
      exitTs: new Date(Date.UTC(2026, 0, 1, 0, 1, i)).toISOString(),
      exitBid: 100.2,
      exitAsk: 100.3,
      exitPrice: 100.2,
      exitReason: "HARVEST_FADE" as const,
      mfe: 0.2,
      mae: -0.05,
      durationMs: 1000,
      grossPriceMove: 0.1,
      frictionPrice: 0.06,
      netPriceMove: 0.04,
      simulatedGrossPnlQuote: 2,
      simulatedFrictionPnlQuote: 0.5,
      simulatedNetPnlQuote: 1.5,
      quoteCurrency: "USD",
      plannedRiskR: 0.15,
      netR: 0.15,
      geometryR: 0.15,
      geometryRiskQuote: 10,
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
      maxFavorableBeforeExit: 0.2,
      maxAdverseBeforeExit: -0.05,
      strategySha: "x",
      configSha: "x",
      receiveSeqAtEntry: i,
      receiveSeqAtExit: i + 1,
      bookGeneration: 1,
      resyncGeneration: 0,
      runtimeGeneration: 1,
      path: {
        profitLockActivateMfeAtActivation: null,
        lockFloorAtActivation: null,
        lockFloorAtExit: null,
        bestExitAtExit: null
      }
    }));
    const reportStale = computeGhShadowPerformanceReport(trades, stale);
    expect(reportStale.checkpoint.edgeDecisionReady).toBe(false);

    // Re-run replay against current dataset → current again
    const replay2 = await runGhShadowReplayAndGate(owner);
    // May be OK or DIVERGENCE depending on decision/trade completeness; currency matters
    const refreshed = await loadGhShadowEpoch(owner);
    expect(refreshed!.lastReplayStatus).not.toBe("REPLAY_STALE");
    expect(refreshed!.lastReplayDetail?.expectedEvents).toBe(
      refreshed!.integrity.persistAcknowledgedEvents
    );
    if (replay2.status === "LIVE_REPLAY_OK") {
      const reportFresh = computeGhShadowPerformanceReport(trades, {
        ...refreshed!,
        lastReplayStatus: "LIVE_REPLAY_OK",
        lastReplayDetail: {
          capturedEvents: refreshed!.integrity.persistAcknowledgedEvents,
          replayedEvents: refreshed!.integrity.persistAcknowledgedEvents,
          expectedEvents: refreshed!.integrity.persistAcknowledgedEvents,
          firstDivergenceSeq: null,
          divergenceDetail: null,
          completedAt: new Date().toISOString()
        }
      });
      expect(reportFresh.checkpoint.edgeDecisionReady).toBe(true);
    }
  });
});

describe("strategy freeze smoke", () => {
  it("ABC geometry untouched", () => {
    const c = frozenGhFastSoakConfig();
    expect(c.hardStop).toBe(0.55);
    expect(c.profitLockActivateMfe).toBe(0.18);
    expect(c.profitLockFraction).toBe(0.45);
    expect(c.trailDistance).toBe(0.12);
    expect(c.friction).toBe(0.06);
  });
});
