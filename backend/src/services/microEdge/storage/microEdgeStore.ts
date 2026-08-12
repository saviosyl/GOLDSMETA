import type {
  MicroFeatureSnapshot,
  MicroOutcome,
  MicroPendingOutcome,
  MicroPerformanceSlice,
  MicroPrediction
} from "../types";

export type MicroEdgeStore = {
  savePrediction(p: MicroPrediction): Promise<"created" | "exists">;
  saveFeatures(f: MicroFeatureSnapshot): Promise<"created" | "exists">;
  getPrediction(id: string): Promise<MicroPrediction | null>;
  listPredictions(limit: number): Promise<MicroPrediction[]>;
  savePending(p: MicroPendingOutcome): Promise<"created" | "exists">;
  listPendingDue(nowIso: string, limit: number): Promise<MicroPendingOutcome[]>;
  saveOutcome(o: MicroOutcome): Promise<"created" | "exists">;
  listOutcomes(limit: number): Promise<MicroOutcome[]>;
  savePerformance(slice: MicroPerformanceSlice): Promise<void>;
  getLatestPrediction(): Promise<MicroPrediction | null>;
};
