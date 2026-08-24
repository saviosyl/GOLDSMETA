import { roundPrice, roundRatio } from "../../utils/money";
import type {
  DecisionEngineConfig,
  MarketAnalysisInput,
  ScoreFactor,
  SetupGrade,
  EngineEntryType,
  PrimaryAction,
  ManagementAction
} from "./types";

const present = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const near = (price: number, level: number, atr: number, mult: number): boolean =>
  Math.abs(price - level) <= Math.max(atr * mult, 0.05);

export interface ScoringResult {
  bullishScore: number;
  bearishScore: number;
  breakdown: ScoreFactor[];
  supporting: string[];
  opposing: string[];
  missingWarnings: string[];
  independentBullishFactors: number;
  independentBearishFactors: number;
}

const pushFactor = (
  breakdown: ScoreFactor[],
  factor: string,
  weight: number,
  awarded: number,
  side: ScoreFactor["side"],
  note: string
): void => {
  breakdown.push({
    factor,
    weight: roundRatio(weight),
    awarded: roundRatio(awarded),
    side,
    note
  });
};

export const scoreAnalysis = (
  input: MarketAnalysisInput,
  config: DecisionEngineConfig
): ScoringResult => {
  const breakdown: ScoreFactor[] = [];
  const supporting: string[] = [];
  const opposing: string[] = [];
  const missingWarnings: string[] = [...input.missingFields.map((f) => `Missing indicator: ${f}`)];
  let bullish = 0;
  let bearish = 0;
  let independentBullishFactors = 0;
  let independentBearishFactors = 0;

  const award = (
    side: "BULLISH" | "BEARISH",
    factor: string,
    weight: number,
    fraction: number,
    note: string,
    countsIndependent = true
  ): void => {
    const awarded = weight * Math.max(0, Math.min(1, fraction));
    if (awarded <= 0) {
      pushFactor(breakdown, factor, weight, 0, "NEUTRAL", note);
      return;
    }
    if (side === "BULLISH") {
      bullish += awarded;
      supporting.push(note);
      if (countsIndependent) independentBullishFactors += 1;
    } else {
      bearish += awarded;
      opposing.push(note);
      if (countsIndependent) independentBearishFactors += 1;
    }
    pushFactor(breakdown, factor, weight, awarded, side, note);
  };

  const markMissing = (factor: string, weight: number, field: string): void => {
    missingWarnings.push(`${field} unavailable — confidence reduced`);
    pushFactor(breakdown, factor, weight, 0, "PENALTY", `${field} missing`);
  };

  const w = config.weights;
  const atr = input.atr ?? Math.max(input.currentPrice * 0.0015, 0.5);
  const proximity = config.thresholds.structureProximityAtrMult ?? 0.15;

  // Trend Meter
  if (input.trendMeter.state === "BULLISH") {
    award("BULLISH", "trendMeter", w.trendMeter.bullish, input.trendMeter.strength / 100, `Trend Meter bullish ${input.trendMeter.strength}`);
  } else if (input.trendMeter.state === "BEARISH") {
    award("BEARISH", "trendMeter", w.trendMeter.bearish, input.trendMeter.strength / 100, `Trend Meter bearish ${input.trendMeter.strength}`);
  } else {
    pushFactor(breakdown, "trendMeter", w.trendMeter.bullish, 0, "NEUTRAL", "Trend Meter neutral/unknown");
  }

  // Market structure via candle vs prior levels
  if (present(input.candle.high) && present(input.candle.low) && present(input.nearbyResistance) && present(input.nearbySupport)) {
    if (input.currentPrice > input.nearbyResistance && input.trendMeter.state === "BULLISH") {
      award("BULLISH", "marketStructure", w.marketStructure.bullish, 0.9, "Price accepted above nearby resistance");
    } else if (input.currentPrice < input.nearbySupport && input.trendMeter.state === "BEARISH") {
      award("BEARISH", "marketStructure", w.marketStructure.bearish, 0.9, "Price accepted below nearby support");
    } else if (
      near(input.currentPrice, input.nearbyResistance, atr, proximity) &&
      near(input.currentPrice, input.nearbySupport, atr, proximity)
    ) {
      pushFactor(breakdown, "marketStructure", w.marketStructure.bullish, 0, "PENALTY", "Price in support/resistance conflict zone");
    } else {
      pushFactor(breakdown, "marketStructure", w.marketStructure.bullish, 0, "NEUTRAL", "No decisive structure break");
    }
  } else {
    markMissing("marketStructure", w.marketStructure.bullish, "support/resistance structure");
  }

  // POC
  if (present(input.poc)) {
    if (input.currentPrice > input.poc) {
      award("BULLISH", "pocPosition", w.pocPosition.bullish, 0.85, "Price trading above POC");
    } else if (input.currentPrice < input.poc) {
      award("BEARISH", "pocPosition", w.pocPosition.bearish, 0.85, "Price trading below POC");
    } else {
      pushFactor(breakdown, "pocPosition", w.pocPosition.bullish, 0, "NEUTRAL", "Price at POC");
    }
  } else {
    markMissing("pocPosition", w.pocPosition.bullish, "POC");
  }

  // VAH / VAL — asymmetric: acceptance above VAH is bullish; rejection at VAH is not auto-bearish flip of below VAL
  if (present(input.vah) && present(input.val)) {
    if (input.currentPrice > input.vah) {
      award("BULLISH", "valueArea", w.valueArea.bullish, 0.9, "Price accepted above VAH");
    } else if (input.currentPrice < input.val) {
      award("BEARISH", "valueArea", w.valueArea.bearish, 0.9, "Price accepted below VAL");
    } else if (near(input.currentPrice, input.vah, atr, proximity)) {
      // Near resistance inside value — caution, mild bearish pressure for longs
      award("BEARISH", "valueArea", w.valueArea.bearish, 0.35, "Price pressed into VAH from below");
    } else if (near(input.currentPrice, input.val, atr, proximity)) {
      award("BULLISH", "valueArea", w.valueArea.bullish, 0.35, "Price holding VAL from above");
    } else {
      pushFactor(breakdown, "valueArea", w.valueArea.bullish, 0, "NEUTRAL", "Price inside value area");
    }
  } else {
    markMissing("valueArea", w.valueArea.bullish, "VAH/VAL");
  }

  // VWAP
  if (present(input.vwap)) {
    if (input.currentPrice > input.vwap && input.trendMeter.state !== "BEARISH") {
      award("BULLISH", "vwapAlignment", w.vwapAlignment.bullish, 0.8, "Price above VWAP with non-bearish bias");
    } else if (input.currentPrice < input.vwap && input.trendMeter.state !== "BULLISH") {
      award("BEARISH", "vwapAlignment", w.vwapAlignment.bearish, 0.8, "Price below VWAP with non-bullish bias");
    } else {
      pushFactor(breakdown, "vwapAlignment", w.vwapAlignment.bullish, 0, "NEUTRAL", "VWAP alignment mixed with trend");
    }
  } else {
    markMissing("vwapAlignment", w.vwapAlignment.bullish, "VWAP");
  }

  // EMA stack — bullish needs 21>50>200 or price>21>50; bearish inverse. Not a pure mirror when flat stack.
  if (present(input.ema21) && present(input.ema50) && present(input.ema200)) {
    const bullStack = input.ema21 > input.ema50 && input.ema50 > input.ema200 && input.currentPrice > input.ema21;
    const bearStack = input.ema21 < input.ema50 && input.ema50 < input.ema200 && input.currentPrice < input.ema21;
    if (bullStack) {
      award("BULLISH", "emaAlignment", w.emaAlignment.bullish, 1, "Bullish EMA stack with price above EMA21");
    } else if (bearStack) {
      award("BEARISH", "emaAlignment", w.emaAlignment.bearish, 1, "Bearish EMA stack with price below EMA21");
    } else if (input.currentPrice > input.ema200 && input.ema21 > input.ema50) {
      award("BULLISH", "emaAlignment", w.emaAlignment.bullish, 0.45, "Partial bullish EMA alignment");
    } else if (input.currentPrice < input.ema200 && input.ema21 < input.ema50) {
      award("BEARISH", "emaAlignment", w.emaAlignment.bearish, 0.45, "Partial bearish EMA alignment");
    } else {
      pushFactor(breakdown, "emaAlignment", w.emaAlignment.bullish, 0, "NEUTRAL", "EMA stack mixed");
    }
  } else {
    markMissing("emaAlignment", w.emaAlignment.bullish, "EMA 21/50/200");
  }

  // Confirmation candle
  const conf = input.confirmationCandle;
  if (conf.confirmed) {
    if (conf.state.startsWith("BULLISH")) {
      const strength = conf.state.includes("BREAKOUT") || conf.state.includes("RETEST") ? 1 : 0.75;
      award("BULLISH", "confirmationCandle", w.confirmationCandle.bullish, strength, `Confirmed ${conf.state}`);
    } else if (conf.state.startsWith("BEARISH")) {
      const strength = conf.state.includes("BREAKOUT") || conf.state.includes("RETEST") ? 1 : 0.75;
      award("BEARISH", "confirmationCandle", w.confirmationCandle.bearish, strength, `Confirmed ${conf.state}`);
    } else {
      pushFactor(breakdown, "confirmationCandle", w.confirmationCandle.bullish, 0, "NEUTRAL", "No directional confirmation candle");
    }
  } else {
    pushFactor(breakdown, "confirmationCandle", w.confirmationCandle.bullish, 0, "NEUTRAL", "Confirmation candle not closed/confirmed");
  }

  // Volume
  if (present(input.relativeVolume)) {
    const confirmMult = config.thresholds.volumeConfirmMult ?? 1.2;
    if (input.relativeVolume >= confirmMult && conf.state.startsWith("BULLISH")) {
      award("BULLISH", "volumeConfirmation", w.volumeConfirmation.bullish, 0.9, `Relative volume ${input.relativeVolume.toFixed(2)} confirms bullish candle`);
    } else if (input.relativeVolume >= confirmMult && conf.state.startsWith("BEARISH")) {
      award("BEARISH", "volumeConfirmation", w.volumeConfirmation.bearish, 0.9, `Relative volume ${input.relativeVolume.toFixed(2)} confirms bearish candle`);
    } else {
      pushFactor(breakdown, "volumeConfirmation", w.volumeConfirmation.bullish, 0, "NEUTRAL", "Volume does not confirm direction");
    }
  } else {
    markMissing("volumeConfirmation", w.volumeConfirmation.bullish, "relative volume");
  }

  // RSI — asymmetric: oversold bounce ≠ overbought short automatically without trend
  if (present(input.rsi)) {
    const ob = config.thresholds.rsiOverbought ?? 70;
    const os = config.thresholds.rsiOversold ?? 30;
    if (input.rsi <= os && input.trendMeter.state === "BULLISH") {
      award("BULLISH", "rsiCondition", w.rsiCondition.bullish, 0.7, `RSI oversold (${input.rsi}) with bullish trend`);
    } else if (input.rsi >= ob && input.trendMeter.state === "BEARISH") {
      award("BEARISH", "rsiCondition", w.rsiCondition.bearish, 0.7, `RSI overbought (${input.rsi}) with bearish trend`);
    } else if (input.rsi >= 55 && input.rsi < ob && input.trendMeter.state === "BULLISH") {
      award("BULLISH", "rsiCondition", w.rsiCondition.bullish, 0.4, `RSI constructive (${input.rsi})`);
    } else if (input.rsi <= 45 && input.rsi > os && input.trendMeter.state === "BEARISH") {
      award("BEARISH", "rsiCondition", w.rsiCondition.bearish, 0.4, `RSI constructive for shorts (${input.rsi})`);
    } else {
      pushFactor(breakdown, "rsiCondition", w.rsiCondition.bullish, 0, "NEUTRAL", `RSI ${input.rsi} not aligned`);
    }
  } else {
    markMissing("rsiCondition", w.rsiCondition.bullish, "RSI");
  }

  // Support / resistance proximity — reduce trade aggression near opposite wall
  if (present(input.nearbyResistance) && near(input.currentPrice, input.nearbyResistance, atr, proximity)) {
    award("BEARISH", "supportResistance", w.supportResistance.bearish, 0.55, "Price directly under resistance");
  } else if (present(input.nearbySupport) && near(input.currentPrice, input.nearbySupport, atr, proximity)) {
    award("BULLISH", "supportResistance", w.supportResistance.bullish, 0.55, "Price directly above support");
  } else if (!present(input.nearbySupport) && !present(input.nearbyResistance)) {
    markMissing("supportResistance", w.supportResistance.bullish, "nearby S/R");
  } else {
    pushFactor(breakdown, "supportResistance", w.supportResistance.bullish, 0, "NEUTRAL", "Clear of immediate S/R walls");
  }

  // ATR volatility — prefer readable ATR (not tiny/chaotic). Mild completeness factor.
  if (present(input.atr) && input.atr > 0) {
    const atrPct = input.atr / input.currentPrice;
    if (atrPct >= 0.0004 && atrPct <= 0.01) {
      pushFactor(breakdown, "atrVolatility", w.atrVolatility.bullish, w.atrVolatility.bullish * 0.7, "NEUTRAL", "ATR volatility usable for structure stops");
      bullish += w.atrVolatility.bullish * 0.35;
      bearish += w.atrVolatility.bearish * 0.35;
    } else {
      pushFactor(breakdown, "atrVolatility", w.atrVolatility.bullish, 0, "PENALTY", "ATR extreme — sizing reliability reduced");
    }
  } else {
    markMissing("atrVolatility", w.atrVolatility.bullish, "ATR");
  }

  // Spread factor (positive when tight)
  if (present(input.spread)) {
    const maxSpread = config.thresholds.maxSpread ?? 0.8;
    if (input.spread <= maxSpread * 0.5) {
      pushFactor(breakdown, "spread", w.spread.bullish, w.spread.bullish, "NEUTRAL", `Spread tight (${input.spread})`);
      bullish += w.spread.bullish * 0.5;
      bearish += w.spread.bearish * 0.5;
    } else if (input.spread <= maxSpread) {
      pushFactor(breakdown, "spread", w.spread.bullish, w.spread.bullish * 0.3, "NEUTRAL", `Spread acceptable (${input.spread})`);
    } else {
      pushFactor(breakdown, "spread", w.spread.bullish, 0, "PENALTY", `Spread elevated (${input.spread})`);
    }
  } else {
    markMissing("spread", w.spread.bullish, "spread");
  }

  // News risk — never awards trade direction
  if (input.highImpactNewsActive) {
    pushFactor(breakdown, "newsRisk", 0, 0, "PENALTY", "High-impact news blocking active");
  } else {
    pushFactor(breakdown, "newsRisk", 0, 0, "NEUTRAL", "No high-impact news block");
  }

  // Data completeness
  const expected = [
    "poc",
    "vah",
    "val",
    "vwap",
    "ema21",
    "ema50",
    "ema200",
    "rsi",
    "atr",
    "spread",
    "relativeVolume"
  ];
  const missingCount =
    expected.filter((key) => {
      const value = input[key as keyof MarketAnalysisInput];
      return value === null || value === undefined;
    }).length + input.missingFields.length;
  const completeness = Math.max(0, 1 - missingCount / expected.length);
  const completenessAward = w.dataCompleteness.bullish * completeness;
  pushFactor(
    breakdown,
    "dataCompleteness",
    w.dataCompleteness.bullish,
    completenessAward,
    completeness >= 0.7 ? "NEUTRAL" : "PENALTY",
    `Data completeness ${(completeness * 100).toFixed(0)}%`
  );
  bullish += completenessAward * 0.5;
  bearish += completenessAward * 0.5;

  return {
    bullishScore: roundRatio(bullish),
    bearishScore: roundRatio(bearish),
    breakdown,
    supporting: [...new Set(supporting)],
    opposing: [...new Set(opposing)],
    missingWarnings: [...new Set(missingWarnings)],
    independentBullishFactors,
    independentBearishFactors
  };
};

