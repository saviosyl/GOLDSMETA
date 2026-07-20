import { loadDecisionEngineConfig, DEFAULT_DECISION_ENGINE_VERSION } from "./configLoader";
import { deriveConfidence } from "./confidence";
import { evaluateEngineGuards } from "./guards";
import {
  defaultManagementForAction,
  deriveTradeScore,
  gradeFromScore,
  mapEntryType,
  scoreAnalysis
} from "./scoring";
import { buildEngineTradePlan } from "./tradePlan";
import {
  decisionEngineResultSchema,
  marketAnalysisInputSchema,
  type DecisionEngineResult,
  type MarketAnalysisInput,
  type PrimaryAction
} from "./types";

export interface EvaluateDecisionOptions {
  configVersion?: string;
  evaluatedAt?: string;
}

const pickTentative = (
  dominant: "BULLISH" | "BEARISH" | "NONE",
  tradeScore: number,
  minBuy: number,
  minSell: number
): PrimaryAction => {
  if (dominant === "BULLISH" && tradeScore >= minBuy) return "BUY";
  if (dominant === "BEARISH" && tradeScore >= minSell) return "SELL";
  return "WAIT";
};

/**
 * Deterministic decision engine.
 * Same inputs + config version => same result.
 * Never returns conflicting BUY+SELL. Never executes broker orders.
 */
export const evaluateDecision = (
  rawInput: MarketAnalysisInput,
  options: EvaluateDecisionOptions = {}
): DecisionEngineResult => {
  const configVersion = options.configVersion ?? DEFAULT_DECISION_ENGINE_VERSION;
  const config = loadDecisionEngineConfig(configVersion);
  const evaluatedAt = options.evaluatedAt ?? rawInput.evaluatedAt ?? new Date().toISOString();
  const input = marketAnalysisInputSchema.parse({
    ...rawInput,
    evaluatedAt
  });

  const scoring = scoreAnalysis(input, config);
  const { tradeScore: rawTradeScore, dominant } = deriveTradeScore(
    scoring.bullishScore,
    scoring.bearishScore
  );

  let primaryAction = pickTentative(
    dominant,
    rawTradeScore,
    config.thresholds.minTradeScoreToBuy ?? 62,
    config.thresholds.minTradeScoreToSell ?? 62
  );

  const entryType = mapEntryType(primaryAction, input.confirmationCandle.state);
  let plan = buildEngineTradePlan(input, primaryAction, config, entryType);

  // Seed safety flags from immutable market conditions before confidence
  const seedFlags: string[] = [];
  if (input.isStale) seedFlags.push("STALE_DATA");
  const evaluatedMs = Date.parse(evaluatedAt);
  const marketMs = Date.parse(input.marketDataTime);
  if (
    Number.isFinite(evaluatedMs) &&
    Number.isFinite(marketMs) &&
    evaluatedMs - marketMs > (config.thresholds.staleAfterMs ?? 300000)
  ) {
    seedFlags.push("STALE_DATA");
  }
  if (input.spread != null && input.spread > (config.thresholds.maxSpread ?? 0.8)) {
    seedFlags.push("EXCESSIVE_SPREAD");
  }
  if (input.highImpactNewsActive) seedFlags.push("HIGH_IMPACT_NEWS");

  let confidence = deriveConfidence(config, scoring, rawTradeScore, seedFlags);
  let guards = evaluateEngineGuards(input, config, scoring, primaryAction, plan, confidence);
  const allFlags = [...new Set([...seedFlags, ...guards.flags])];
  confidence = deriveConfidence(config, scoring, rawTradeScore, allFlags);

  if (
    guards.forceWait ||
    allFlags.includes("STALE_DATA") ||
    allFlags.includes("EXCESSIVE_SPREAD") ||
    allFlags.includes("HIGH_IMPACT_NEWS") ||
    allFlags.includes("STRUCTURE_CONFLICT_ZONE") ||
    allFlags.includes("INDICATOR_DISAGREEMENT") ||
    allFlags.includes("INSUFFICIENT_CONFIRMATION") ||
    allFlags.includes("POOR_RISK_REWARD") ||
    allFlags.includes("INVALID_GEOMETRY") ||
    confidence < (config.thresholds.minConfidenceToTrade ?? 65)
  ) {
    primaryAction = "WAIT";
  }

  const finalEntryType = mapEntryType(primaryAction, input.confirmationCandle.state);
  plan = buildEngineTradePlan(input, primaryAction, config, finalEntryType);
  if (primaryAction !== "WAIT") {
    guards = evaluateEngineGuards(input, config, scoring, primaryAction, plan, confidence);
    if (guards.forceWait) {
      primaryAction = "WAIT";
      plan = buildEngineTradePlan(input, "WAIT", config, "none");
    }
  }

  const tradeScore =
    primaryAction === "WAIT" ? Math.min(rawTradeScore, 60) : Math.min(100, rawTradeScore);
  const setupGrade = gradeFromScore(tradeScore, primaryAction, config);

  const bullishNotes = scoring.supporting;
  const bearishNotes = scoring.opposing;
  const supportingReasons =
    primaryAction === "BUY"
      ? bullishNotes
      : primaryAction === "SELL"
        ? bearishNotes
        : [...bullishNotes.slice(0, 3), ...bearishNotes.slice(0, 2)];
  const opposingReasons =
    primaryAction === "BUY"
      ? bearishNotes
      : primaryAction === "SELL"
        ? bullishNotes
        : [...bearishNotes.slice(0, 3), ...bullishNotes.slice(0, 2)];

  const safetyFlags =
    primaryAction === "WAIT"
      ? [...new Set([...allFlags, ...guards.flags])]
      : [];

  const explanation =
    primaryAction === "WAIT"
      ? `WAIT — ${safetyFlags.length ? `blocked by ${safetyFlags.join(", ")}.` : "score/confidence insufficient for a directional trade."} Analysis only — not an executed trade.`
      : `${primaryAction} graded ${setupGrade} (score ${tradeScore}, confidence ${confidence}%). Entry ${finalEntryType}; SL ${plan.stopLoss ?? "n/a"}; RR TP2 ${plan.riskReward.tp2 ?? "n/a"}. Analysis only — not an executed broker order. No martingale or loss-chasing.`;

  const result: DecisionEngineResult = {
    schemaVersion: "1.0",
    configVersion: config.version,
    symbol: "XAUUSD",
    timeframe: input.timeframe,
    evaluatedAt,
    primaryAction,
    confidence,
    tradeScore,
    setupGrade: primaryAction === "WAIT" ? "No Trade" : setupGrade,
    trend: input.trendMeter.state,
    entryType: primaryAction === "WAIT" ? "none" : finalEntryType,
    entryRange: plan.entryRange,
    stopLoss: plan.stopLoss,
    takeProfits: plan.takeProfits,
    riskReward: plan.riskReward,
    invalidationLevel: plan.invalidationLevel,
    supportingReasons: [...new Set(supportingReasons)].slice(0, 8),
    opposingReasons: [...new Set(opposingReasons)].slice(0, 8),
    missingDataWarnings: [...new Set([...scoring.missingWarnings, ...guards.warnings])].slice(0, 12),
    recommendedManagementAction: defaultManagementForAction(primaryAction),
    explanation,
    scoreBreakdown: scoring.breakdown,
    bullishScore: scoring.bullishScore,
    bearishScore: scoring.bearishScore,
    safetyFlags,
    analysisOnly: true
  };

  return decisionEngineResultSchema.parse(result);
};
