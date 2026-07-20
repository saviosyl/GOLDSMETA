import type { AiExplanation, DecisionDirection, GuardResult, ScoreResult } from "../../models/types";

export const buildFallbackExplanation = (
  decision: DecisionDirection,
  score: ScoreResult,
  guards: GuardResult,
  warnings: string[]
): AiExplanation => {
  const summary =
    decision === "WAIT"
      ? [
          guards.reasonCodes.length > 0
            ? `WAIT because safety guards triggered: ${guards.reasonCodes.join(", ")}.`
            : `WAIT because setup score ${score.score} did not reach BUY/SELL thresholds.`
        ]
      : [
          `${decision} setup score ${score.score} met the deterministic threshold.`,
          "Trade plan uses supplied market price, structural stop loss, and deterministic targets."
        ];

  return {
    summary,
    warnings,
    recommendWait: false,
    modelId: null,
    promptVersion: null,
    safetyDowngraded: false
  };
};
