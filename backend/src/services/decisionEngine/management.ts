import { loadDecisionEngineConfig, DEFAULT_DECISION_ENGINE_VERSION } from "./configLoader";
import {
  managementResultSchema,
  openPositionInputSchema,
  type ManagementResult,
  type OpenPositionInput
} from "./types";
import { present, roundRatio } from "./scoring";

export interface EvaluateManagementOptions {
  configVersion?: string;
}

/**
 * Separate management evaluator for an existing position.
 * Returns exactly one action: HOLD | TAKE_PARTIAL | MOVE_SL_TO_BREAKEVEN | EXIT_EARLY.
 * Never submits broker orders.
 */
export const evaluateManagement = (
  rawInput: OpenPositionInput,
  options: EvaluateManagementOptions = {}
): ManagementResult => {
  const configVersion = options.configVersion ?? DEFAULT_DECISION_ENGINE_VERSION;
  const config = loadDecisionEngineConfig(configVersion);
  const input = openPositionInputSchema.parse(rawInput);
  const reasons: string[] = [];

  const risk = Math.abs(input.entryPrice - input.stopLoss);
  const rawMove =
    input.side === "BUY" ? input.currentPrice - input.entryPrice : input.entryPrice - input.currentPrice;
  const currentR = risk > 0 ? roundRatio(rawMove / risk) : 0;

  // Priority: EXIT_EARLY > TAKE_PARTIAL > MOVE_SL_TO_BREAKEVEN > HOLD
  if (input.isStale) {
    reasons.push("Market data is stale");
  }
  if (input.highImpactNewsActive) {
    reasons.push("High-impact news active");
  }
  if (present(input.spread) && input.spread > (config.thresholds.maxSpread ?? 0.8)) {
    reasons.push(`Spread elevated at ${input.spread}`);
  }

  const oppositeCandle =
    (input.side === "BUY" && input.confirmationCandle.confirmed && input.confirmationCandle.state.startsWith("BEARISH")) ||
    (input.side === "SELL" && input.confirmationCandle.confirmed && input.confirmationCandle.state.startsWith("BULLISH"));

  const trendDeteriorating =
    (input.side === "BUY" &&
      input.trendMeter.state === "BEARISH" &&
      input.trendMeter.strength >= (config.management.trendDeteriorationStrength ?? 55)) ||
    (input.side === "SELL" &&
      input.trendMeter.state === "BULLISH" &&
      input.trendMeter.strength >= (config.management.trendDeteriorationStrength ?? 55));

  const lostPoc =
    (input.side === "BUY" && present(input.poc) && input.currentPrice < input.poc) ||
    (input.side === "SELL" && present(input.poc) && input.currentPrice > input.poc);

  const lostVwap =
    (input.side === "BUY" && present(input.vwap) && input.currentPrice < input.vwap) ||
    (input.side === "SELL" && present(input.vwap) && input.currentPrice > input.vwap);

  const volumeReversal =
    present(input.relativeVolume) &&
    input.relativeVolume >= (config.thresholds.volumeConfirmMult ?? 1.2) &&
    oppositeCandle;

  if (
    currentR <= (config.management.earlyExitAdverseR ?? -0.6) ||
    (trendDeteriorating && (lostPoc || lostVwap || oppositeCandle)) ||
    (input.isStale && currentR < 0) ||
    (input.highImpactNewsActive && currentR < 0.3) ||
    volumeReversal
  ) {
    if (currentR <= (config.management.earlyExitAdverseR ?? -0.6)) {
      reasons.push(`Adverse excursion ${currentR}R`);
    }
    if (trendDeteriorating) reasons.push("Trend deteriorated against position");
    if (lostPoc) reasons.push("Price lost POC versus trade direction");
    if (lostVwap) reasons.push("Price lost VWAP versus trade direction");
    if (oppositeCandle) reasons.push("Opposite confirmation candle printed");
    if (volumeReversal) reasons.push("Volume confirms reversal candle");
    return managementResultSchema.parse({
      schemaVersion: "1.0",
      configVersion: config.version,
      action: "EXIT_EARLY",
      currentR,
      reasons: [...new Set(reasons)],
      explanation: "EXIT_EARLY — risk and structure no longer support holding. Analysis only; not an automated broker close.",
      analysisOnly: true
    });
  }

  const tp1 = input.takeProfits.tp1;
  const reachedPartial =
    input.tp1Hit ||
    currentR >= (config.management.partialProfitR ?? 1.0) ||
    (present(tp1) &&
      ((input.side === "BUY" && input.currentPrice >= tp1) ||
        (input.side === "SELL" && input.currentPrice <= tp1)));

  if (reachedPartial && currentR >= (config.management.partialProfitR ?? 1.0) * 0.85) {
    reasons.push(`TP progress reached (~${currentR}R)`);
    return managementResultSchema.parse({
      schemaVersion: "1.0",
      configVersion: config.version,
      action: "TAKE_PARTIAL",
      currentR,
      reasons: [...new Set(reasons)],
      explanation: "TAKE_PARTIAL — first objective area reached. Analysis only; not an automated broker order.",
      analysisOnly: true
    });
  }

  if (currentR >= (config.management.breakevenAfterR ?? 0.8)) {
    reasons.push(`Open profit ${currentR}R supports moving stop to breakeven`);
    return managementResultSchema.parse({
      schemaVersion: "1.0",
      configVersion: config.version,
      action: "MOVE_SL_TO_BREAKEVEN",
      currentR,
      reasons: [...new Set(reasons)],
      explanation: "MOVE_SL_TO_BREAKEVEN — enough progress to protect capital. Analysis only.",
      analysisOnly: true
    });
  }

  reasons.push(`Position open at ${currentR}R with no management trigger`);
  return managementResultSchema.parse({
    schemaVersion: "1.0",
    configVersion: config.version,
    action: "HOLD",
    currentR,
    reasons: [...new Set(reasons)],
    explanation: "HOLD — structure and risk remain acceptable. Analysis only.",
    analysisOnly: true
  });
};
