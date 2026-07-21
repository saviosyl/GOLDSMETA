import type { V4StrategyFamily } from "./config";
import { regimePermitsStrategy } from "./regimeEngine";
import type { V4Bar, V4Regime, V4VolumeProfile } from "./types";

export interface StrategyPatternHit {
  family: V4StrategyFamily;
  direction: "BUY" | "SELL";
  entryHint: number;
  structureRef: number;
  notes: string[];
}

/**
 * STRATEGY A — Value breakout and retest continuation.
 * Separately configured from failed-auction; never mixed into one score.
 */
export function detectValueBreakoutRetest(input: {
  bars: V4Bar[];
  profile: V4VolumeProfile;
  regime: V4Regime;
}): StrategyPatternHit | null {
  if (!regimePermitsStrategy(input.regime, "VALUE_BREAKOUT_RETEST")) return null;
  if (!input.profile.valid || input.profile.vah == null || input.profile.val == null) return null;

  const bars = input.bars.filter((b) => b.confirmed);
  if (bars.length < 4) return null;
  const [a, b, c, d] = bars.slice(-4);
  if (!a || !b || !c || !d) return null;

  const { vah, val } = input.profile;
  const upOk =
    input.regime === "UPTREND" ||
    input.regime === "STRONG_UPTREND" ||
    input.regime === "BREAKOUT_EXPANSION";
  const downOk =
    input.regime === "DOWNTREND" ||
    input.regime === "STRONG_DOWNTREND" ||
    input.regime === "BREAKOUT_EXPANSION";

  // BUY: close above VAH, displacement, acceptance, retest hold
  if (upOk && b.close > vah && b.close - vah > (input.profile.pocZoneWidth || 0.5)) {
    const acceptance = c.close >= vah;
    const retestHold = d.low <= vah + input.profile.pocZoneWidth && d.close >= vah;
    const pocOk =
      input.profile.pocMigration === "UP" ||
      input.profile.pocMigration === "FLAT" ||
      input.profile.pocMigration === "UNKNOWN";
    if (acceptance && retestHold && pocOk && d.close > d.open) {
      return {
        family: "VALUE_BREAKOUT_RETEST",
        direction: "BUY",
        entryHint: d.close,
        structureRef: vah,
        notes: ["Confirmed close above VAH", "Retest held value high", "Bullish confirmation close"]
      };
    }
  }

  // SELL mirror below VAL
  if (downOk && b.close < val && val - b.close > (input.profile.pocZoneWidth || 0.5)) {
    const acceptance = c.close <= val;
    const retestHold = d.high >= val - input.profile.pocZoneWidth && d.close <= val;
    const pocOk =
      input.profile.pocMigration === "DOWN" ||
      input.profile.pocMigration === "FLAT" ||
      input.profile.pocMigration === "UNKNOWN";
    if (acceptance && retestHold && pocOk && d.close < d.open) {
      return {
        family: "VALUE_BREAKOUT_RETEST",
        direction: "SELL",
        entryHint: d.close,
        structureRef: val,
        notes: ["Confirmed close below VAL", "Retest held value low", "Bearish confirmation close"]
      };
    }
  }

  return null;
}

/**
 * STRATEGY B — Failed auction reversal.
 */
export function detectFailedAuction(input: {
  bars: V4Bar[];
  profile: V4VolumeProfile;
  regime: V4Regime;
}): StrategyPatternHit | null {
  if (!regimePermitsStrategy(input.regime, "FAILED_AUCTION_REVERSAL")) return null;
  if (!input.profile.valid || input.profile.vah == null || input.profile.val == null) return null;

  const bars = input.bars.filter((b) => b.confirmed);
  if (bars.length < 4) return null;
  const [a, b, c, d] = bars.slice(-4);
  if (!a || !b || !c || !d) return null;
  const { vah, val, poc } = input.profile;

  // BUY: trade below VAL, fail to accept, close back inside value
  if (b.low < val && c.close > val && d.close > val && d.close > d.open) {
    const recovered = d.close >= (poc ?? val);
    if (recovered || d.close > val) {
      return {
        family: "FAILED_AUCTION_REVERSAL",
        direction: "BUY",
        entryHint: d.close,
        structureRef: b.low,
        notes: ["Failed acceptance below VAL", "Close back inside value", "Recovery confirmation"]
      };
    }
  }

  // SELL mirror above VAH
  if (b.high > vah && c.close < vah && d.close < vah && d.close < d.open) {
    return {
      family: "FAILED_AUCTION_REVERSAL",
      direction: "SELL",
      entryHint: d.close,
      structureRef: b.high,
      notes: ["Failed acceptance above VAH", "Close back inside value", "Rejection confirmation"]
    };
  }

  return null;
}

/** Evaluate families separately — never blend into one generic BUY score. */
export function detectStrategyPatterns(input: {
  bars: V4Bar[];
  profile: V4VolumeProfile;
  regime: V4Regime;
}): StrategyPatternHit[] {
  const hits: StrategyPatternHit[] = [];
  const a = detectValueBreakoutRetest(input);
  const b = detectFailedAuction(input);
  if (a) hits.push(a);
  if (b) hits.push(b);
  return hits;
}
