import type { DataQualityResult, ScoreResult } from "../../models/types";

export const calculateConfidence = (
  dataQuality: DataQualityResult,
  score: ScoreResult
): { confidence: number; confidenceLabel: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" } => {
  let confidence = 20;

  if (dataQuality.quality === "GOOD") {
    confidence += 35;
  } else if (dataQuality.quality === "PARTIAL") {
    confidence += 15;
  }

  confidence += Math.min(30, Math.abs(score.score) * 0.3);
  confidence += Math.min(15, (score.confirmations ?? 0) * 5);
  confidence -= dataQuality.missingInputs.length * 8;
  confidence -= dataQuality.warnings.length * 6;
  if (dataQuality.quality === "PARTIAL") {
    confidence = Math.min(confidence, 70);
  }

  const clamped = Math.max(0, Math.min(100, Math.round(confidence)));
  const confidenceLabel =
    clamped >= 85 ? "VERY_HIGH" : clamped >= 70 ? "HIGH" : clamped >= 45 ? "MODERATE" : "LOW";

  return {
    confidence: clamped,
    confidenceLabel
  };
};
