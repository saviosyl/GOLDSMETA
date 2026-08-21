/**
 * Gold Hunter feature + A/B/C observation pipeline (production).
 * Selective adaptation of research ResearchFeaturePipeline from PR #126.
 * No trading engine. No Fast AutoTrade. Thresholds unchanged via frozen config.
 */
import { InMemoryDepthBook, type DepthBookStats } from "./depthBook";
import {
  classifyResearchDepthValidity,
  isDerivedDataContaminated,
  type ResearchDepthValidity
} from "./depthRecovery";
import { FastFeatureEngine } from "./features";
import { evaluateSetupsDetailed, type SetupHit } from "./setups";
import { frozenGhFastSoakConfig } from "./frozenConfig";
import type { GhFastDepthEvent, GhFastSpotEvent, GhFastSpecialistRawEval } from "./types";
import {
  M1CandleFlowEngine,
  type M1CandleFlowEvaluation
} from "./m1CandleFlow";

export type GoldHunterPipelineSnapshot = {
  features: ReturnType<FastFeatureEngine["snapshot"]>;
  specialists: GhFastSpecialistRawEval[] | null;
  selected: SetupHit | null;
  m1CandleFlow: M1CandleFlowEvaluation | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  depthAvailable: boolean;
  crossed: boolean;
  bookGeneration: number;
  depthValidity: ResearchDepthValidity;
  derivedDataContaminated: boolean;
  depthStats: DepthBookStats;
  lastSpotBid: number | null;
  lastSpotAsk: number | null;
  lastFeatureSpot: { bid: number; ask: number } | null;
};

export class GoldHunterFeaturePipeline {
  private readonly depth = new InMemoryDepthBook();
  private readonly features = new FastFeatureEngine();
  private readonly m1CandleFlow = new M1CandleFlowEngine();
  private readonly cfg = frozenGhFastSoakConfig();
  private lastBid: number | null = null;
  private lastAsk: number | null = null;
  private lastFeatureSpot: { bid: number; ask: number } | null = null;
  private recoveryInFlight = false;
  private depthFreshnessMs = 2000;

  constructor(opts?: { depthFreshnessMs?: number }) {
    if (opts?.depthFreshnessMs != null && opts.depthFreshnessMs > 0) {
      this.depthFreshnessMs = opts.depthFreshnessMs;
    }
  }

  clearForResync(): void {
    this.depth.clearForResync();
    this.features.clear();
    this.m1CandleFlow.clear();
    this.lastBid = null;
    this.lastAsk = null;
    this.lastFeatureSpot = null;
    this.recoveryInFlight = true;
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

  config() {
    return this.cfg;
  }

  lastKnownSpot(): { bid: number | null; ask: number | null } {
    return { bid: this.lastBid, ask: this.lastAsk };
  }

  onSpot(ev: GhFastSpotEvent): GoldHunterPipelineSnapshot {
    const hasBid = ev.bid != null && ev.bid > 0;
    const hasAsk = ev.ask != null && ev.ask > 0;
    if (hasBid) this.lastBid = ev.bid!;
    if (hasAsk) this.lastAsk = ev.ask!;
    if (this.lastBid != null && this.lastAsk != null) {
      this.features.onSpot(ev.receivedAtMs, this.lastBid, this.lastAsk);
      this.m1CandleFlow.onSpot(ev.receivedAtMs, (this.lastBid + this.lastAsk) / 2);
      this.lastFeatureSpot = { bid: this.lastBid, ask: this.lastAsk };
    }
    return this.snapshot(ev.receivedAtMs);
  }

  onDepth(ev: GhFastDepthEvent): GoldHunterPipelineSnapshot {
    this.depth.applyDepthEvent(ev);
    return this.snapshot(ev.receivedAtMs);
  }

  /** Build a typed spot event for callers that only have prices. */
  static spotEvent(args: {
    receiveSeq: number;
    receivedAtMs: number;
    bid: number | null;
    ask: number | null;
    symbolId?: string | number;
    brokerTimestampMs?: number | null;
  }): GhFastSpotEvent {
    return {
      kind: "SPOT",
      receiveSeq: args.receiveSeq,
      eventId: `spot-${args.receiveSeq}`,
      receivedAtMs: args.receivedAtMs,
      brokerTimestampMs: args.brokerTimestampMs ?? null,
      bid: args.bid,
      ask: args.ask,
      symbolId: args.symbolId
    };
  }

  private snapshot(nowMs: number): GoldHunterPipelineSnapshot {
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
        selected: null,
        m1CandleFlow: null,
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

    const m1CandleFlow = this.m1CandleFlow.evaluate(nowMs, feat, this.cfg);
    const evaluated = evaluateSetupsDetailed(feat, this.cfg, { m1CandleFlow });
    return {
      features: feat,
      specialists: evaluated.specialists,
      selected: evaluated.selected,
      m1CandleFlow,
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
