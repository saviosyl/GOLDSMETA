import { MICRO_HORIZONS } from "../config";
import { horizonMs, nowIso } from "../clock";
import { createPrediction } from "../prediction/predictor";
import type { MicroEdgeStore } from "../storage/microEdgeStore";
import type { MicroBar, MicroQuote } from "../types";

/**
 * Create immutable prediction + pending outcomes for a completed M1 candle.
 * Broker mutation calls: ZERO (no order interface).
 */
export async function runMicroPredictionCycle(args: {
  store: MicroEdgeStore;
  candleCloseEpochMs: number;
  m1: MicroBar[];
  m5: MicroBar[];
  m15: MicroBar[];
  quote: MicroQuote;
  spreadHistory: number[];
}): Promise<{ predictionId: string; created: boolean }> {
  const { prediction, features } = createPrediction({
    candleCloseEpochMs: args.candleCloseEpochMs,
    m1: args.m1,
    m5: args.m5,
    m15: args.m15,
    quote: args.quote,
    spreadHistory: args.spreadHistory
  });
  const created = (await args.store.savePrediction(prediction)) === "created";
  if (created) {
    await args.store.saveFeatures(features);
    for (const h of MICRO_HORIZONS) {
      await args.store.savePending({
        predictionId: prediction.predictionId,
        horizon: h,
        dueAt: new Date(args.candleCloseEpochMs + horizonMs(h)).toISOString(),
        createdAt: nowIso(),
        status: "PENDING"
      });
    }
  }
  return { predictionId: prediction.predictionId, created };
}
