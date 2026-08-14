/**
 * Missed-opportunity / near-entry rejection diagnostics.
 * Counts why FAST did not enter — evidence for later calibration (not during soak).
 */
import type { GhFastConfig, GhFastSetupId } from "./types";
import type { GhFastFeatureSnapshot } from "./features";
import {
  scoreMomentumIgnition,
  scoreFastBreakout,
  scorePullbackReaccel
} from "./setups";

export type GhFastRejectionReason =
  | "spread_too_high"
  | "depth_stale"
  | "depth_unavailable"
  | "spot_stale"
  | "setup_quality_below_threshold"
  | "expected_move_below_friction"
  | "rearm_floor"
  | "existing_open_position"
  | "velocity_insufficient"
  | "acceleration_insufficient"
  | "depth_imbalance_insufficient"
  | "breakout_not_confirmed"
  | "pullback_not_confirmed"
  | "ask_liquidity_not_consumed"
  | "bid_liquidity_not_consumed"
  | "update_rate_insufficient"
  | "no_setup_pressure"
  | "duplicate_event"
  | "data_stale"
  | "hunting";

export class GhFastRejectionCounter {
  private counts = new Map<string, number>();

  record(reason: string, n = 1): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + n);
  }

  recordMany(reasons: string[]): void {
    for (const r of reasons) this.record(r);
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of [...this.counts.entries()].sort((a, b) => b[1] - a[1])) {
      out[k] = v;
    }
    return out;
  }

  total(): number {
    let s = 0;
    for (const v of this.counts.values()) s += v;
    return s;
  }

  clear(): void {
    this.counts.clear();
  }
}

/** Granular near-miss codes for Setup A/B/C when no hit fires. */
export function diagnoseSetupNearMisses(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): string[] {
  const reasons: string[] = [];

  // A — momentum
  const aHit = scoreMomentumIgnition(f, cfg);
  if (!aHit) {
    if (Math.abs(f.midVel1s) < cfg.momentumVelMin) {
      reasons.push("velocity_insufficient");
    }
    if (Math.abs(f.acceleration) < cfg.momentumVelMin * 0.5) {
      reasons.push("acceleration_insufficient");
    }
    if (Math.abs(f.depth.depthImbalance) < 0.05) {
      reasons.push("depth_imbalance_insufficient");
    }
    const buyLike = f.midVel250 > 0 && f.midVel500 > 0;
    const sellLike = f.midVel250 < 0 && f.midVel500 < 0;
    if (buyLike && f.depth.removeRateAsk < f.depth.removeRateBid) {
      reasons.push("ask_liquidity_not_consumed");
    }
    if (sellLike && f.depth.removeRateBid < f.depth.removeRateAsk) {
      reasons.push("bid_liquidity_not_consumed");
    }
  }

  // B — breakout
  const bHit = scoreFastBreakout(f, cfg);
  if (!bHit) {
    const nearHigh = f.distHigh5s <= f.spread * 1.5;
    const nearLow = f.distLow5s <= f.spread * 1.5;
    const brokeHigh = f.mid >= f.high5s - 1e-9 && f.midVel250 > 0;
    const brokeLow = f.mid <= f.low5s + 1e-9 && f.midVel250 < 0;
    if ((nearHigh || nearLow) && !(brokeHigh || brokeLow)) {
      reasons.push("breakout_not_confirmed");
    }
    if (f.updateRate1s < 3) reasons.push("update_rate_insufficient");
  }

  // C — pullback
  const cHit = scorePullbackReaccel(f, cfg);
  if (!cHit) {
    const impulseUp =
      f.midVel3s > cfg.momentumVelMin * 1.5 && f.efficiency3s > 0.35;
    const impulseDown =
      f.midVel3s < -cfg.momentumVelMin * 1.5 && f.efficiency3s > 0.35;
    if (impulseUp || impulseDown) {
      reasons.push("pullback_not_confirmed");
    }
  }

  if (!aHit && !bHit && !cHit && reasons.length === 0) {
    reasons.push("no_setup_pressure");
  }

  // Quality near-miss: setup almost fired
  for (const scorer of [
    scoreMomentumIgnition,
    scoreFastBreakout,
    scorePullbackReaccel
  ]) {
    // already null above; check soft quality by temporarily lowering threshold
    const soft = scorer(f, { ...cfg, minSetupQuality: 0.01 });
    if (soft && soft.quality < cfg.minSetupQuality) {
      reasons.push("setup_quality_below_threshold");
      reasons.push(`near_${soft.setup}`);
    }
  }

  return [...new Set(reasons)];
}

export function mapDecisionReasonsToRejections(
  reasons: string[]
): GhFastRejectionReason[] {
  const out: GhFastRejectionReason[] = [];
  for (const r of reasons) {
    if (r === "spread_blocked") out.push("spread_too_high");
    else if (r === "stale_bid_ask") out.push("data_stale");
    else if (r === "rearm_floor") out.push("rearm_floor");
    else if (r === "edge_below_friction_buffer") {
      out.push("expected_move_below_friction");
    } else if (r === "duplicate_event") out.push("duplicate_event");
    else if (r === "hunting") out.push("hunting");
    else if (r === "holding") out.push("existing_open_position");
  }
  return out;
}

export type SetupDetectionCounts = Record<
  GhFastSetupId | "NONE",
  number
>;

export function emptySetupDetectionCounts(): SetupDetectionCounts {
  return {
    A_MOMENTUM_IGNITION: 0,
    B_FAST_BREAKOUT: 0,
    C_PULLBACK_REACCEL: 0,
    NONE: 0
  };
}
