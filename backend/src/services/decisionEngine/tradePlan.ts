import type { DecisionEngineConfig, MarketAnalysisInput, PrimaryAction } from "./types";
import { near, present, roundPrice, roundRatio } from "./scoring";

export interface EngineTradePlan {
  entryType: "market" | "limit" | "breakout" | "retest" | "none";
  entryRange: { low: number | null; high: number | null; reference: number | null };
  stopLoss: number | null;
  takeProfits: { tp1: number | null; tp2: number | null; tp3: number | null };
  riskReward: { tp1: number | null; tp2: number | null; tp3: number | null };
  invalidationLevel: number | null;
  geometryErrors: string[];
}

const rr = (side: "BUY" | "SELL", entry: number, stop: number, target: number): number | null => {
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const reward = side === "BUY" ? target - entry : entry - target;
  if (reward <= 0) return null;
  return roundRatio(reward / risk);
};

export const buildEngineTradePlan = (
  input: MarketAnalysisInput,
  action: PrimaryAction,
  config: DecisionEngineConfig,
  entryType: EngineTradePlan["entryType"]
): EngineTradePlan => {
  if (action === "WAIT") {
    return {
      entryType: "none",
      entryRange: { low: null, high: null, reference: input.currentPrice },
      stopLoss: null,
      takeProfits: { tp1: null, tp2: null, tp3: null },
      riskReward: { tp1: null, tp2: null, tp3: null },
      invalidationLevel: null,
      geometryErrors: []
    };
  }

  const side = action;
  const atr = input.atr ?? Math.max(input.currentPrice * 0.0015, 0.5);
  const buffer = atr * (config.thresholds.stopAtrBufferMult ?? 0.25);
  const geometryErrors: string[] = [];

  let entryRef = roundPrice(input.currentPrice);
  let entryLow = entryRef;
  let entryHigh = entryRef;

  if (entryType === "retest" || entryType === "limit") {
    if (side === "BUY" && present(input.val)) {
      entryLow = roundPrice(Math.min(input.currentPrice, input.val));
      entryHigh = roundPrice(input.currentPrice);
      entryRef = roundPrice((entryLow + entryHigh) / 2);
    } else if (side === "SELL" && present(input.vah)) {
      entryHigh = roundPrice(Math.max(input.currentPrice, input.vah));
      entryLow = roundPrice(input.currentPrice);
      entryRef = roundPrice((entryLow + entryHigh) / 2);
    }
  }

  // Stop from structure + ATR buffer.
  // For breakouts, prefer invalidation under/above the broken level rather than the impulse wick.
  let stop: number | null = null;
  if (side === "BUY") {
    const candidates = [input.nearbySupport, input.val, input.poc]
      .filter(present)
      .filter((level) => level < entryRef);
    if (entryType === "breakout" && present(input.nearbyResistance) && input.nearbyResistance < entryRef) {
      candidates.push(input.nearbyResistance);
    } else if (present(input.candle.low) && input.candle.low < entryRef) {
      candidates.push(input.candle.low);
    }
    const structural = candidates.sort((a, b) => b - a)[0];
    if (present(structural)) {
      stop = roundPrice(structural - buffer);
    } else {
      stop = roundPrice(entryRef - atr * (1 + (config.thresholds.stopAtrBufferMult ?? 0.25)));
    }
  } else {
    const candidates = [input.nearbyResistance, input.vah, input.poc]
      .filter(present)
      .filter((level) => level > entryRef);
    if (entryType === "breakout" && present(input.nearbySupport) && input.nearbySupport > entryRef) {
      candidates.push(input.nearbySupport);
    } else if (present(input.candle.high) && input.candle.high > entryRef) {
      candidates.push(input.candle.high);
    }
    const structural = candidates.sort((a, b) => a - b)[0];
    if (present(structural)) {
      stop = roundPrice(structural + buffer);
    } else {
      stop = roundPrice(entryRef + atr * (1 + (config.thresholds.stopAtrBufferMult ?? 0.25)));
    }
  }

  if (!present(stop)) {
    geometryErrors.push("Unable to determine stop loss from ATR/structure");
  } else if (side === "BUY" && stop >= entryRef) {
    geometryErrors.push("Stop loss is on the wrong side of entry for BUY");
    stop = null;
  } else if (side === "SELL" && stop <= entryRef) {
    geometryErrors.push("Stop loss is on the wrong side of entry for SELL");
    stop = null;
  }

  const risk = present(stop) ? Math.abs(entryRef - stop) : 0;
  const maxRiskPct = config.thresholds.maxRiskPercentPerTrade ?? 1;
  const riskPct = entryRef > 0 ? (risk / entryRef) * 100 : 100;
  if (riskPct > maxRiskPct * 3) {
    // Structural risk too wide vs typical gold ATR — still allow but flag; hard reject only if absurd
    geometryErrors.push("Stop distance unusually wide versus price — review size carefully");
  }

  const structuralTargets =
    side === "BUY"
      ? [input.nearbyResistance, input.vah, ...(input.hvnLevels ?? [])]
          .filter(present)
          .filter((level) => level > entryRef)
          .sort((a, b) => a - b)
      : [input.nearbySupport, input.val, ...(input.hvnLevels ?? [])]
          .filter(present)
          .filter((level) => level < entryRef)
          .sort((a, b) => b - a);

  const atrTargets = present(stop)
    ? [1, 2, 3.2].map((mult, index) => {
        const key = index === 0 ? "tp1AtrMult" : index === 1 ? "tp2AtrMult" : "tp3AtrMult";
        const m = config.thresholds[key] ?? mult;
        return side === "BUY" ? roundPrice(entryRef + atr * m) : roundPrice(entryRef - atr * m);
      })
    : [null, null, null];

  // Prefer the farther of structure vs ATR so nearby HVNs do not collapse RR,
  // while still allowing poor-structure setups to fail the RR guard honestly.
  const pickTarget = (index: number): number | null => {
    const structural = structuralTargets[index];
    const atrTarget = atrTargets[index] ?? null;
    if (present(structural) && present(atrTarget)) {
      return side === "BUY"
        ? roundPrice(Math.max(structural, atrTarget))
        : roundPrice(Math.min(structural, atrTarget));
    }
    return present(structural) ? roundPrice(structural) : atrTarget;
  };

  const tp1 = pickTarget(0);
  const tp2 = pickTarget(1);
  const tp3 = pickTarget(2);

  for (const [label, target] of [
    ["TP1", tp1],
    ["TP2", tp2],
    ["TP3", tp3]
  ] as const) {
    if (!present(target) || !present(stop)) continue;
    if (side === "BUY" && target <= entryRef) geometryErrors.push(`${label} on wrong side of entry`);
    if (side === "SELL" && target >= entryRef) geometryErrors.push(`${label} on wrong side of entry`);
  }

  // Invalidation beyond stop
  const invalidation = present(stop)
    ? roundPrice(side === "BUY" ? stop - buffer * 0.5 : stop + buffer * 0.5)
    : null;

  // Conflict zone check for entry
  if (
    present(input.nearbyResistance) &&
    present(input.nearbySupport) &&
    near(input.currentPrice, input.nearbyResistance, atr, config.thresholds.structureProximityAtrMult ?? 0.15) &&
    near(input.currentPrice, input.nearbySupport, atr, config.thresholds.structureProximityAtrMult ?? 0.15)
  ) {
    geometryErrors.push("Entry sits in major support/resistance conflict zone");
  }

  return {
    entryType,
    entryRange: {
      low: roundPrice(entryLow),
      high: roundPrice(entryHigh),
      reference: entryRef
    },
    stopLoss: stop,
    takeProfits: { tp1, tp2, tp3 },
    riskReward: {
      tp1: present(stop) && present(tp1) ? rr(side, entryRef, stop, tp1) : null,
      tp2: present(stop) && present(tp2) ? rr(side, entryRef, stop, tp2) : null,
      tp3: present(stop) && present(tp3) ? rr(side, entryRef, stop, tp3) : null
    },
    invalidationLevel: invalidation,
    geometryErrors
  };
};
