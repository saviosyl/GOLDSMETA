/**
 * Gold Hunter feature + A/B/C observation pipeline (production).
 * Selective adaptation of research ResearchFeaturePipeline from PR #126.
 * No Fast AutoTrade. Revision 03 keeps Setup B continuation diagnostic-only.
 */
import { InMemoryDepthBook, type DepthBookStats } from "./depthBook";
import {
  classifyResearchDepthValidity,
  isDerivedDataContaminated,
  type ResearchDepthValidity
} from "./depthRecovery";
import { FastFeatureEngine, type GhFastFeatureSnapshot } from "./features";
import {
  evaluateSetupsDetailed,
  scoreFastBreakout,
  type SetupHit
} from "./setups";
import { frozenGhFastSoakConfig } from "./frozenConfig";
import type {
  GhFastConfig,
  GhFastDepthEvent,
  GhFastSpotEvent,
  GhFastSpecialistRawEval
} from "./types";
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

const CONTINUATION_BLOCKED_WAITS = new Set<string>([
  "WAIT_CHOP",
  "WAIT_PULSE_INVALIDATED",
  "WAIT_PULSE_EXHAUSTED",
  "WAIT_NO_EDGE_LEFT"
]);

/**
 * V6 revision 02 continuation candidate retained for diagnostics/shadow research.
 *
 * The primary Pulse Guard / Setup A path remains unchanged. When A is waiting
 * for a textbook pullback/base/break sequence, a strong prior-only Setup B
 * breakout can still be identified for counterfactual analysis. Revision 03 does
 * not promote this candidate to execution; only Setup A / Pulse Guard may trade.
 */
export function selectV6TrendContinuationFallback(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig,
  flow: M1CandleFlowEvaluation
): SetupHit | null {
  if (flow.waitReason && CONTINUATION_BLOCKED_WAITS.has(flow.waitReason)) {
    return null;
  }

  const breakout = scoreFastBreakout(f, cfg);
  if (!breakout) return null;

  const ageSec = flow.currentCandleAgeSec;
  if (ageSec == null || ageSec < 5 || ageSec > 55) return null;

  const displacement = flow.currentM1Displacement;
  if (displacement == null || !Number.isFinite(displacement)) return null;
  const m1Aligned =
    breakout.side === "BUY" ? displacement > 0 : displacement < 0;
  if (!m1Aligned) return null;

  if (flow.regime === "RANGE") return null;
  const regimeAligned =
    (breakout.side === "BUY" && flow.regime === "TREND_UP") ||
    (breakout.side === "SELL" && flow.regime === "TREND_DOWN");
  const transitionAllowed = flow.regime === "TRANSITION";
  if (!regimeAligned && !transitionAllowed) return null;

  // Setup B already earns >= cfg.minSetupQualityB. Transition entries require
  // a materially stronger breakout because the M1 regime has not fully locked.
  const qualityFloor = regimeAligned
    ? Math.max(cfg.minSetupQualityB, 0.7)
    : Math.max(cfg.minSetupQualityB, 0.8);
  if (breakout.quality < qualityFloor) return null;

  // Do not promote a breakout if the immediate price path is inefficient.
  const efficiencyFloor = regimeAligned ? 0.45 : 0.55;
  if (f.efficiency1s < efficiencyFloor) return null;

  // Require the forming candle to have moved enough to be meaningful relative
  // to spread/friction/noise; this avoids turning micro-jitter into entries.
  const noiseFloor = Math.max(
    flow.recentNoise ?? 0,
    Math.max(0, f.spread) * 2,
    cfg.friction
  );
  if (Math.abs(displacement) < Math.max(noiseFloor * 0.5, 0.04)) {
    return null;
  }

  return {
    ...breakout,
    reasons: [
      "v6_trend_continuation_fallback",
      regimeAligned ? "m1_regime_aligned" : "strong_transition_breakout",
      "forming_m1_aligned",
      ...breakout.reasons
    ],
    m1CandleFlow: flow
  };
}

/**
 * Revision 03 executable policy. The continuation candidate is intentionally
 * accepted only for diagnostics so future research cannot accidentally widen
 * the live selector by changing a null-coalescing expression.
 */
export function selectV6R03ExecutableSetup(
  primary: SetupHit | null,
  _continuationDiagnostic: SetupHit | null
): SetupHit | null {
  return primary?.setup === "A_MOMENTUM_IGNITION" ? primary : null;
}

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
    const continuationFallback = evaluated.selected
      ? null
      : selectV6TrendContinuationFallback(feat, this.cfg, m1CandleFlow);
    // Revision 03 reliability gate: Setup B remains visible in diagnostics but
    // cannot become the executable selector candidate until separately qualified.
    const selected = selectV6R03ExecutableSetup(
      evaluated.selected,
      continuationFallback
    );
    const specialists = evaluated.specialists.map((specialist) => {
      const executionSelected = selected?.setup === specialist.setup;
      const diagnosticOnly = specialist.setup !== "A_MOMENTUM_IGNITION";
      const continuationDiagnostic =
        continuationFallback?.setup === specialist.setup;
      return {
        ...specialist,
        selected: executionSelected,
        reasons:
          diagnosticOnly && (specialist.eligible || continuationDiagnostic)
            ? [
                ...specialist.reasons,
                continuationDiagnostic
                  ? "v6_r03_continuation_shadow_only"
                  : "v6_r03_non_a_shadow_only"
              ]
            : specialist.reasons
      };
    });

    return {
      features: feat,
      specialists,
      selected,
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
