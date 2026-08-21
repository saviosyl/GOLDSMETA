/**
 * Three FAST specialists — interpretable setup-quality scores.
 * Phase 0B: always expose raw A/B/C eligibility separately from best-of selection.
 *
 * Brain V3: Setup A 1s direction consistency + post-loss anti-churn.
 * Setup B remains Brain V2 (prior-only breakout). Setup C unchanged from V1.
 */
import type {
  GhFastConfig,
  GhFastSetupId,
  GhFastSide,
  GhFastSpecialistRawEval
} from "./types";
import type { GhFastFeatureSnapshot } from "./features";
import { GOLD_HUNTER_BRAIN_VERSION } from "./versions";
import type { M1CandleFlowEvaluation } from "./m1CandleFlow";

/** Brain V2 breakout / selection diagnostics (additive; never invents fills). */
export type GhBreakoutDiagnostics = {
  brainVersion: typeof GOLD_HUNTER_BRAIN_VERSION;
  breakoutReference: number;
  breakoutDistance: number;
  requiredBreakoutDistance: number;
  spread: number;
  midVel250: number;
  midVel500: number;
  midVel1s: number;
  acceleration: number;
  efficiency1s: number;
  signedImbalance1s: number;
  depthImbalance: number;
  removeRateAsk: number;
  removeRateBid: number;
  rejectionReasons: string[];
};

export type SetupHit = {
  setup: GhFastSetupId;
  side: GhFastSide;
  quality: number;
  reasons: string[];
  /** Present on B hits (Brain V2); optional for A/C. */
  diagnostics?: GhBreakoutDiagnostics;
  /** Present on Setup A when using V4 M1 Candle Flow. */
  m1CandleFlow?: M1CandleFlowEvaluation | null;
};

export type EvaluateSetupsResult = {
  selected: SetupHit | null;
  specialists: GhFastSpecialistRawEval[];
};

