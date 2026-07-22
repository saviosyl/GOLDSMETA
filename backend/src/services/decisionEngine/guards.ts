import type { DecisionEngineConfig, MarketAnalysisInput, PrimaryAction } from "./types";
import type { EngineTradePlan } from "./tradePlan";
import type { ScoringResult } from "./scoring";
import { near, present } from "./scoring";

export interface GuardEvaluation {
  forceWait: boolean;
  flags: string[];
  warnings: string[];
}

export const evaluateEngineGuards = (
  input: MarketAnalysisInput,
  config: DecisionEngineConfig,
  scoring: ScoringResult,
  tentative: PrimaryAction,
  plan: EngineTradePlan,
  confidence: number
): GuardEvaluation => {
  const flags: string[] = [];
  const warnings: string[] = [...scoring.missingWarnings];

  if (input.isStale) {
    flags.push("STALE_DATA");
  }

  const evaluatedAt = Date.parse(input.evaluatedAt ?? new Date().toISOString());
  const marketTime = Date.parse(input.marketDataTime);
  if (Number.isFinite(evaluatedAt) && Number.isFinite(marketTime)) {
    if (evaluatedAt - marketTime > (config.thresholds.staleAfterMs ?? 300000)) {
      flags.push("STALE_DATA");
    }
  }

  if (present(input.spread) && input.spread > (config.thresholds.maxSpread ?? 0.8)) {
    flags.push("EXCESSIVE_SPREAD");
  }

  if (input.highImpactNewsActive) {
    flags.push("HIGH_IMPACT_NEWS");
  }

  const atr = input.atr ?? Math.max(input.currentPrice * 0.0015, 0.5);
  const prox = config.thresholds.structureProximityAtrMult ?? 0.15;
  if (
    present(input.nearbyResistance) &&
    present(input.nearbySupport) &&
    near(input.currentPrice, input.nearbyResistance, atr, prox) &&
    near(input.currentPrice, input.nearbySupport, atr, prox)
  ) {
    flags.push("STRUCTURE_CONFLICT_ZONE");
  }

  const gap = Math.abs(scoring.bullishScore - scoring.bearishScore);
  if (
    scoring.bullishScore > 0 &&
    scoring.bearishScore > 0 &&
    gap < (config.thresholds.conflictScoreGapMax ?? 18) &&
    scoring.independentBullishFactors > 0 &&
    scoring.independentBearishFactors > 0
  ) {
    flags.push("INDICATOR_DISAGREEMENT");
  }

  if (confidence < (config.thresholds.minConfidenceToTrade ?? 65)) {
    flags.push("LOW_CONFIDENCE");
  }

  if (tentative !== "WAIT") {
    const minFactors = config.thresholds.minIndependentFactors ?? 3;
    const factors =
      tentative === "BUY" ? scoring.independentBullishFactors : scoring.independentBearishFactors;
    if (factors < minFactors) {
      flags.push("INSUFFICIENT_CONFIRMATION");
    }

    const minTp2 = config.thresholds.minRiskRewardTp2 ?? 1.5;
    const minTp1 = config.thresholds.minRiskRewardTp1 ?? 1.0;
    if (plan.riskReward.tp1 !== null && plan.riskReward.tp1 < minTp1) {
      flags.push("POOR_RISK_REWARD");
    }
    if (plan.riskReward.tp2 === null || plan.riskReward.tp2 < minTp2) {
      flags.push("POOR_RISK_REWARD");
    }
    if (plan.geometryErrors.length > 0) {
      flags.push("INVALID_GEOMETRY");
      warnings.push(...plan.geometryErrors);
    }
  }

  return {
    forceWait: flags.length > 0,
    flags: [...new Set(flags)],
    warnings: [...new Set(warnings)]
  };
};
