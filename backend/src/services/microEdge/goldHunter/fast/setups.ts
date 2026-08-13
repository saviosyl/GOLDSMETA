/**
 * Three FAST specialists — interpretable setup-quality scores.
 */
import type { GhFastConfig, GhFastSetupId, GhFastSide } from "./types";
import type { GhFastFeatureSnapshot } from "./features";

export type SetupHit = {
  setup: GhFastSetupId;
  side: GhFastSide;
  quality: number;
  reasons: string[];
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** A — Momentum ignition */
export function scoreMomentumIgnition(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SetupHit | null {
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

  if (buyPressure && Math.abs(f.midVel1s) >= cfg.momentumVelMin) {
    const quality = clamp01(
      0.35 * Math.min(1, Math.abs(f.midVel1s) / (cfg.momentumVelMin * 3)) +
        0.25 * clamp01(f.acceleration * 5000) +
        0.2 * clamp01(f.signedImbalance1s) +
        0.2 * clamp01(f.depth.removeRateAsk / Math.max(1, f.depth.removeRateBid + 1))
    );
    if (quality >= cfg.minSetupQuality) {
      return {
        setup: "A_MOMENTUM_IGNITION",
        side: "BUY",
        quality,
        reasons: ["mom_ignition_buy", "ask_liquidity_consumed"]
      };
    }
  }
  if (sellPressure && Math.abs(f.midVel1s) >= cfg.momentumVelMin) {
    const quality = clamp01(
      0.35 * Math.min(1, Math.abs(f.midVel1s) / (cfg.momentumVelMin * 3)) +
        0.25 * clamp01(-f.acceleration * 5000) +
        0.2 * clamp01(-f.signedImbalance1s) +
        0.2 * clamp01(f.depth.removeRateBid / Math.max(1, f.depth.removeRateAsk + 1))
    );
    if (quality >= cfg.minSetupQuality) {
      return {
        setup: "A_MOMENTUM_IGNITION",
        side: "SELL",
        quality,
        reasons: ["mom_ignition_sell", "bid_liquidity_consumed"]
      };
    }
  }
  return null;
}

/** B — Fast breakout pressure */
export function scoreFastBreakout(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SetupHit | null {
  const nearHigh = f.distHigh5s <= f.spread * 1.5;
  const nearLow = f.distLow5s <= f.spread * 1.5;
  const brokeHigh = f.mid >= f.high5s - 1e-9 && f.midVel250 > 0;
  const brokeLow = f.mid <= f.low5s + 1e-9 && f.midVel250 < 0;

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
        setup: "B_FAST_BREAKOUT",
        side: "BUY",
        quality,
        reasons: ["breakout_high", "repeated_up_attacks"]
      };
    }
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
        setup: "B_FAST_BREAKOUT",
        side: "SELL",
        quality,
        reasons: ["breakout_low", "repeated_down_attacks"]
      };
    }
  }
  return null;
}

/** C — Pullback re-acceleration */
export function scorePullbackReaccel(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SetupHit | null {
  const impulseUp = f.midVel3s > cfg.momentumVelMin * 1.5 && f.efficiency3s > 0.35;
  const impulseDown =
    f.midVel3s < -cfg.momentumVelMin * 1.5 && f.efficiency3s > 0.35;
  const range5 = Math.max(1e-9, f.high5s - f.low5s);
  const pullbackFromHigh = (f.high5s - f.mid) / range5;
  const pullbackFromLow = (f.mid - f.low5s) / range5;

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
        setup: "C_PULLBACK_REACCEL",
        side: "BUY",
        quality,
        reasons: ["pullback_buy_reaccel"]
      };
    }
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
        setup: "C_PULLBACK_REACCEL",
        side: "SELL",
        quality,
        reasons: ["pullback_sell_reaccel"]
      };
    }
  }
  return null;
}

/** Pick best of A/B/C (exactly three specialists). */
export function evaluateSetups(
  f: GhFastFeatureSnapshot,
  cfg: GhFastConfig
): SetupHit | null {
  const hits = [
    scoreMomentumIgnition(f, cfg),
    scoreFastBreakout(f, cfg),
    scorePullbackReaccel(f, cfg)
  ].filter((x): x is SetupHit => x != null);
  if (!hits.length) return null;
  hits.sort((a, b) => b.quality - a.quality);
  return hits[0]!;
}
