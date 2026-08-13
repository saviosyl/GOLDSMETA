import {
  MICRO_COST_MODEL_VERSION,
  MICRO_EXECUTION_BUFFER,
  MICRO_SLIPPAGE_LATENCY_MS
} from "../config";

/**
 * Prediction-time estimated friction (USD/oz).
 * Uses only past/current observations — never future exit spread.
 *
 * IMPORTANT: outcome-time NET must NOT subtract spread again because
 * executable-side Bid/Ask gross already includes spread.
 */
export function estimateFriction(args: {
  currentSpread: number;
  historicalSpreads: number[];
}): {
  estimatedFriction: number;
  entryHalfSpread: number;
  estimatedExitHalfSpread: number;
  entrySlippageProxy: number;
  exitSlippageProxy: number;
  executionBuffer: number;
  costModelVersion: string;
  slippageMethod: "PROXY";
  assumedLatencyMs: number;
} {
  const hist = args.historicalSpreads.filter((x) => Number.isFinite(x) && x >= 0);
  const sorted = [...hist].sort((a, b) => a - b);
  const q75 =
    sorted.length === 0
      ? args.currentSpread
      : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))]!;
  const entryHalfSpread = args.currentSpread / 2;
  const estimatedExitHalfSpread = Math.max(args.currentSpread, q75) / 2;
  // Conservative latency proxy: fraction of current spread.
  const slip = Math.max(0.01, args.currentSpread * 0.15);
  return {
    estimatedFriction:
      entryHalfSpread +
      estimatedExitHalfSpread +
      slip +
      slip +
      MICRO_EXECUTION_BUFFER,
    entryHalfSpread,
    estimatedExitHalfSpread,
    entrySlippageProxy: slip,
    exitSlippageProxy: slip,
    executionBuffer: MICRO_EXECUTION_BUFFER,
    costModelVersion: MICRO_COST_MODEL_VERSION,
    slippageMethod: "PROXY",
    assumedLatencyMs: MICRO_SLIPPAGE_LATENCY_MS
  };
}

export function netEdgeFromSignedMove(
  expectedSignedMove: number,
  estimatedFriction: number
): { netEdgeUp: number; netEdgeDown: number } {
  return {
    netEdgeUp: expectedSignedMove - estimatedFriction,
    netEdgeDown: -expectedSignedMove - estimatedFriction
  };
}
