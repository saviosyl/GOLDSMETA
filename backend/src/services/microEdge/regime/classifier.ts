import { MICRO_REGIME_VERSION } from "../config";
import type { MicroRegime } from "../types";

export function classifyMicroRegime(values: Record<string, number>, missing: Record<string, boolean>): {
  regime: MicroRegime;
  reasons: string[];
  regimeVersion: string;
} {
  const reasons: string[] = [];
  if (missing.m1_insufficient || missing.quote_stale || values.quote_live === 0) {
    reasons.push("stale_or_insufficient_data");
    return { regime: "DANGER", reasons, regimeVersion: MICRO_REGIME_VERSION };
  }
  if ((values.spread_vs_median ?? 1) > 2.5) {
    reasons.push("abnormal_spread");
    return { regime: "DANGER", reasons, regimeVersion: MICRO_REGIME_VERSION };
  }
  if ((values.vol_15m ?? 0) > 1.5 && (values.range_vs_median ?? 1) > 2) {
    reasons.push("volatility_shock");
    return { regime: "DANGER", reasons, regimeVersion: MICRO_REGIME_VERSION };
  }
  const slope = values.m15_trend_slope ?? 0;
  const mom = values.mom_15m ?? 0;
  const breakout = (values.m5_breakout_up ?? 0) === 1 || (values.m5_breakout_down ?? 0) === 1;
  if (breakout && (values.range_vs_median ?? 0) > 1.2 && (values.spread_vs_median ?? 1) < 1.8) {
    reasons.push("structure_break_with_expansion");
    return { regime: "BREAKOUT", reasons, regimeVersion: MICRO_REGIME_VERSION };
  }
  if (Math.abs(slope) > 0.4 && Math.sign(slope) === Math.sign(mom) && Math.abs(mom) > 0) {
    reasons.push("aligned_m15_slope_momentum");
    return { regime: "TREND", reasons, regimeVersion: MICRO_REGIME_VERSION };
  }
  reasons.push("compressed_or_contained");
  return { regime: "RANGE", reasons, regimeVersion: MICRO_REGIME_VERSION };
}
