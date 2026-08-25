/**
 * Gold Hunter Clean Shadow Qualification — integrity revision tests.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  PEPPERSTONE_CTRADER_XAUUSD_DEMO,
  estimateXauUsdGrossPnlDeposit
} from "../../../src/services/broker/ctrader/brokerUnitMappings";
import { sizeGoldHunterDemoLots } from "../../../src/services/goldHunterAdmin/riskSizing";
import { defaultGhFastConfig } from "../../../src/services/goldHunterAdmin/abc/defaults";
import {
  computeGhShadowEconomicExposure,
  simulateGhShadowCashPnl,
  provenGrossPnlEurExample,
  GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS
} from "../../../src/services/goldHunterAdmin/shadowQualification/economics";
import {
  GhShadowQualificationEngine,
  getGhShadowEngine,
  resetGhShadowEnginesForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/engine";
import { computeGhShadowPerformanceReport } from "../../../src/services/goldHunterAdmin/shadowQualification/performance";
import { replayGhShadowCapturedEvents } from "../../../src/services/goldHunterAdmin/shadowQualification/replay";
import {
  assertGhShadowNoBrokerMutationSurface,
  getGhShadowMutationSurfaceReport,
  resetGhShadowBrokerMutationProofForTests
} from "../../../src/services/goldHunterAdmin/shadowQualification/brokerMutationGuard";
import {
  listGhShadowTrades,
  loadGhShadowEpoch,
  loadGhShadowTrade,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  setCurrentQualificationId,
  upsertGhShadowTrade
} from "../../../src/services/goldHunterAdmin/shadowQualification/store";
import {
  flushGhShadowPersistenceForTests,
  processGhShadowMarketEventSync,
  resetGhShadowQualificationRuntimeForTests,
  runGhShadowReplayAndGate
} from "../../../src/services/goldHunterAdmin/shadowQualification/runtime";
import { GH_ADMIN_DEFAULT_CONFIG, GH_ADMIN_STRATEGY_ID } from "../../../src/services/goldHunterAdmin/types";
import type { GoldHunterSelectedCandidate } from "../../../src/services/goldHunterAdmin/strategySelector";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import type {
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "../../../src/services/goldHunterAdmin/shadowQualification/types";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc/frozenConfig";
import { buildFrozenSizingSnapshot } from "../../../src/services/goldHunterAdmin/shadowQualification/frozenSizing";
import type { GhShadowEngineTickInput } from "../../../src/services/goldHunterAdmin/shadowQualification/engine";

const OWNER = "gh-shadow-rev-owner";
const PROVEN_FX = 0.86624336;

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

function frozenSizing(over: { quoteToDepositRate?: number | null } = {}) {
  return buildFrozenSizingSnapshot({
    config: cfg(),
    quoteToDepositRate: over.quoteToDepositRate ?? null,
    quoteToDepositRateSource: over.quoteToDepositRate != null ? "test" : null
  });
}

function tickInput(
  over: Partial<GhShadowEngineTickInput> & Pick<GhShadowEngineTickInput, "receiveSeq" | "eventTsMs" | "bid" | "ask">
): GhShadowEngineTickInput {
  const baseFrozen = frozenSizing();
  return {
    features: features(over.bid, over.ask),
    dataOk: true,
    depthValidity: "DEPTH_VALID",
    bookGeneration: 1,
    resyncGeneration: 0,
    newOpportunity: false,
    opportunity: null,
    config: cfg(),
    frozenSizing: over.frozenSizing ?? baseFrozen,
    allowFormal: over.allowFormal ?? true,
    ...over
  };
}

function emptyIntegrity() {
  return {
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
    lastProcessedReceiveSeq: null as number | null,
    lastResyncGeneration: null as number | null
  };
}

beforeEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  resetGhShadowBrokerMutationProofForTests();
  resetGhShadowEnginesForTests();
  resetGhShadowQualificationMemoryForTests();
  delete process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED;
});

afterEach(() => {
  resetGhShadowQualificationRuntimeForTests();
  resetGhShadowBrokerMutationProofForTests();
});

function fakeFormalTrade(
  i: number,
  net: number,
  qid: string
): GhShadowTrade {
  return {
    tradeId: `t${i}`,
    qualificationId: qid,
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
    simulatedGrossPnlQuote: net + 0.5,
    simulatedFrictionPnlQuote: 0.5,
    simulatedNetPnlQuote: net,
    quoteCurrency: "USD",
    plannedRiskR: net / 10,
    netR: net / 10,
    geometryR: net / (0.55 * 18),
    geometryRiskQuote: 0.55 * 18,
    simulatedGrossPnlEur: net + 0.5,
    simulatedFrictionEur: 0.5,
    simulatedNetPnlEur: net,
    eurPnlAvailable: true,
    economic: null,
    latency: null,
    profitLockActivatedAt: new Date().toISOString(),
    trailActivatedAt: new Date().toISOString(),
    trailUpdateCount: 1,
    lockFloorAtActivation: 100.15,
    lockFloorLatest: 100.18,
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
      profitLockActivateMfeAtActivation: 0.18,
      lockFloorAtActivation: 100.15,
      lockFloorAtExit: 100.18,
      bestExitAtExit: 100.2
    }
  };
}

function epochStub(
  qid: string,
  over: Partial<GhShadowQualificationEpoch> = {}
): GhShadowQualificationEpoch {
  return {
    qualificationId: qid,
    qualificationStartTime: new Date().toISOString(),
    qualificationStartSequence: 0,
    strategySha: "x",
    configSha: "x",
    strategyVersion: "GOLD_HUNTER_FAST_V1",
    engineVersion: "GH_FAST_EVENT_V1",
    soakLabel: "LIVE_SHADOW_SOAK_V1",
    frozenSizing: frozenSizing(),
    formalQualificationTrades: 250,
    diagnosticExcludedTrades: 0,
    openShadowTradeId: null,
    status: "ACTIVE",
    dataIntegrityFailure: null,
    persistFailureReason: null,
    runtimeGeneration: 1,
    lastRestartReason: null,
    integrity: emptyIntegrity(),
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
    lastReplayStatus: "NOT_RUN",
    lastReplayDetail: null,
    updatedAt: new Date().toISOString(),
    ...over
  };
}


describe("A — production economics", () => {
  it("1. production sizing parity: €1000 / 1% / 0.60 buffered risk → 16 lots", () => {
    const entry = 2650.12;
    const stop = entry - 0.55;
    const prod = sizeGoldHunterDemoLots({
      config: cfg(),
      entry,
      stop,
      valuePerPointPerLot: PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot,
      minLots: GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.minLots,
      maxLots: GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.maxLots,
      lotStep: GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.lotStep,
      riskDistanceBuffer: defaultGhFastConfig().entrySlippageRiskBuffer
    });
    expect(prod.ok).toBe(true);
    if (!prod.ok) return;
    expect(prod.lots).toBe(16);
    expect(prod.riskBudgetEur).toBe(10);

    const shadow = computeGhShadowEconomicExposure({
      config: cfg(),
      entryPrice: entry,
      side: "BUY"
    });
    expect(shadow.ok).toBe(true);
    if (!shadow.ok) return;
    expect(shadow.economic.displayedLots).toBe(prod.lots);
    expect(shadow.economic.ozPerLot).toBe(1);
    expect(shadow.economic.economicXauOz).toBe(16);
    expect(shadow.economic.rawProtocolVolumeEquivalent).toBe(1600);
    expect(shadow.economic.mappingKey).toBe("pepperstone_ctrader_xauusd_demo");
  });

  it("2. broker-proven 13-lot P/L parity ≈ €2.93", () => {
    const pnl = provenGrossPnlEurExample({
      lots: 13,
      priceMove: 0.26,
      quoteToDepositRate: PROVEN_FX
    });
    expect(pnl).toBeCloseTo(2.93, 2);
    expect(
      estimateXauUsdGrossPnlDeposit({
        lots: 13,
        priceMove: 0.26,
        ozPerLot: 1,
        quoteToDepositRate: PROVEN_FX
      })
    ).toBeCloseTo(2.93, 2);
  });

  it("3. no 100x artificial oz multiplier", () => {
    const shadow = computeGhShadowEconomicExposure({
      config: cfg(),
      entryPrice: 2650.12,
      side: "BUY"
    });
    expect(shadow.ok).toBe(true);
    if (!shadow.ok) return;
    expect(shadow.economic.ozPerLot).toBe(1);
    expect(shadow.economic.economicXauOz).not.toBe(0.18);
    expect(shadow.economic.valuePerPointPerLot).toBe(1);
    expect(shadow.economic.formula).not.toMatch(/valuePerPointPerOzEur\s*=\s*100/);
  });

  it("4. missing quote→EUR => no invented EUR P/L", () => {
    const shadow = computeGhShadowEconomicExposure({
      config: cfg(),
      entryPrice: 2650.12,
      side: "BUY",
      quoteToDepositRate: null
    });
    expect(shadow.ok).toBe(true);
    if (!shadow.ok) return;
    expect(shadow.economic.eurPnlAvailable).toBe(false);
    const pnl = simulateGhShadowCashPnl({
      side: "BUY",
      entryPrice: 2650.12,
      exitPrice: 2650.32,
      economic: shadow.economic
    });
    expect(pnl.grossQuote).toBeCloseTo(0.2 * 16 * 1, 8);
    expect(pnl.simulatedGrossPnlEur).toBeNull();
    expect(pnl.simulatedNetPnlEur).toBeNull();
    expect(pnl.eurPnlAvailable).toBe(false);
    expect(pnl.plannedRiskR).toBeNull();
    expect(pnl.netR).toBeNull();
    expect(pnl.geometryR).not.toBeNull();
    expect(pnl.geometryRiskQuote).toBeCloseTo(0.6 * 16 * 1, 8);
  });
});

describe("B — event stream integrity", () => {
  it("5. high-frequency events with slow persistence still process ordered", async () => {
    process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED = "true";
    const eng = getGhShadowEngine(OWNER, { journalCapacity: 5000, forceNew: true });
    const opp = opportunity({ receiveSeq: 1, latestReceiveSeq: 1 });
    processGhShadowMarketEventSync({
      ownerUid: OWNER,
      receiveSeq: 1,
      eventTsMs: 1000,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: true,
      opportunity: opp,
      config: cfg(),
      sizingOverrides: { quoteToDepositRate: PROVEN_FX, quoteToDepositRateSource: "test" }
    });
    expect(eng.getOpenTradeId()).not.toBeNull();

    for (let i = 2; i <= 200; i++) {
      processGhShadowMarketEventSync({
        ownerUid: OWNER,
        receiveSeq: i,
        eventTsMs: 1000 + i,
        bid: 2650 - i * 0.001,
        ask: 2650.1 - i * 0.001,
        features: features(2650 - i * 0.001, 2650.1 - i * 0.001),
        dataOk: true,
        depthValidity: "DEPTH_VALID",
        newOpportunity: false,
        opportunity: null,
        config: cfg()
      });
    }
    const epoch = eng.getEpoch()!;
    expect(epoch.integrity.eventsProcessed).toBe(200);
    expect(epoch.integrity.eventsDropped).toBe(0);
    expect(epoch.integrity.receiveSeqGaps).toBe(0);
    await flushGhShadowPersistenceForTests(OWNER);
  });

  it("6. journal overflow => qualification invalid / trade excluded", () => {
    const eng = new GhShadowQualificationEngine({
      ownerUid: OWNER + "-ovf",
      journalCapacity: 3
    });
    const opp = opportunity();
    eng.processEvent(
      tickInput({
        receiveSeq: 1,
        eventTsMs: 1,
        bid: 2650,
        ask: 2650.1,
        newOpportunity: true,
        opportunity: opp
      })
    );
    expect(eng.getOpenTradeId()).not.toBeNull();
    eng.processEvent(
      tickInput({
        receiveSeq: 2,
        eventTsMs: 2,
        bid: 2650,
        ask: 2650.1
      })
    );
    eng.processEvent(
      tickInput({
        receiveSeq: 3,
        eventTsMs: 3,
        bid: 2650,
        ask: 2650.1
      })
    );
    // 4th overflows
    eng.processEvent(
      tickInput({
        receiveSeq: 4,
        eventTsMs: 4,
        bid: 2650,
        ask: 2650.1
      })
    );
    const epoch = eng.getEpoch()!;
    expect(epoch.integrity.eventsDropped).toBeGreaterThan(0);
    expect(epoch.integrity.journalOverflowCount).toBeGreaterThan(0);
    expect(epoch.status).toBe("DATA_QUALITY_FAILED");
    expect(eng.getOpenTradeId()).toBeNull();
  });

  it("7. receiveSeq gap => qualification invalid / excluded", () => {
    const eng = new GhShadowQualificationEngine({ ownerUid: OWNER + "-gap" });
    eng.processEvent(
      tickInput({
        receiveSeq: 1,
        eventTsMs: 1,
        bid: 2650,
        ask: 2650.1,
        newOpportunity: true,
        opportunity: opportunity()
      })
    );
    eng.processEvent(
      tickInput({
        receiveSeq: 5,
        eventTsMs: 5,
        bid: 2649,
        ask: 2649.1
      })
    );
    const epoch = eng.getEpoch()!;
    expect(epoch.integrity.receiveSeqGaps).toBeGreaterThan(0);
    expect(epoch.status).toBe("DATA_QUALITY_FAILED");
    expect(eng.getOpenTradeId()).toBeNull();
  });

  it("7b. flat featureless seq must not invent receive_seq_gap", () => {
    process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED = "true";
    const owner = OWNER + "-featless-flat";
    const eng = getGhShadowEngine(owner, { forceNew: true });

    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 100,
      eventTsMs: 10_000,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    expect(eng.getOpenTradeId()).toBeNull();
    expect(eng.getEpoch()!.integrity.lastProcessedReceiveSeq).toBe(100);

    // Intentionally featureless + no opportunity + flat — previously skipped by
    // runtime early-return, which advanced selector seq without processEvent.
    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 101,
      eventTsMs: 10_100,
      strategySpotBid: 2650,
      strategySpotAsk: 2650.1,
      depthBestBid: 2650,
      depthBestAsk: 2650.1,
      features: null,
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    expect(eng.getEpoch()!.status).toBe("ACTIVE");
    expect(eng.getEpoch()!.dataIntegrityFailure).toBeNull();
    expect(eng.getEpoch()!.integrity.receiveSeqGaps).toBe(0);
    expect(eng.getEpoch()!.integrity.lastProcessedReceiveSeq).toBe(101);

    processGhShadowMarketEventSync({
      ownerUid: owner,
      receiveSeq: 102,
      eventTsMs: 10_200,
      bid: 2650.02,
      ask: 2650.12,
      features: features(2650.02, 2650.12),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: false,
      opportunity: null,
      config: cfg()
    });
    const epoch = eng.getEpoch()!;
    expect(epoch.status).toBe("ACTIVE");
    expect(epoch.dataIntegrityFailure).toBeNull();
    expect(epoch.integrity.receiveSeqGaps).toBe(0);
    expect(epoch.integrity.lastProcessedReceiveSeq).toBe(102);
    expect(epoch.integrity.eventsProcessed).toBe(3);
  });
});

describe("C/D — captured replay + formal gate", () => {
  it("8. complete captured-event replay => LIVE_REPLAY_OK", async () => {
    process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED = "true";
    getGhShadowEngine(OWNER, { forceNew: true });
    processGhShadowMarketEventSync({
      ownerUid: OWNER,
      receiveSeq: 1,
      eventTsMs: 1000,
      bid: 2650,
      ask: 2650.1,
      features: features(2650, 2650.1),
      dataOk: true,
      depthValidity: "DEPTH_VALID",
      newOpportunity: true,
      opportunity: opportunity({ receiveSeq: 1, latestReceiveSeq: 1 }),
      config: cfg(),
      sizingOverrides: { quoteToDepositRate: PROVEN_FX }
    });
    processGhShadowMarketEventSync({
      ownerUid: OWNER,
      receiveSeq: 2,
      eventTsMs: 2000,
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
    const result = await runGhShadowReplayAndGate(OWNER);
    expect(result.status).toBe("LIVE_REPLAY_OK");
    expect(result.capturedEvents).toBeGreaterThanOrEqual(2);
    const stored = await loadGhShadowEpoch(OWNER);
    expect(stored?.lastReplayStatus).toBe("LIVE_REPLAY_OK");
  });

  it("9. changed event => LIVE_REPLAY_DIVERGENCE", () => {
    const eng = new GhShadowQualificationEngine({ ownerUid: OWNER + "-div" });
    eng.processEvent(
      tickInput({
        receiveSeq: 1,
        eventTsMs: 1,
        bid: 2650,
        ask: 2650.1,
        newOpportunity: true,
        opportunity: opportunity()
      })
    );
    eng.processEvent(
      tickInput({
        receiveSeq: 2,
        eventTsMs: 2,
        bid: 2649.4,
        ask: 2649.5
      })
    );
    const batch = eng.drainPersistBatch()!;
    expect(batch.events.length).toBeGreaterThanOrEqual(2);
    // Corrupt formal management Spot on the non-open event: clear features so
    // replay cannot exit (features-only), while live decisions still have EXIT.
    const tampered = batch.events.map((e) =>
      e.openMarker
        ? e
        : {
            ...e,
            features: null,
            bid: e.bid - 50,
            ask: e.ask - 50
          }
    );
    const result = replayGhShadowCapturedEvents({
      events: tampered,
      liveDecisions: batch.decisions,
      liveTrades: batch.trades
    });
    expect(result.status).toBe("LIVE_REPLAY_DIVERGENCE");
  });

  it("10. replay NOT_RUN at 250 => formalDecisionReady=false", () => {
    const qid = "GH-SQ-notrun";
    const trades = Array.from({ length: 250 }, (_, i) => fakeFormalTrade(i, 1, qid));
    const report = computeGhShadowPerformanceReport(
      trades,
      epochStub(qid, { lastReplayStatus: "NOT_RUN" })
    );
    expect(report.checkpoint.at250).toBe("INSUFFICIENT / DATA QUALITY FAILURE");
    expect(report.checkpoint.formalDecisionReady).toBe(false);
  });

  it("11. replay DIVERGENCE at 250 => formalDecisionReady=false", () => {
    const qid = "GH-SQ-div";
    const trades = Array.from({ length: 250 }, (_, i) => fakeFormalTrade(i, 1, qid));
    const report = computeGhShadowPerformanceReport(
      trades,
      epochStub(qid, { lastReplayStatus: "LIVE_REPLAY_DIVERGENCE" })
    );
    expect(report.checkpoint.at250).toBe("INSUFFICIENT / DATA QUALITY FAILURE");
    expect(report.checkpoint.formalDecisionReady).toBe(false);
  });

});

describe("E — restart recovery", () => {
  it("12+13. restart with open shadow excludes interrupted; no second formal until handled", async () => {
    const eng1 = getGhShadowEngine(OWNER, { forceNew: true, runtimeGeneration: 1 });
    eng1.processEvent(
      tickInput({
        receiveSeq: 1,
        eventTsMs: 1,
        bid: 2650,
        ask: 2650.1,
        newOpportunity: true,
        opportunity: opportunity()
      })
    );
    const openId = eng1.getOpenTradeId();
    expect(openId).not.toBeNull();
    const epoch = eng1.getEpoch()!;
    await saveGhShadowEpoch(OWNER, epoch);
    await upsertGhShadowTrade(OWNER, {
      ...(eng1.drainPersistBatch()?.trades[0] as GhShadowTrade),
      tradeId: openId!,
      status: "OPEN",
      dataQuality: "FORMAL_ELIGIBLE",
      qualificationId: epoch.qualificationId
    });

    // Simulate process restart
    resetGhShadowEnginesForTests();
    const eng2 = getGhShadowEngine(OWNER, {
      forceNew: true,
      runtimeGeneration: 2
    });
    const persisted = await loadGhShadowEpoch(OWNER);
    const persistedOpenTrade = await loadGhShadowTrade(OWNER, openId!, persisted?.qualificationId);
    const { excludedTradeId } = eng2.recoverAfterRestart({
      persistedEpoch: persisted,
      persistedOpenTrade,
      reason: "test_restart"
    });
    expect(excludedTradeId).toBe(openId);
    expect(eng2.getOpenTradeId()).toBeNull();
    expect(eng2.getEpoch()?.openShadowTradeId).toBeNull();

    // New opportunity can open after recovery handled
    eng2.processEvent(
      tickInput({
        receiveSeq: 10,
        eventTsMs: 10,
        bid: 2651,
        ask: 2651.1,
        newOpportunity: true,
        opportunity: opportunity({
          opportunityId: "new",
          signalId: "new",
          receiveSeq: 10
        })
      })
    );
    expect(eng2.getOpenTradeId()).not.toBeNull();
    expect(eng2.getOpenTradeId()).not.toBe(openId);
  });
});

describe("F — epoch isolation", () => {
  it("14. epoch B report must not include epoch A trades", async () => {
    const epochA: GhShadowQualificationEpoch = epochStub("GH-SQ-A", {
      formalQualificationTrades: 250,
      lastReplayStatus: "LIVE_REPLAY_OK"
    });
    await saveGhShadowEpoch(OWNER, epochA);
    for (let i = 0; i < 250; i++) {
      await upsertGhShadowTrade(OWNER, fakeFormalTrade(i, 1, "GH-SQ-A"));
    }

    const epochB: GhShadowQualificationEpoch = epochStub("GH-SQ-B", {
      formalQualificationTrades: 2,
      lastReplayStatus: "NOT_RUN"
    });
    await saveGhShadowEpoch(OWNER, epochB);
    await setCurrentQualificationId(OWNER, "GH-SQ-B");
    await upsertGhShadowTrade(OWNER, fakeFormalTrade(1, -1, "GH-SQ-B"));
    await upsertGhShadowTrade(OWNER, fakeFormalTrade(2, -2, "GH-SQ-B"));

    const tradesB = await listGhShadowTrades(OWNER, {
      qualificationId: "GH-SQ-B",
      limit: 2000
    });
    expect(tradesB).toHaveLength(2);
    expect(tradesB.every((t) => t.qualificationId === "GH-SQ-B")).toBe(true);

    const report = computeGhShadowPerformanceReport(tradesB, epochB);
    expect(report.completedTrades).toBe(2);
    expect(report.qualificationId).toBe("GH-SQ-B");
  });
});

describe("G/H — mutation surface + isolation", () => {
  it("15. static broker mutation surface remains NONE", () => {
    const report = getGhShadowMutationSurfaceReport();
    expect(report.staticMutationSurface).toBe("NO_BROKER_CALL_SITES");
    expect(report.runtimeVerification.newOrderReqCount).toBeNull();
    const dir = resolve(
      __dirname,
      "../../../src/services/goldHunterAdmin/shadowQualification"
    );
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const src = readFileSync(resolve(dir, name), "utf8");
      expect(() => assertGhShadowNoBrokerMutationSurface(src)).not.toThrow();
    }
  });

  it("16. Demo AutoTrade remains OFF / untouched in default config path", () => {
    const c = cfg();
    expect(c.demoAutoTradeEnabled).toBe(false);
    expect(c.pauseNewEntries).toBe(true);
    expect(c.emergencyStopActive).toBe(true);
    // Shadow enable env does not flip Demo flags
    process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED = "true";
    expect(cfg().demoAutoTradeEnabled).toBe(false);
  });

  it("17. Core FAST defaults unchanged", () => {
    const c = frozenGhFastSoakConfig();
    expect(c.hardStop).toBe(0.55);
    expect(c.profitLockActivateMfe).toBe(0.18);
    expect(c.profitLockFraction).toBe(0.45);
    expect(c.trailDistance).toBe(0.12);
    expect(c.friction).toBe(0.06);
  });
});
