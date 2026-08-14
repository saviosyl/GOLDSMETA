/**
 * Transparent real-time V1.2 regime classification — PAST information only.
 */
export type V12Regime =
  | "TREND_ACCELERATING"
  | "TREND_STEADY"
  | "BREAKOUT"
  | "RANGE"
  | "CHOP"
  | "REVERSAL_RISK"
  | "SPREAD_ABNORMAL"
  | "LOW_ACTIVITY"
  | "HIGH_VOLATILITY";

export type V12RegimeInputs = {
  /** Mid return over 5s / 15s / 60s (fractional). */
  ret5: number;
  ret15: number;
  ret60: number;
  /** Short vol proxy (stdev of 1s returns). */
  shortVol: number;
  range15: number;
  range60: number;
  /** Current spread / rolling median spread. */
  spreadOverMedian: number;
  /** Quote update intensity vs rolling mean (burst ratio). */
  burstRatio: number;
  /** Directional efficiency |net|/path in 15s. */
  efficiency15: number;
  /** Spot events in last second. */
  tickRate1s: number;
  /** Rolling mean tick rate. */
  tickRateMean: number;
};

export function classifyV12Regime(x: V12RegimeInputs): V12Regime {
  if (x.spreadOverMedian >= 2.2) return "SPREAD_ABNORMAL";
  if (x.shortVol >= 0.0009 || x.range60 >= 3.5) return "HIGH_VOLATILITY";
  if (x.tickRateMean > 0 && x.tickRate1s < x.tickRateMean * 0.25) {
    return "LOW_ACTIVITY";
  }

  const abs60 = Math.abs(x.ret60);
  const abs15 = Math.abs(x.ret15);
  const accel =
    Math.sign(x.ret5) === Math.sign(x.ret15) &&
    Math.abs(x.ret5) > Math.abs(x.ret15) * 0.35;

  if (x.efficiency15 < 0.18 && x.range15 > 0 && abs15 / Math.max(x.range15, 1e-9) < 0.25) {
    return "CHOP";
  }

  if (
    Math.sign(x.ret5) !== 0 &&
    Math.sign(x.ret15) !== 0 &&
    Math.sign(x.ret5) !== Math.sign(x.ret15) &&
    abs15 >= 0.00025
  ) {
    return "REVERSAL_RISK";
  }

  if (abs15 >= 0.00045 && x.burstRatio >= 1.4 && x.efficiency15 >= 0.45) {
    return "BREAKOUT";
  }

  if (abs60 >= 0.0007 && x.efficiency15 >= 0.4) {
    return accel ? "TREND_ACCELERATING" : "TREND_STEADY";
  }

  return "RANGE";
}

/** Map V12 regime → legacy GhRegime for shadow trade storage. */
export function v12RegimeToGh(r: V12Regime): "TREND" | "BREAKOUT" | "RANGE" | "DANGER" {
  if (r === "SPREAD_ABNORMAL" || r === "HIGH_VOLATILITY") return "DANGER";
  if (r === "BREAKOUT") return "BREAKOUT";
  if (r === "TREND_ACCELERATING" || r === "TREND_STEADY") return "TREND";
  return "RANGE";
}
