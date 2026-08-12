import type { MicroClass } from "../types";

export type MicroModelOutput = {
  pUp: number;
  pDown: number;
  pNoEdge: number;
  expectedSignedMove: number;
  expectedAbsoluteMove: number;
  modelVersion: string;
  calibrationVersion: string;
};

export type MicroModel = {
  version: string;
  predict(featureValues: Record<string, number>): MicroModelOutput;
};

export function normalizeProbs(pUp: number, pDown: number, pNoEdge: number): {
  pUp: number;
  pDown: number;
  pNoEdge: number;
} {
  const a = Math.max(0, pUp);
  const b = Math.max(0, pDown);
  const c = Math.max(0, pNoEdge);
  const s = a + b + c || 1;
  return { pUp: a / s, pDown: b / s, pNoEdge: c / s };
}

export function argmaxClass(p: {
  pUp: number;
  pDown: number;
  pNoEdge: number;
}): MicroClass {
  if (p.pUp >= p.pDown && p.pUp >= p.pNoEdge) return "UP_TRADEABLE";
  if (p.pDown >= p.pUp && p.pDown >= p.pNoEdge) return "DOWN_TRADEABLE";
  return "NO_EDGE";
}
