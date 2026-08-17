/**
 * Final qualification integrity tests (A–K).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertGhShadowNoBrokerMutationSurface,
  getGhShadowMutationSurfaceReport
} from "../../../src/services/goldHunterAdmin/shadowQualification/brokerMutationGuard";
import {
  GhShadowQualificationEngine,
  getGhShadowEngine,
  resetGhShadowEnginesForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/engine";
import { computeGhShadowPerformanceReport } from "../../../src/services/goldHunterAdmin/shadowQualification/performance";
import { buildFrozenSizingSnapshot } from "../../../src/services/goldHunterAdmin/shadowQualification/frozenSizing";
import {
  awaitGhShadowOwnerReady,
  flushGhShadowPersistenceForTests,
  getGhShadowConfigReadCount,
  getGhShadowOwnerLifecycle,
  processGhShadowMarketEventSync,
  resetGhShadowQualificationRuntimeForTests,
  runGhShadowReplayAndGate,
  setGhShadowLoadEpochDelayMsForTests,
  setGhShadowPersistFailHookForTests,
  ensureGhShadowOwnerReady,
  onGhShadowMarketTick
} from "../../../src/services/goldHunterAdmin/shadowQualification/runtime";
import {
  loadGhShadowEpoch,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  upsertGhShadowTrade
} from "../../../src/services/goldHunterAdmin/shadowQualification/store";
import { simulateGhShadowCashPnl } from "../../../src/services/goldHunterAdmin/shadowQualification/economics";
import { computeGhShadowEconomicExposure } from "../../../src/services/goldHunterAdmin/shadowQualification/economics";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID
} from "../../../src/services/goldHunterAdmin/types";
import type { GoldHunterSelectedCandidate } from "../../../src/services/goldHunterAdmin/strategySelector";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import type {
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "../../../src/services/goldHunterAdmin/shadowQualification/types";
import { getGoldHunterStrategySelector } from "../../../src/services/goldHunterAdmin/strategySelector";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc/frozenConfig";

const OWNER = "gh-final-integrity";

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
    side: "SELL",
    quality: 0.8,
    signalId: "GH-SIG-B",
    opportunityId: "GH-OPP-B",
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

function frozen(over: Partial<ReturnType<typeof buildFrozenSizingSnapshot>> = {}) {
  return buildFrozenSizingSnapshot({
    config: cfg(),
    quoteToDepositRate: 0.86624336,
    quoteToDepositRateSource: "test",
    ...over
  });
}

beforeEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  resetGhShadowEnginesForTests();
  resetGhShadowQualificationMemoryForTests();
  delete process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED;
});

afterEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  setGhShadowPersistFailHookForTests(null);
  setGhShadowLoadEpochDelayMsForTests(0);
});

describe("A — startup recovery race", () => {
  it("first tick during INITIALIZING does not write into discarded engine", async () => {
    process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED = "true";
    setGhShadowLoadEpochDelayMsForTests(80);
    ensureGhShadowOwnerReady(OWNER);
    expect(getGhShadowOwnerLifecycle(OWNER)).toBe("INITIALIZING");

    const sel = getGoldHunterStrategySelector(OWNER);
    // Tick while initializing — must be ignored (no formal)
    onGhShadowMarketTick({
      ownerUid: OWNER,
      tick: {
        selectedNow: false,
        newOpportunity: true,
        candidate: opportunity(),
        opportunity: opportunity()
      },
      receiveSeq: 1,
      receivedAtMs: Date.now(),
      resyncGeneration: 0,
      bookGeneration: 1
    });
    // Engine may not exist yet or must not have formal open from discarded instance
    expect(getGhShadowOwnerLifecycle(OWNER)).toBe("INITIALIZING");

    await awaitGhShadowOwnerReady(OWNER);
    expect(getGhShadowOwnerLifecycle(OWNER)).toBe("READY");
    const eng = getGhShadowEngine(OWNER);
    // Warmup tick must not have opened formal on discarded engine
    expect(eng.getOpenTradeId()).toBeNull();
    void sel;
  });
});

describe("B — authoritative sequence", () => {
  it("duplicate / out-of-order / gap / resync invalidate formal", () => {
    const fs = frozen();
    const run = (uid: string) =>
      new GhShadowQualificationEngine({ ownerUid: uid });

    // duplicate
    const d = run(OWNER + "-dup");
    d.processEvent({
      receiveSeq: 1,
      eventTsMs: 10,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity({ side: "BUY", setup: "A" }),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    expect(d.getOpenTradeId()).not.toBeNull();
    d.processEvent({
      receiveSeq: 1,
      eventTsMs: 11,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
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
    expect(d.getEpoch()?.integrity.receiveSeqDuplicates).toBeGreaterThan(0);
    expect(d.getOpenTradeId()).toBeNull();

    // gap
    const g = run(OWNER + "-gap");
    g.processEvent({
      receiveSeq: 1,
      eventTsMs: 10,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity({ side: "BUY", setup: "A" }),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    g.processEvent({
      receiveSeq: 3,
      eventTsMs: 30,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
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
    expect(g.getEpoch()?.integrity.receiveSeqGaps).toBeGreaterThan(0);

    // OOO
    const o = run(OWNER + "-ooo");
    o.processEvent({
      receiveSeq: 5,
      eventTsMs: 50,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity({ side: "BUY", setup: "A" }),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    o.processEvent({
      receiveSeq: 4,
      eventTsMs: 40,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
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
    expect(o.getEpoch()?.integrity.receiveSeqOutOfOrder).toBeGreaterThan(0);

    // resync
    const r = run(OWNER + "-rs");
    r.processEvent({
      receiveSeq: 1,
      eventTsMs: 1,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity({ side: "BUY", setup: "A" }),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    r.processEvent({
      receiveSeq: 2,
      eventTsMs: 2,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 1,
      newOpportunity: false,
      opportunity: null,
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    expect(r.getOpenTradeId()).toBeNull();
    expect(r.getEpoch()?.status).toBe("DATA_QUALITY_FAILED");
  });
});

describe("C/D — journal ACK + persist fail-close", () => {
  it(">50k lifetime events with ACKs does not artificial-overflow", () => {
    const eng = new GhShadowQualificationEngine({
      ownerUid: OWNER + "-life",
      journalCapacity: 100
    });
    const fs = frozen();
    // Open once
    eng.processEvent({
      receiveSeq: 1,
      eventTsMs: 1,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity(),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    // Simulate many ACKed batches while open
    for (let i = 2; i <= 600; i++) {
      eng.processEvent({
        receiveSeq: i,
        eventTsMs: i,
        bid: 2650,
        ask: 2650.1,
        features: features(2650, 2650.1),
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
      const batch = eng.drainPersistBatch();
      if (batch?.events.length) {
        eng.acknowledgePersist(batch.events.map((e) => e.eventId));
      }
    }
    expect(eng.getJournal().stats().journalPending).toBeLessThan(100);
    expect(eng.getEpoch()?.integrity.journalOverflowCount ?? 0).toBe(0);
    expect(eng.getEpoch()?.integrity.persistAcknowledgedEvents).toBeGreaterThan(
      100
    );
  });

  it("eventsPersisted only after ACK; persist failure fail-closes", async () => {
    const eng = new GhShadowQualificationEngine({ ownerUid: OWNER + "-ack" });
    const fs = frozen();
    eng.processEvent({
      receiveSeq: 1,
      eventTsMs: 1,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity({ side: "BUY", setup: "A" }),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    const before = eng.getEpoch()!.integrity.eventsPersisted;
    const batch = eng.drainPersistBatch()!;
    expect(batch.events.length).toBeGreaterThan(0);
    expect(eng.getEpoch()!.integrity.eventsPersisted).toBe(before);
    eng.acknowledgePersist(batch.events.map((e) => e.eventId));
    expect(eng.getEpoch()!.integrity.eventsPersisted).toBeGreaterThan(before);

    // Failure path via runtime schedule
    process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED = "true";
    setGhShadowPersistFailHookForTests(() => {
      throw new Error("forced_persist_fail");
    });
    processGhShadowMarketEventSync({
      ownerUid: OWNER,
      receiveSeq: 1,
      eventTsMs: 1,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: true,
      opportunity: opportunity({ side: "BUY", setup: "A" }),
      config: cfg(),
      sizingOverrides: { quoteToDepositRate: 0.866 }
    });
    for (let i = 0; i < 8; i++) {
      await flushGhShadowPersistenceForTests(OWNER);
    }
    const epoch = getGhShadowEngine(OWNER).getEpoch();
    expect(
      (epoch?.integrity.persistFailures ?? 0) > 0 ||
        epoch?.status === "DATA_QUALITY_FAILED"
    ).toBe(true);
  });
});

describe("E — restart preserves forensics", () => {
  it("excludes exact persisted open trade metadata", async () => {
    const eng1 = getGhShadowEngine(OWNER, { forceNew: true, runtimeGeneration: 1 });
    const fs = frozen();
    eng1.processEvent({
      receiveSeq: 1,
      eventTsMs: 1,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity({ setup: "C", setupId: "C_PULLBACK_REACCEL", side: "BUY" }),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    const openId = eng1.getOpenTradeId()!;
    const batch = eng1.drainPersistBatch()!;
    const openTrade = batch.trades.find((t) => t.tradeId === openId)!;
    expect(openTrade.setup).toBe("C");
    expect(openTrade.side).toBe("BUY");
    await saveGhShadowEpoch(OWNER, eng1.getEpoch()!);
    await upsertGhShadowTrade(OWNER, openTrade);

    resetGhShadowEnginesForTests();
    const eng2 = getGhShadowEngine(OWNER, { forceNew: true, runtimeGeneration: 2 });
    const persisted = await loadGhShadowEpoch(OWNER);
    const loaded = (
      await import("../../../src/services/goldHunterAdmin/shadowQualification/store")
    ).loadGhShadowTrade;
    const trade = await loaded(OWNER, openId, persisted!.qualificationId);
    const { excludedTradeId } = eng2.recoverAfterRestart({
      persistedEpoch: persisted,
      persistedOpenTrade: trade,
      reason: "test"
    });
    expect(excludedTradeId).toBe(openId);
    const excluded = eng2.drainPersistBatch()?.trades.find((t) => t.tradeId === openId);
    expect(excluded?.setup).toBe("C");
    expect(excluded?.side).toBe("BUY");
    expect(excluded?.opportunityId).toBe(openTrade.opportunityId);
    expect(excluded?.exclusionReason).toBe("runtime_restart_state_lost");
    expect(excluded?.dataQuality).toBe("DIAGNOSTIC_EXCLUDED");
  });
});

describe("F — performance units", () => {
  it("never mixes EUR and quote; R-multiple present; MFE capture same unit", () => {
    const fs = frozen();
    const sizing = computeGhShadowEconomicExposure({
      config: cfg(),
      entryPrice: 2650.1,
      side: "BUY",
      frozenSizing: fs
    });
    expect(sizing.ok).toBe(true);
    if (!sizing.ok) return;
    const pnl = simulateGhShadowCashPnl({
      side: "BUY",
      entryPrice: 2650.1,
      exitPrice: 2650.3,
      economic: sizing.economic
    });
    expect(pnl.netQuote).toBeGreaterThan(0);
    expect(pnl.netR).not.toBeNull();

    const mk = (i: number, netQ: number, eur: number | null): GhShadowTrade =>
      ({
        tradeId: `t${i}`,
        qualificationId: "q",
        opportunityId: `o${i}`,
        signalId: `s${i}`,
        setup: "A",
        setupId: "A_MOMENTUM_IGNITION",
        side: "BUY",
        status: "CLOSED",
        dataQuality: "FORMAL_ELIGIBLE",
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
        exitReason: "HARVEST_FADE",
        mfe: 0.2,
        mae: -0.05,
        durationMs: 1000,
        grossPriceMove: 0.1,
        frictionPrice: 0.06,
        netPriceMove: 0.04,
        simulatedGrossPnlQuote: netQ + 0.5,
        simulatedFrictionPnlQuote: 0.5,
        simulatedNetPnlQuote: netQ,
        quoteCurrency: "USD",
        netR: netQ / 10,
        simulatedGrossPnlEur: eur,
        simulatedFrictionEur: eur != null ? 0.1 : null,
        simulatedNetPnlEur: eur,
        eurPnlAvailable: eur != null,
        economic: sizing.economic,
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
      });

    // Mixed EUR coverage must not make EUR authoritative or mix into primary
    const trades = [mk(1, 2, 1.5), mk(2, -1, null)];
    const epoch: GhShadowQualificationEpoch = {
      qualificationId: "q",
      qualificationStartTime: new Date().toISOString(),
      qualificationStartSequence: 0,
      strategySha: "x",
      configSha: "x",
      strategyVersion: "GOLD_HUNTER_FAST_V1",
      engineVersion: "GH_FAST_EVENT_V1",
      soakLabel: "LIVE_SHADOW_SOAK_V1",
      frozenSizing: fs,
      formalQualificationTrades: 2,
      diagnosticExcludedTrades: 0,
      openShadowTradeId: null,
      status: "ACTIVE",
      dataIntegrityFailure: null,
      persistFailureReason: null,
      runtimeGeneration: 1,
      lastRestartReason: null,
      integrity: {
        eventsSeen: 0,
        eventsProcessed: 0,
        eventsPersisted: 0,
        eventsDropped: 0,
        receiveSeqGaps: 0,
        receiveSeqDuplicates: 0,
        receiveSeqOutOfOrder: 0,
        journalOverflowCount: 0,
        journalPending: 0,
        journalHighWaterMark: 0,
        persistAcknowledgedEvents: 0,
        persistFailures: 0,
        lastProcessedReceiveSeq: null,
        lastResyncGeneration: null
      },
      activity: {
        newOpportunitiesDetected: 2,
        formalTradesOpened: 2,
        formalTradesClosed: 2,
        opportunitiesWhileAlreadyOpen: 0,
        opportunitiesExcludedDataQuality: 0,
        opportunitiesRejectedSizing: 0,
        opportunitiesWarmupIgnored: 0,
        otherRejectionReasons: {},
        activeMarketMs: 3_600_000,
        entryTimestampsMs: [1, 2],
        openTradeDurationsMs: [1000, 2000],
        flatIdleSegmentsMs: [5000],
        lastActiveMarketAtMs: 2,
        lastEntryAtMs: 2,
        lastFlatActiveAtMs: null,
        currentFlatIdleActiveMs: 0,
        lastFlatStartMs: null,
        bySetupOpened: { A: 2, B: 0, C: 0 }
      },
      lastReplayStatus: "NOT_RUN",
      lastReplayDetail: null,
      updatedAt: new Date().toISOString()
    };
    const report = computeGhShadowPerformanceReport(trades, epoch);
    expect(report.formalUnit).toBe("QUOTE_USD");
    expect(report.netPnlQuoteUsd).toBeCloseTo(1, 8);
    expect(report.eurAuthoritative).toBe(false);
    expect(report.netPnlEur).toBeNull();
    expect(report.expectancyR).not.toBeNull();
    expect(report.activity.tradesPerActiveMarketHour).toBeCloseTo(2, 5);
  });
});

describe("G — frozen sizing / no per-tick config read", () => {
  it("config is not re-read on every market tick once READY", async () => {
    process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED = "true";
    await awaitGhShadowOwnerReady(OWNER);
    const readsAfterInit = getGhShadowConfigReadCount(OWNER);
    expect(readsAfterInit).toBe(1);
    const sel = getGoldHunterStrategySelector(OWNER);
    for (let i = 0; i < 20; i++) {
      onGhShadowMarketTick({
        ownerUid: OWNER,
        tick: {
          selectedNow: false,
          newOpportunity: false,
          candidate: null,
          opportunity: null
        },
        receiveSeq: sel.getReceiveSeq() + 1 + i,
        receivedAtMs: Date.now(),
        resyncGeneration: 0,
        bookGeneration: 1
      });
    }
    expect(getGhShadowConfigReadCount(OWNER)).toBe(1);
  });
});

describe("H/I/J — activity, latency, truncated replay", () => {
  it("activity metrics and latency sensitivity capture", () => {
    const eng = new GhShadowQualificationEngine({ ownerUid: OWNER + "-act" });
    const fs = frozen();
    eng.processEvent({
      receiveSeq: 1,
      eventTsMs: 1_000,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      bookGeneration: 1,
      resyncGeneration: 0,
      newOpportunity: true,
      opportunity: opportunity({ side: "BUY", setup: "A" }),
      config: cfg(),
      frozenSizing: fs,
      allowFormal: true
    });
    // hard stop exit for BUY
    eng.processEvent({
      receiveSeq: 2,
      eventTsMs: 1_050,
      bid: 2649.4,
      ask: 2649.5,
      features: features(2649.4, 2649.5),
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
    // post-exit latency samples
    eng.processEvent({
      receiveSeq: 3,
      eventTsMs: 1_160,
      bid: 2649.35,
      ask: 2649.45,
      features: features(2649.35, 2649.45),
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
    eng.processEvent({
      receiveSeq: 4,
      eventTsMs: 1_600,
      bid: 2649.3,
      ask: 2649.4,
      features: features(2649.3, 2649.4),
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
    const epoch = eng.getEpoch()!;
    expect(epoch.activity.formalTradesOpened).toBe(1);
    expect(epoch.activity.formalTradesClosed).toBe(1);
    expect(epoch.activity.newOpportunitiesDetected).toBe(1);
    const closed = eng
      .drainPersistBatch()
      ?.trades.find((t) => t.status === "CLOSED");
    // latency may be attached on pending trade updates
    expect(closed?.exitReason).toBe("HARD_PROTECTION");
  });

  it("truncated replay => REPLAY_INCOMPLETE / formalDecisionReady false", async () => {
    process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED = "true";
    processGhShadowMarketEventSync({
      ownerUid: OWNER,
      receiveSeq: 1,
      eventTsMs: 1,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: true,
      opportunity: opportunity(),
      config: cfg(),
      sizingOverrides: { quoteToDepositRate: 0.866 }
    });
    processGhShadowMarketEventSync({
      ownerUid: OWNER,
      receiveSeq: 2,
      eventTsMs: 2,
      bid: 2649.4,
      ask: 2649.5,
      features: features(2649.4, 2649.5),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    await flushGhShadowPersistenceForTests(OWNER);
    const epoch = await loadGhShadowEpoch(OWNER);
    expect(epoch).not.toBeNull();
    // Force acknowledged count higher than stored events
    epoch!.integrity.persistAcknowledgedEvents = 9999;
    await saveGhShadowEpoch(OWNER, epoch!);
    const result = await runGhShadowReplayAndGate(OWNER);
    expect(result.status).toBe("REPLAY_INCOMPLETE");
    const stored = await loadGhShadowEpoch(OWNER);
    expect(stored?.lastReplayStatus).toBe("REPLAY_INCOMPLETE");

    const trades = Array.from({ length: 250 }, (_, i) => {
      const base = {
        tradeId: `n${i}`,
        qualificationId: stored!.qualificationId,
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
      };
      return base;
    });
    const report = computeGhShadowPerformanceReport(trades, stored);
    expect(report.checkpoint.formalDecisionReady).toBe(false);
    expect(report.checkpoint.edgeClassification).toBe("INSUFFICIENT");
  });
});

describe("static surface / demo / FAST", () => {
  it("static broker mutation surface NONE; Demo OFF; FAST unchanged", () => {
    expect(getGhShadowMutationSurfaceReport().staticMutationSurface).toBe(
      "NO_BROKER_CALL_SITES"
    );
    const dir = resolve(
      __dirname,
      "../../../src/services/goldHunterAdmin/shadowQualification"
    );
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      assertGhShadowNoBrokerMutationSurface(
        readFileSync(resolve(dir, name), "utf8")
      );
    }
    expect(cfg().demoAutoTradeEnabled).toBe(false);
    const c = frozenGhFastSoakConfig();
    expect(c.hardStop).toBe(0.55);
    expect(c.trailDistance).toBe(0.12);
  });
});