export type EvaluateSetupsContext = {
  m1CandleFlow?: M1CandleFlowEvaluation | null;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function rawFromHit(
  setup: GhFastSetupId,
  hit: SetupHit | null,
  failedConditions: string[],
  softQuality: number | null,
  candidateSide: GhFastSide | null,
  selected: boolean
): GhFastSpecialistRawEval {
  if (hit) {
    return {
      setup,
      eligible: true,
      selected,
      candidateSide: hit.side,
      rawQuality: hit.quality,
      failedConditions: [],
      reasons: hit.reasons
    };
  }
  return {
    setup,
    eligible: false,
    selected: false,
    candidateSide,
    rawQuality: softQuality,
    failedConditions,
    reasons: []
  };
}

type SpecialistEvalInternal = {
  hit: SetupHit | null;
  failed: string[];
  softQuality: number | null;
  candidateSide: GhFastSide | null;
};

/** Cost/spread-aware minimum clearance beyond the prior extreme. */
export function requiredBreakoutDistance(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): number {
  const spread = Math.max(0, f.spread);
  const costFloor = Math.max(0, cfg.friction + cfg.safetyBuffer);
  return Math.max(spread, costFloor);
}

function bDiagnostics(
  f: GhFastFeatureSnapshot,
  args: {
    breakoutReference: number;
    breakoutDistance: number;
    required: number;
    rejectionReasons: string[];
  }
): GhBreakoutDiagnostics {
  return {
    brainVersion: GOLD_HUNTER_BRAIN_VERSION,
    breakoutReference: args.breakoutReference,
    breakoutDistance: args.breakoutDistance,
    requiredBreakoutDistance: args.required,
    spread: f.spread,
    midVel250: f.midVel250,
    midVel500: f.midVel500,
    midVel1s: f.midVel1s,
    acceleration: f.acceleration,
    efficiency1s: f.efficiency1s,
    signedImbalance1s: f.signedImbalance1s,
    depthImbalance: f.depth.depthImbalance,
    removeRateAsk: f.depth.removeRateAsk,
    removeRateBid: f.depth.removeRateBid,
    rejectionReasons: args.rejectionReasons
  };
}

/** Earned B quality — no large unconditional base. */
function scoreBreakoutQualityB(
  f: GhFastFeatureSnapshot,
  side: GhFastSide,
  breakoutDistance: number,
  required: number,
  cfg: GhFastConfig
): number {
  const disp = clamp01(breakoutDistance / Math.max(required * 3, 1e-9));
  const velAgree =
    side === "BUY"
      ? clamp01(
          (Number(f.midVel250 > 0) +
            Number(f.midVel500 > 0) +
            Number(f.midVel1s > 0)) /
            3
        )
      : clamp01(
          (Number(f.midVel250 < 0) +
            Number(f.midVel500 < 0) +
            Number(f.midVel1s < 0)) /
            3
        );
  // Same scale as Setup A: momentumVelMin * 3 (default 0.00024). Guard denom.
  const velMagDenom = Math.max(cfg.momentumVelMin * 3, 1e-12);
  const velMagNorm = clamp01(Math.abs(f.midVel1s) / velMagDenom);
  const eff = clamp01(f.efficiency1s);
  const imb =
    side === "BUY"
      ? clamp01(f.signedImbalance1s)
      : clamp01(-f.signedImbalance1s);
  const depth =
    side === "BUY"
      ? clamp01(0.5 + f.depth.depthImbalance)
      : clamp01(0.5 - f.depth.depthImbalance);
  const remove =
    side === "BUY"
      ? clamp01(
          f.depth.removeRateAsk / Math.max(1, f.depth.removeRateBid + 1)
        )
      : clamp01(
          f.depth.removeRateBid / Math.max(1, f.depth.removeRateAsk + 1)
        );
  return clamp01(
    0.22 * disp +
      0.18 * velAgree +
      0.15 * velMagNorm +
      0.15 * eff +
      0.12 * imb +
      0.1 * depth +
      0.08 * remove
  );
}

/** A — Momentum ignition (Brain V3: 1s direction consistency). */
export function scoreMomentumIgnition(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig,
  ctx?: EvaluateSetupsContext
): SetupHit | null {
  return evaluateMomentumIgnition(f, cfg, ctx).hit;
}

function evaluateMomentumIgnition(
  _f: GhFastFeatureSnapshot,
  _cfg: GhFastConfig,
  ctx?: EvaluateSetupsContext
): SpecialistEvalInternal {
  const flow = ctx?.m1CandleFlow ?? null;
  if (!flow) {
    return {
      hit: null,
      failed: ["m1_candle_flow_missing"],
      softQuality: null,
      candidateSide: null
    };
  }
  if (!flow.eligible || !flow.side) {
    const failed = flow.waitReason ? [flow.waitReason] : ["m1_candle_flow_wait"];
    return {
      hit: null,
      failed,
      softQuality: flow.finalQuality || null,
      candidateSide: flow.side
    };
  }

  const quality = clamp01(flow.finalQuality);
  if (quality >= flow.qualityThreshold) {
    return {
      hit: {
        setup: "A_MOMENTUM_IGNITION",
        side: flow.side,
        quality,
        reasons: [
          flow.side === "BUY" ? "m1_candle_flow_buy" : "m1_candle_flow_sell",
          ...flow.reasons
        ],
        m1CandleFlow: flow
      },
      failed: [],
      softQuality: quality,
      candidateSide: flow.side
    };
  }

  return {
    hit: null,
    failed: ["WAIT_QUALITY_BELOW_MIN"],
    softQuality: quality,
    candidateSide: flow.side
  };
}

/**
 * B — Fast breakout pressure (Brain V2).
 * Prior-only reference, cost-aware clearance, multi-horizon momentum,
 * efficiency + supportive depth. Quality is earned (no large base score).
 */
export function scoreFastBreakout(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SetupHit | null {
  return evaluateFastBreakout(f, cfg).hit;
}

function evaluateFastBreakout(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SpecialistEvalInternal {
  const failed: string[] = [];
  const required = requiredBreakoutDistance(f, cfg);
  const priorHigh = f.priorHigh5s;
  const priorLow = f.priorLow5s;
  const buyClearance = f.mid - priorHigh;
  const sellClearance = priorLow - f.mid;
  const brokeHigh = buyClearance > required;
  const brokeLow = sellClearance > required;

  const buyMomentum =
    f.midVel250 > 0 &&
    f.midVel500 > 0 &&
    f.midVel1s > 0 &&
    f.acceleration > 0 &&
    f.signedImbalance1s > cfg.breakoutImbalanceMin;
  const sellMomentum =
    f.midVel250 < 0 &&
    f.midVel500 < 0 &&
    f.midVel1s < 0 &&
    f.acceleration < 0 &&
    f.signedImbalance1s < -cfg.breakoutImbalanceMin;

  const buyDepth =
    f.depth.depthImbalance >= cfg.breakoutDepthImbalanceMin &&
    f.depth.removeRateAsk >= f.depth.removeRateBid;
  const sellDepth =
    f.depth.depthImbalance <= -cfg.breakoutDepthImbalanceMin &&
    f.depth.removeRateBid >= f.depth.removeRateAsk;

  const effOk = f.efficiency1s >= cfg.breakoutMinEfficiency1s;
  const rateOk = f.updateRate1s >= 3;

  const candidateSide: GhFastSide | null =
    brokeHigh && buyMomentum ? "BUY" : brokeLow && sellMomentum ? "SELL" : null;

  if (!brokeHigh && !brokeLow) {
    if (buyClearance > 0 && buyClearance <= required) {
      failed.push("breakout_clearance_insufficient");
    } else if (sellClearance > 0 && sellClearance <= required) {
      failed.push("breakout_clearance_insufficient");
    } else {
      failed.push("no_prior_extreme_clearance");
    }
  }
  if (!rateOk) failed.push("update_rate_insufficient");
  if ((brokeHigh || brokeLow) && !effOk) failed.push("efficiency1s_too_low");

  if (brokeHigh) {
    if (!(f.midVel250 > 0 && f.midVel500 > 0 && f.midVel1s > 0)) {
      failed.push("multi_horizon_velocity_disagree");
    }
    if (!(f.acceleration > 0)) failed.push("acceleration_not_aligned");
    if (!(f.signedImbalance1s > cfg.breakoutImbalanceMin)) {
      failed.push("imbalance_too_weak");
    }
    if (!buyDepth) {
      if (f.depth.depthImbalance < cfg.breakoutDepthImbalanceMin) {
        failed.push("depth_not_supportive");
      }
      if (f.depth.removeRateAsk < f.depth.removeRateBid) {
        failed.push("ask_liquidity_not_consumed");
      }
    }
  }
  if (brokeLow) {
    if (!(f.midVel250 < 0 && f.midVel500 < 0 && f.midVel1s < 0)) {
      failed.push("multi_horizon_velocity_disagree");
    }
    if (!(f.acceleration < 0)) failed.push("acceleration_not_aligned");
    if (!(f.signedImbalance1s < -cfg.breakoutImbalanceMin)) {
      failed.push("imbalance_too_weak");
    }
    if (!sellDepth) {
      if (f.depth.depthImbalance > -cfg.breakoutDepthImbalanceMin) {
        failed.push("depth_not_supportive");
      }
      if (f.depth.removeRateBid < f.depth.removeRateAsk) {
        failed.push("bid_liquidity_not_consumed");
      }
    }
  }

  if (brokeHigh && buyMomentum && buyDepth && effOk && rateOk) {
    const quality = scoreBreakoutQualityB(f, "BUY", buyClearance, required, cfg);
    const diag = bDiagnostics(f, {
      breakoutReference: priorHigh,
      breakoutDistance: buyClearance,
      required,
      rejectionReasons: []
    });
    if (quality >= cfg.minSetupQualityB) {
      return {
        hit: {
          setup: "B_FAST_BREAKOUT",
          side: "BUY",
          quality,
          reasons: [
            "breakout_prior_high",
            "multi_horizon_momentum",
            "depth_supportive",
            "efficiency_ok"
          ],
          diagnostics: diag
        },
        failed: [],
        softQuality: quality,
        candidateSide: "BUY"
      };
    }
    failed.push("quality_below_min_b");
    return {
      hit: null,
      failed: [...new Set(failed)],
      softQuality: quality,
      candidateSide: "BUY"
    };
  }

  if (brokeLow && sellMomentum && sellDepth && effOk && rateOk) {
    const quality = scoreBreakoutQualityB(
      f,
      "SELL",
      sellClearance,
      required,
      cfg
    );
    const diag = bDiagnostics(f, {
      breakoutReference: priorLow,
      breakoutDistance: sellClearance,
      required,
      rejectionReasons: []
    });
    if (quality >= cfg.minSetupQualityB) {
      return {
        hit: {
          setup: "B_FAST_BREAKOUT",
          side: "SELL",
          quality,
          reasons: [
            "breakout_prior_low",
            "multi_horizon_momentum",
            "depth_supportive",
            "efficiency_ok"
          ],
          diagnostics: diag
        },
        failed: [],
        softQuality: quality,
        candidateSide: "SELL"
      };
    }
    failed.push("quality_below_min_b");
    return {
      hit: null,
      failed: [...new Set(failed)],
      softQuality: quality,
      candidateSide: "SELL"
    };
  }

  return {
    hit: null,
    failed: failed.length ? [...new Set(failed)] : ["no_breakout_pressure"],
    softQuality: null,
    candidateSide
  };
}

/** C — Pullback re-acceleration (V1 — DO NOT redesign in Brain V2). */
export function scorePullbackReaccel(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SetupHit | null {
  return evaluatePullbackReaccel(f, cfg).hit;
}

function evaluatePullbackReaccel(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SpecialistEvalInternal {
  const failed: string[] = [];
  const impulseUp =
    f.midVel3s > cfg.momentumVelMin * 1.5 && f.efficiency3s > 0.35;
  const impulseDown =
    f.midVel3s < -cfg.momentumVelMin * 1.5 && f.efficiency3s > 0.35;
  const range5 = Math.max(1e-9, f.high5s - f.low5s);
  const pullbackFromHigh = (f.high5s - f.mid) / range5;
  const pullbackFromLow = (f.mid - f.low5s) / range5;
  const candidateSide: GhFastSide | null = impulseUp
    ? "BUY"
    : impulseDown
      ? "SELL"
      : null;

  if (!impulseUp && !impulseDown) {
    if (Math.abs(f.midVel3s) <= cfg.momentumVelMin * 1.5) {
      failed.push("impulse_vel3s_too_weak");
    }
    if (f.efficiency3s <= 0.35) failed.push("efficiency3s_too_low");
  }

  if (
    impulseUp &&
    pullbackFromHigh > 0.08 &&
    pullbackFromHigh <= cfg.pullbackRetraceMax &&
    f.midVel250 > 0 &&
    f.acceleration > 0 &&
    f.signedImbalance1s > 0 &&
    f.depth.depthImbalance >= -0.1
  ) {
    const quality = clamp01(
      0.3 +
        0.25 * clamp01(f.efficiency3s) +
        0.25 * clamp01(f.acceleration * 4000) +
        0.2 * clamp01(f.signedImbalance1s)
    );
    if (quality >= cfg.minSetupQuality) {
      return {
        hit: {
          setup: "C_PULLBACK_REACCEL",
          side: "BUY",
          quality,
          reasons: ["pullback_buy_reaccel"]
        },
        failed: [],
        softQuality: quality,
        candidateSide: "BUY"
      };
    }
    failed.push("quality_below_min");
    return { hit: null, failed, softQuality: quality, candidateSide: "BUY" };
  }
  if (
    impulseDown &&
    pullbackFromLow > 0.08 &&
    pullbackFromLow <= cfg.pullbackRetraceMax &&
    f.midVel250 < 0 &&
    f.acceleration < 0 &&
    f.signedImbalance1s < 0 &&
    f.depth.depthImbalance <= 0.1
  ) {
    const quality = clamp01(
      0.3 +
        0.25 * clamp01(f.efficiency3s) +
        0.25 * clamp01(-f.acceleration * 4000) +
        0.2 * clamp01(-f.signedImbalance1s)
    );
    if (quality >= cfg.minSetupQuality) {
      return {
        hit: {
          setup: "C_PULLBACK_REACCEL",
          side: "SELL",
          quality,
          reasons: ["pullback_sell_reaccel"]
        },
        failed: [],
        softQuality: quality,
        candidateSide: "SELL"
      };
    }
    failed.push("quality_below_min");
    return { hit: null, failed, softQuality: quality, candidateSide: "SELL" };
  }

  if (impulseUp || impulseDown) {
    const pb = impulseUp ? pullbackFromHigh : pullbackFromLow;
    if (!(pb > 0.08 && pb <= cfg.pullbackRetraceMax)) {
      failed.push(
        pb <= 0.08 ? "pullback_too_shallow" : "pullback_too_deep"
      );
    }
    if ((impulseUp && f.midVel250 <= 0) || (impulseDown && f.midVel250 >= 0)) {
      failed.push("reaccel_vel250_missing");
    }
    if (
      (impulseUp && f.acceleration <= 0) ||
      (impulseDown && f.acceleration >= 0)
    ) {
      failed.push("reaccel_acceleration_missing");
    }
    if (
      (impulseUp && f.signedImbalance1s <= 0) ||
      (impulseDown && f.signedImbalance1s >= 0)
    ) {
      failed.push("reaccel_imbalance_missing");
    }
    failed.push("pullback_not_confirmed");
  }

  return {
    hit: null,
    failed: failed.length ? [...new Set(failed)] : ["no_pullback_impulse"],
    softQuality: null,
    candidateSide
  };
}

/** Full A/B/C raw evaluation + best-of selection. */
export function evaluateSetupsDetailed(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig,
  ctx?: EvaluateSetupsContext
): EvaluateSetupsResult {
  const a = evaluateMomentumIgnition(f, cfg, ctx);
  const b = evaluateFastBreakout(f, cfg);
  const c = evaluatePullbackReaccel(f, cfg);
  // Brain V4 initial Demo phase: only Setup A (M1 Candle Flow) is execution-eligible.
  // Setups B/C remain fully evaluated for diagnostics/shadow research.
  const selected = a.hit;
  const specialists: GhFastSpecialistRawEval[] = [
    rawFromHit(
      "A_MOMENTUM_IGNITION",
      a.hit,
      a.failed,
      a.softQuality,
      a.candidateSide,
      selected?.setup === "A_MOMENTUM_IGNITION"
    ),
    rawFromHit(
      "B_FAST_BREAKOUT",
      b.hit,
      b.failed,
      b.softQuality,
      b.candidateSide,
      false
    ),
    rawFromHit(
      "C_PULLBACK_REACCEL",
      c.hit,
      c.failed,
      c.softQuality,
      c.candidateSide,
      false
    )
  ];
  return { selected, specialists };
}

/** Pick best of A/B/C (exactly three specialists). */
export function evaluateSetups(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig,
  ctx?: EvaluateSetupsContext
): SetupHit | null {
  return evaluateSetupsDetailed(f, cfg, ctx).selected;
}
