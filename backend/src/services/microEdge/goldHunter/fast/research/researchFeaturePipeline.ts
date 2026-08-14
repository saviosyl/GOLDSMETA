/**
 * Research feature + A/B/C observation pipeline.
 * Uses book + features + evaluateSetupsDetailed only — no trading engine.
 */
import { InMemoryDepthBook } from "../depthBook";
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
};

export class ResearchFeaturePipeline {
  private readonly depth = new InMemoryDepthBook();
  private readonly features = new FastFeatureEngine();
  private readonly cfg = frozenGhFastSoakConfig();
  private lastBid: number | null = null;
  private lastAsk: number | null = null;

  constructor(opts?: { _executionAdapterMustBeUndefined?: unknown }) {
    assertNoExecutionAdapterArgument(opts?._executionAdapterMustBeUndefined);
  }

  clearForResync(): void {
    this.depth.clearForResync();
    this.features.clear();
  }

  onSpot(ev: GhFastSpotEvent): ResearchPipelineSnapshot {
    if (ev.bid != null && ev.ask != null && ev.bid > 0 && ev.ask > 0) {
      this.features.onSpot(ev.receivedAtMs, ev.bid, ev.ask);
      this.lastBid = ev.bid;
      this.lastAsk = ev.ask;
    }
    return this.snapshot(ev.receivedAtMs);
  }

  onDepth(ev: GhFastDepthEvent): ResearchPipelineSnapshot {
    this.depth.applyDepthEvent(ev);
    return this.snapshot(ev.receivedAtMs);
  }

  private snapshot(nowMs: number): ResearchPipelineSnapshot {
    const depthStats = this.depth.stats(this.cfg.depthTopN);
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
        bookGeneration: depthStats.bookGeneration
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
        selectedCandidate: s.selected
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
      bookGeneration: depthStats.bookGeneration
    };
  }
}
