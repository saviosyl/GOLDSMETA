/**
 * Research feature + A/B/C observation pipeline.
 * Uses book + features + evaluateSetupsDetailed only — no trading engine.
 *
 * Spot side semantics match GoldHunterFastEngine.onMarketEvent(SPOT):
 * ProtoOASpotEvent bid/ask are optional; maintain last-known sides and only
 * call FastFeatureEngine when both sides are known.
 */
import { InMemoryDepthBook, type DepthBookStats } from "../depthBook";
import {
  classifyResearchDepthValidity,
  isDerivedDataContaminated,
  type ResearchDepthValidity
} from "../depthRecovery";
import { FastFeatureEngine } from "../features";
import { evaluateSetupsDetailed } from "../setups";
import { frozenGhFastSoakConfig } from "../frozenConfig";
import type { GhFastDepthEvent, GhFastSpotEvent } from "../types";
import type {
  ResearchFeatureTelemetry,
  ResearchSpecialistObservation
} from "./researchTypes";
import { assertNoExecutionAdapterArgument } from "./nullExecutionGuard";

export type ResearchPipelineSnapshot = {
  features: ResearchFeatureTelemetry | null;
  specialists: ResearchSpecialistObservation[] | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  depthAvailable: boolean;
  crossed: boolean;
  bookGeneration: number;
  depthValidity: ResearchDepthValidity;
  derivedDataContaminated: boolean;
  depthStats: DepthBookStats;
  /** Last-known Spot sides after this event (engine-parity). */
  lastSpotBid: number | null;
  lastSpotAsk: number | null;
  /** Complete pair last fed into FastFeatureEngine (null until both sides known). */
  lastFeatureSpot: { bid: number; ask: number } | null;
};

export class ResearchFeaturePipeline {
  private readonly depth = new InMemoryDepthBook();
  private readonly features = new FastFeatureEngine();
  private readonly cfg = frozenGhFastSoakConfig();
  private lastBid: number | null = null;
  private lastAsk: number | null = null;
  private lastFeatureSpot: { bid: number; ask: number } | null = null;
  private spotBidOnlyEvents = 0;
  private spotAskOnlyEvents = 0;
  private spotTwoSidedEvents = 0;
  private recoveryInFlight = false;
  private depthFreshnessMs = 2000;

  constructor(opts?: {
    _executionAdapterMustBeUndefined?: unknown;
    depthFreshnessMs?: number;
  }) {
    assertNoExecutionAdapterArgument(opts?._executionAdapterMustBeUndefined);
    if (opts?.depthFreshnessMs != null && opts.depthFreshnessMs > 0) {
      this.depthFreshnessMs = opts.depthFreshnessMs;
    }
  }

  clearForResync(): void {
    this.depth.clearForResync();
    this.features.clear();
    // Match GoldHunterFastEngine.resetMarketDataForResync — drop stale sides.
    this.lastBid = null;
    this.lastAsk = null;
    this.lastFeatureSpot = null;
    this.recoveryInFlight = true;
  }

  /** Mark recovery complete once a fresh non-crossed two-sided book exists. */
  noteValidDepthRestored(): void {
    this.recoveryInFlight = false;
  }

  setRecoveryInFlight(v: boolean): void {
    this.recoveryInFlight = v;
  }

  isRecoveryInFlight(): boolean {
    return this.recoveryInFlight;
  }

  depthBook(): InMemoryDepthBook {
    return this.depth;
  }

  currentDepthStats(): DepthBookStats {
    return this.depth.stats(this.cfg.depthTopN);
  }

  spotPartialStats(): {
    spotBidOnlyEvents: number;
    spotAskOnlyEvents: number;
    spotTwoSidedEvents: number;
  } {
    return {
      spotBidOnlyEvents: this.spotBidOnlyEvents,
      spotAskOnlyEvents: this.spotAskOnlyEvents,
      spotTwoSidedEvents: this.spotTwoSidedEvents
    };
  }

  lastKnownSpot(): { bid: number | null; ask: number | null } {
    return { bid: this.lastBid, ask: this.lastAsk };
  }

  lastCompleteFeatureSpot(): { bid: number; ask: number } | null {
    return this.lastFeatureSpot;
  }