export const deriveTradeScore = (bullish: number, bearish: number): { tradeScore: number; dominant: "BULLISH" | "BEARISH" | "NONE" } => {
  const net = Math.abs(bullish - bearish);
  const total = bullish + bearish;
  const agreement = total > 0 ? net / total : 0;
  const tradeScore = Math.max(0, Math.min(100, Math.round(net * agreement + Math.min(bullish, bearish) * 0.15)));
  if (bullish - bearish >= 8) return { tradeScore: Math.max(tradeScore, Math.round(bullish)), dominant: "BULLISH" };
  if (bearish - bullish >= 8) return { tradeScore: Math.max(tradeScore, Math.round(bearish)), dominant: "BEARISH" };
  return { tradeScore: Math.min(tradeScore, Math.round(Math.max(bullish, bearish) * 0.6)), dominant: "NONE" };
};

export const gradeFromScore = (
  tradeScore: number,
  primaryAction: PrimaryAction,
  config: DecisionEngineConfig
): SetupGrade => {
  if (primaryAction === "WAIT") return "No Trade";
  if (tradeScore >= config.gradeBands.aPlus) return "A+";
  if (tradeScore >= config.gradeBands.a) return "A";
  if (tradeScore >= config.gradeBands.b) return "B";
  if (tradeScore >= config.gradeBands.c) return "C";
  return "No Trade";
};

export const mapEntryType = (
  action: PrimaryAction,
  confirmation: MarketAnalysisInput["confirmationCandle"]["state"]
): EngineEntryType => {
  if (action === "WAIT") return "none";
  if (confirmation.includes("BREAKOUT")) return "breakout";
  if (confirmation.includes("RETEST")) return "retest";
  if (confirmation.includes("REJECTION") || confirmation.includes("CONTINUATION")) return "limit";
  return "market";
};

export const defaultManagementForAction = (action: PrimaryAction): ManagementAction => {
  if (action === "WAIT") return "WAIT_FOR_CLOSE";
  return "ENTER";
};

export { roundPrice, roundRatio, present, near };
