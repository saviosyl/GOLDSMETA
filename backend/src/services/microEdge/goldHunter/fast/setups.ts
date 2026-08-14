/**
 * Three FAST specialists — interpretable setup-quality scores.
 * Phase 0B: always expose raw A/B/C eligibility separately from best-of selection.
 */
import type {
  GhFastConfig,
  GhFastSetupId,
  GhFastSide,
  GhFastSpecialistRawEval
} from "./types";
import type { GhFastFeatureSnapshot } from "./features";

export type SetupHit = {
  setup: GhFastSetupId;
  side: GhFastSide;
  quality: number;
  reasons: string[];
};

export type EvaluateSetupsResult = {
  selected: SetupHit | null;
  specialists: GhFastSpecialistRawEval[];
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

/** A — Momentum ignition */
export function scoreMomentumIgnition(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SetupHit | null {
  return evaluateMomentumIgnition(f, cfg).hit;
}

function evaluateMomentumIgnition(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SpecialistEvalInternal {
  const failed: string[] = [];
  const buyPressure =
    f.midVel250 > 0 &&
    f.midVel500 > 0 &&
    f.acceleration > 0 &&
    f.signedImbalance1s > 0.15 &&
    f.depth.removeRateAsk >= f.depth.removeRateBid &&
    f.depth.depthImbalance >= -0.15;
  const sellPressure =
    f.midVel250 < 0 &&
    f.midVel500 < 0 &&
    f.acceleration < 0 &&
    f.signedImbalance1s < -0.15 &&
    f.depth.removeRateBid >= f.depth.removeRateAsk &&
    f.depth.depthImbalance <= 0.15;
  const candidateSide: GhFastSide | null = buyPressure
    ? "BUY"
    : sellPressure
      ? "SELL"
      : null;

  if (!(buyPressure || sellPressure)) {
    if (!(f.midVel250 > 0 && f.midVel500 > 0) && !(f.midVel250 < 0 && f.midVel500 < 0)) {
      failed.push("velocity_not_aligned");
    }
    if (f.acceleration === 0 || Math.sign(f.acceleration) !== Math.sign(f.midVel250 || 1)) {
      failed.push("acceleration_not_aligned");
    }
    if (Math.abs(f.signedImbalance1s) <= 0.15) failed.push("imbalance_too_weak");
    if (f.depth.removeRateAsk < f.depth.removeRateBid && f.midVel250 > 0) {
      failed.push("ask_liquidity_not_consumed");
    }
    if (f.depth.removeRateBid < f.depth.removeRateAsk && f.midVel250 < 0) {
      failed.push("bid_liquidity_not_consumed");
    }
    if (f.depth.depthImbalance < -0.15 && f.midVel250 > 0) {
      failed.push("depth_imbalance_against_buy");
    }
    if (f.depth.depthImbalance > 0.15 && f.midVel250 < 0) {
      failed.push("depth_imbalance_against_sell");
    }
  }

  if (buyPressure && Math.abs(f.midVel1s) >= cfg.momentumVelMin) {
    const quality = clamp01(
      0.35 * Math.min(1, Math.abs(f.midVel1s) / (cfg.momentumVelMin * 3)) +
        0.25 * clamp01(f.acceleration * 5000) +
        0.2 * clamp01(f.signedImbalance1s) +
        0.2 *
          clamp01(
            f.depth.removeRateAsk / Math.max(1, f.depth.removeRateBid + 1)
          )
    );
    if (quality >= cfg.minSetupQuality) {
      return {
        hit: {
          setup: "A_MOMENTUM_IGNITION",
          side: "BUY",
          quality,
          reasons: ["mom_ignition_buy", "ask_liquidity_consumed"]
        },
        failed: [],
        softQuality: quality,
        candidateSide: "BUY"
      };
    }
    failed.push("quality_below_min");
    return { hit: null, failed, softQuality: quality, candidateSide: "BUY" };
  }
  if (sellPressure && Math.abs(f.midVel1s) >= cfg.momentumVelMin) {
    const quality = clamp01(
      0.35 * Math.min(1, Math.abs(f.midVel1s) / (cfg.momentumVelMin * 3)) +
        0.25 * clamp01(-f.acceleration * 5000) +
        0.2 * clamp01(-f.signedImbalance1s) +
        0.2 *
          clamp01(
            f.depth.removeRateBid / Math.max(1, f.depth.removeRateAsk + 1)
          )
    );
    if (quality >= cfg.minSetupQuality) {
      return {
        hit: {
          setup: "A_MOMENTUM_IGNITION",
          side: "SELL",
          quality,
          reasons: ["mom_ignition_sell", "bid_liquidity_consumed"]
        },
        failed: [],
        softQuality: quality,
        candidateSide: "SELL"
      };
    }
    failed.push("quality_below_min");
    return { hit: null, failed, softQuality: quality, candidateSide: "SELL" };
  }
  if (buyPressure || sellPressure) {
    failed.push("velocity_1s_below_min");
  }
  return {
    hit: null,
    failed: failed.length ? failed : ["no_momentum_pressure"],
    softQuality: null,
    candidateSide
  };
}

/** B — Fast breakout pressure */
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
  const nearHigh = f.distHigh5s <= f.spread * 1.5;
  const nearLow = f.distLow5s <= f.spread * 1.5;
  const brokeHigh = f.mid >= f.high5s - 1e-9 && f.midVel250 > 0;
  const brokeLow = f.mid <= f.low5s + 1e-9 && f.midVel250 < 0;
  const candidateSide: GhFastSide | null =
    nearHigh && brokeHigh ? "BUY" : nearLow && brokeLow ? "SELL" : null;

  if (!nearHigh && !nearLow) failed.push("not_near_5s_extreme");
  if ((nearHigh || nearLow) && !(brokeHigh || brokeLow)) {
    failed.push("breakout_not_confirmed");
  }
  if (f.updateRate1s < 3) failed.push("update_rate_insufficient");

  if (
    nearHigh &&
    brokeHigh &&
    f.upTouches5s >= cfg.breakoutTouchCount &&
    f.updateRate1s >= 3 &&
    f.depth.depthImbalance >= -0.05
  ) {
    const quality = clamp01(
      0.3 +
        0.25 * clamp01(f.upTouches5s / 5) +
        0.25 * clamp01(f.updateRate1s / 10) +
        0.2 * clamp01(0.5 + f.depth.depthImbalance)
    );
    if (quality >= cfg.minSetupQuality) {
      return {
        hit: {
          setup: "B_FAST_BREAKOUT",
          side: "BUY",
          quality,
          reasons: ["breakout_high", "repeated_up_attacks"]
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
    nearLow &&
    brokeLow &&
    f.downTouches5s >= cfg.breakoutTouchCount &&
    f.updateRate1s >= 3 &&
    f.depth.depthImbalance <= 0.05
  ) {
    const quality = clamp01(
      0.3 +
        0.25 * clamp01(f.downTouches5s / 5) +
        0.25 * clamp01(f.updateRate1s / 10) +
        0.2 * clamp01(0.5 - f.depth.depthImbalance)
    );
    if (quality >= cfg.minSetupQuality) {
      return {
        hit: {
          setup: "B_FAST_BREAKOUT",
          side: "SELL",
          quality,
          reasons: ["breakout_low", "repeated_down_attacks"]
        },
        failed: [],
        softQuality: quality,
        candidateSide: "SELL"
      };
    }
    failed.push("quality_below_min");
    return { hit: null, failed, softQuality: quality, candidateSide: "SELL" };
  }
  if (brokeHigh && f.upTouches5s < cfg.breakoutTouchCount) {
    failed.push("up_touches_insufficient");
  }
  if (brokeLow && f.downTouches5s < cfg.breakoutTouchCount) {
    failed.push("down_touches_insufficient");
  }
  if (brokeHigh && f.depth.depthImbalance < -0.05) {
    failed.push("depth_imbalance_against_breakout_buy");
  }
  if (brokeLow && f.depth.depthImbalance > 0.05) {
    failed.push("depth_imbalance_against_breakout_sell");
  }
  return {
    hit: null,
    failed: failed.length ? [...new Set(failed)] : ["no_breakout_pressure"],
    softQuality: null,
    candidateSide
  };
}

/** C — Pullback re-acceleration */
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
  cfg: GhFastConfig
): EvaluateSetupsResult {
  const a = evaluateMomentumIgnition(f, cfg);
  const b = evaluateFastBreakout(f, cfg);
  const c = evaluatePullbackReaccel(f, cfg);
  const hits = [a.hit, b.hit, c.hit].filter((x): x is SetupHit => x != null);
  hits.sort((x, y) => y.quality - x.quality);
  const selected = hits.length ? hits[0]! : null;
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
      selected?.setup === "B_FAST_BREAKOUT"
    ),
    rawFromHit(
      "C_PULLBACK_REACCEL",
      c.hit,
      c.failed,
      c.softQuality,
      c.candidateSide,
      selected?.setup === "C_PULLBACK_REACCEL"
    )
  ];
  return { selected, specialists };
}

/** Pick best of A/B/C (exactly three specialists). */
export function evaluateSetups(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SetupHit | null {
  return evaluateSetupsDetailed(f, cfg).selected;
}