  onSpot(ev: GhFastSpotEvent): ResearchPipelineSnapshot {
    const hasBid = ev.bid != null && ev.bid > 0;
    const hasAsk = ev.ask != null && ev.ask > 0;
    if (hasBid && hasAsk) this.spotTwoSidedEvents += 1;
    else if (hasBid) this.spotBidOnlyEvents += 1;
    else if (hasAsk) this.spotAskOnlyEvents += 1;

    // Same last-known-side semantics as GoldHunterFastEngine.
    if (hasBid) this.lastBid = ev.bid!;
    if (hasAsk) this.lastAsk = ev.ask!;
    if (this.lastBid != null && this.lastAsk != null) {
      this.features.onSpot(ev.receivedAtMs, this.lastBid, this.lastAsk);
      this.lastFeatureSpot = { bid: this.lastBid, ask: this.lastAsk };
    }
    return this.snapshot(ev.receivedAtMs);
  }

  onDepth(ev: GhFastDepthEvent): ResearchPipelineSnapshot {
    this.depth.applyDepthEvent(ev);
    return this.snapshot(ev.receivedAtMs);
  }

  private snapshot(nowMs: number): ResearchPipelineSnapshot {
    const depthStats = this.depth.stats(this.cfg.depthTopN);
    if (depthStats.available && !depthStats.crossed && this.recoveryInFlight) {
      this.recoveryInFlight = false;
    }
    const depthAgeMs =
      depthStats.lastUpdateMs != null ? nowMs - depthStats.lastUpdateMs : null;
    const depthValidity = classifyResearchDepthValidity({
      stats: depthStats,
      recoveryInFlight: this.recoveryInFlight,
      depthAgeMs,
      depthFreshnessMs: this.depthFreshnessMs
    });
    const derivedDataContaminated = isDerivedDataContaminated(depthValidity);
    const feat = this.features.snapshot(nowMs, depthStats);
    const bestBid = depthStats.bestBid ?? this.lastBid;
    const bestAsk = depthStats.bestAsk ?? this.lastAsk;
    const spread =
      bestBid != null && bestAsk != null ? bestAsk - bestBid : null;

    if (!feat) {
      return {
        features: null,
        specialists: null,
        bestBid,
        bestAsk,
        spread,
        depthAvailable: depthStats.available,
        crossed: depthStats.crossed,
        bookGeneration: depthStats.bookGeneration,
        depthValidity,
        derivedDataContaminated,
        depthStats,
        lastSpotBid: this.lastBid,
        lastSpotAsk: this.lastAsk,
        lastFeatureSpot: this.lastFeatureSpot
      };
    }

    const evaluated = evaluateSetupsDetailed(feat, this.cfg);
    const specialists: ResearchSpecialistObservation[] =
      evaluated.specialists.map((s) => ({
        setup: s.setup,
        eligible: s.eligible,
        candidateSide: s.candidateSide,
        rawQuality: s.rawQuality,
        failedConditions: s.failedConditions,
        selectedCandidate: s.selected,
        depthValidity,
        derivedDataContaminated
      }));

    const features: ResearchFeatureTelemetry = {
      midVel250: feat.midVel250,
      midVel500: feat.midVel500,
      midVel1s: feat.midVel1s,
      midVel2s: feat.midVel2s,
      midVel3s: feat.midVel3s,
      acceleration: feat.acceleration,
      efficiency1s: feat.efficiency1s,
      efficiency3s: feat.efficiency3s,
      signedImbalance1s: feat.signedImbalance1s,
      depthImbalance: feat.depth.depthImbalance,
      weightedImbalance: feat.depth.weightedImbalance,
      liquidityAddedBid: feat.depth.liquidityAddedBid,
      liquidityAddedAsk: feat.depth.liquidityAddedAsk,
      liquidityRemovedBid: feat.depth.liquidityRemovedBid,
      liquidityRemovedAsk: feat.depth.liquidityRemovedAsk,
      addRateBid: feat.depth.addRateBid,
      addRateAsk: feat.depth.addRateAsk,
      removeRateBid: feat.depth.removeRateBid,
      removeRateAsk: feat.depth.removeRateAsk,
      updateRate1s: feat.updateRate1s,
      distHigh5s: feat.distHigh5s,
      distLow5s: feat.distLow5s,
      upTouches5s: feat.upTouches5s,
      downTouches5s: feat.downTouches5s,
      bid: feat.bid,
      ask: feat.ask,
      spread: feat.spread,
      mid: feat.mid
    };

    return {
      features,
      specialists,
      bestBid,
      bestAsk,
      spread,
      depthAvailable: depthStats.available,
      crossed: depthStats.crossed,
      bookGeneration: depthStats.bookGeneration,
      depthValidity,
      derivedDataContaminated,
      depthStats,
      lastSpotBid: this.lastBid,
      lastSpotAsk: this.lastAsk,
      lastFeatureSpot: this.lastFeatureSpot
    };
  }
}
