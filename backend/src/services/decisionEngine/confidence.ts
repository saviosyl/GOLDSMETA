import type { DecisionEngineConfig } from "./types";
import type { ScoringResult } from "./scoring";

export const deriveConfidence = (
  config: DecisionEngineConfig,
  scoring: ScoringResult,
  tradeScore: number,
  safetyFlags: string[]
): number => {
  const total = scoring.bullishScore + scoring.bearishScore;
  const agreement = total > 0 ? Math.abs(scoring.bullishScore - scoring.bearishScore) / total : 0;

  let confidence = tradeScore * 0.55 + agreement * 40;

  // Data completeness from missing warnings
  confidence -= scoring.missingWarnings.length * (config.penalties.missingIndicator ?? 4);

  if (safetyFlags.includes("INDICATOR_DISAGREEMENT")) {
    confidence -= config.penalties.indicatorDisagreement ?? 12;
  }
  if (safetyFlags.includes("STALE_DATA")) {
    confidence -= config.penalties.staleData ?? 25;
  }
  if (safetyFlags.includes("EXCESSIVE_SPREAD")) {
    confidence -= config.penalties.excessiveSpread ?? 20;
  }
  if (safetyFlags.includes("HIGH_IMPACT_NEWS")) {
    confidence -= config.penalties.highImpactNews ?? 30;
  }
  if (safetyFlags.includes("STRUCTURE_CONFLICT_ZONE")) {
    confidence -= config.penalties.insideConflictZone ?? 20;
  }
  if (safetyFlags.includes("POOR_RISK_REWARD")) {
    confidence -= config.penalties.poorRiskReward ?? 18;
  }
  if (safetyFlags.includes("INVALID_GEOMETRY")) {
    confidence -= config.penalties.invalidGeometry ?? 25;
  }

  return Math.max(0, Math.min(100, Math.round(confidence)));
};
