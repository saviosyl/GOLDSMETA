import type { V4Bar, V4Bias, V4Regime, V4VolumeProfile } from "./types";

export interface RegimeInput {
  bars15: V4Bar[];
  bars60: V4Bar[];
  atr: number | null;
  atrPercentile: number | null;
  profile: V4VolumeProfile | null;
  newsBlackout: boolean;
  session: string;
}

const ema = (values: number[], period: number): number | null => {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    e = values[i]! * k + e * (1 - k);
  }
  return e;
};

const slope = (values: number[], lookback = 5): number => {
  if (values.length < lookback + 1) return 0;
  const a = values[values.length - 1]!;
  const b = values[values.length - 1 - lookback]!;
  return a - b;
};

/**
 * Regime classification from confirmed bars only — no unfinished candles.
 */
export function classifyRegime(input: RegimeInput): { regime: V4Regime; bias: V4Bias; notes: string[] } {
  const notes: string[] = [];
  if (input.newsBlackout) {
    return { regime: "NEWS_BLACKOUT", bias: "NEUTRAL", notes: ["High-impact USD event blackout"] };
  }

  const c15 = input.bars15.filter((b) => b.confirmed);
  const c60 = input.bars60.filter((b) => b.confirmed);
  if (c15.length < 20) {
    return { regime: "LOW_LIQUIDITY", bias: "NEUTRAL", notes: ["Insufficient confirmed 15m bars"] };
  }

  if (input.atrPercentile != null && input.atrPercentile >= 95) {
    return {
      regime: "EXTREME_VOLATILITY",
      bias: "NEUTRAL",
      notes: ["ATR percentile extreme — no new setups"]
    };
  }

  const closes60 = c60.map((b) => b.close);
  const closes15 = c15.map((b) => b.close);
  const ema21_60 = ema(closes60, Math.min(21, Math.max(5, closes60.length - 1)));
  const ema21_15 = ema(closes15, 21);
  const last = c15[c15.length - 1]!.close;
  const slope60 = slope(closes60, Math.min(5, closes60.length - 1));
  const slope15 = slope(closes15, 5);

  let regime: V4Regime = "BALANCED_RANGE";
  let bias: V4Bias = "NEUTRAL";

  const strongUp = ema21_60 != null && last > ema21_60 && slope60 > 0 && slope15 > 0;
  const strongDown = ema21_60 != null && last < ema21_60 && slope60 < 0 && slope15 < 0;

  if (strongUp && Math.abs(slope60) > (input.atr ?? 1) * 0.4) {
    regime = "STRONG_UPTREND";
    bias = "BUY_BIAS";
  } else if (strongUp) {
    regime = "UPTREND";
    bias = "BUY_BIAS";
  } else if (strongDown && Math.abs(slope60) > (input.atr ?? 1) * 0.4) {
    regime = "STRONG_DOWNTREND";
    bias = "SELL_BIAS";
  } else if (strongDown) {
    regime = "DOWNTREND";
    bias = "SELL_BIAS";
  } else {
    regime = "BALANCED_RANGE";
    bias = "NEUTRAL";
  }

  // Breakout expansion: large range bar vs ATR
  const lastBar = c15[c15.length - 1]!;
  if (input.atr != null && lastBar.high - lastBar.low > input.atr * 1.8) {
    regime = "BREAKOUT_EXPANSION";
    notes.push("Wide range expansion bar vs ATR");
  }

  if (input.profile?.pocMigration === "UP" && bias === "BUY_BIAS") {
    notes.push("POC migrating upward");
  }
  if (input.profile?.pocMigration === "DOWN" && bias === "SELL_BIAS") {
    notes.push("POC migrating downward");
  }

  if (ema21_15 != null) {
    notes.push(`15m EMA21 ${last >= ema21_15 ? "supportive" : "resistant"}`);
  }

  return { regime, bias, notes };
}

export function regimePermitsStrategy(
  regime: V4Regime,
  family: "VALUE_BREAKOUT_RETEST" | "FAILED_AUCTION_REVERSAL"
): boolean {
  if (
    regime === "NEWS_BLACKOUT" ||
    regime === "EXTREME_VOLATILITY" ||
    regime === "LOW_LIQUIDITY"
  ) {
    return false;
  }
  if (family === "VALUE_BREAKOUT_RETEST") {
    return (
      regime === "UPTREND" ||
      regime === "STRONG_UPTREND" ||
      regime === "DOWNTREND" ||
      regime === "STRONG_DOWNTREND" ||
      regime === "BREAKOUT_EXPANSION"
    );
  }
  // Failed auction works best in balanced / mild trend
  return regime === "BALANCED_RANGE" || regime === "UPTREND" || regime === "DOWNTREND";
}
