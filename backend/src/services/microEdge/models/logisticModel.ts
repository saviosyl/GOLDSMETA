/**
 * Interpretable regularized multinomial logistic champion (Model A).
 * Deterministic frozen coefficients for V1 — trained offline conceptually on
 * chronological windows; coefficients are versioned constants here.
 */
import {
  MICRO_CALIBRATION_VERSION,
  MICRO_MODEL_VERSION
} from "../config";
import { CHAMPION_FEATURE_KEYS } from "../features/buildFeatureVector";
import type { MicroModel, MicroModelOutput } from "./modelInterface";
import { normalizeProbs } from "./modelInterface";

/** Frozen coefficient tables (feature -> weight) for three classes. */
const W_UP: Record<string, number> = {
  ret_5m: 1.2,
  mom_5m: 0.9,
  mom_short_vs_long: 0.4,
  m5_breakout_up: 0.5,
  m15_trend_slope: 0.7,
  quote_live: 0.2,
  spread_vs_median: -0.8
};
const W_DOWN: Record<string, number> = {
  ret_5m: -1.2,
  mom_5m: -0.9,
  mom_short_vs_long: -0.4,
  m5_breakout_down: 0.5,
  m15_trend_slope: -0.7,
  quote_live: 0.2,
  spread_vs_median: -0.8
};
const W_NO: Record<string, number> = {
  spread_vs_median: 1.1,
  vol_15m: 0.3,
  quote_live: -0.3,
  range_vs_median: -0.2
};
const B_UP = -0.4;
const B_DOWN = -0.4;
const B_NO = 0.6;

function dot(w: Record<string, number>, v: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(w)) s += (w[k] ?? 0) * (v[k] ?? 0);
  return s;
}

function softmax3(a: number, b: number, c: number): [number, number, number] {
  const m = Math.max(a, b, c);
  const ea = Math.exp(a - m);
  const eb = Math.exp(b - m);
  const ec = Math.exp(c - m);
  const z = ea + eb + ec || 1;
  return [ea / z, eb / z, ec / z];
}

export const logisticChampionModel: MicroModel = {
  version: MICRO_MODEL_VERSION,
  predict(featureValues): MicroModelOutput {
    // Ensure experimental keys are ignored even if present.
    const v: Record<string, number> = {};
    for (const k of CHAMPION_FEATURE_KEYS) v[k] = featureValues[k] ?? 0;
    const [pUp, pDown, pNoEdge] = softmax3(
      dot(W_UP, v) + B_UP,
      dot(W_DOWN, v) + B_DOWN,
      dot(W_NO, v) + B_NO
    );
    const p = normalizeProbs(pUp, pDown, pNoEdge);
    const expectedSignedMove =
      0.15 * (v.mom_5m ?? 0) + 0.05 * (v.m15_trend_slope ?? 0);
    const expectedAbsoluteMove = Math.abs(expectedSignedMove) + 0.05 * (v.vol_15m ?? 0);
    return {
      ...p,
      expectedSignedMove,
      expectedAbsoluteMove: Math.max(0, expectedAbsoluteMove),
      modelVersion: MICRO_MODEL_VERSION,
      calibrationVersion: MICRO_CALIBRATION_VERSION
    };
  }
};

export const logisticTrainingMeta = {
  modelVersion: MICRO_MODEL_VERSION,
  featureVersion: "features-v1.0.0",
  trainingWindow: "chronological-synthetic-v1",
  validationWindow: "chronological-synthetic-v1",
  forwardWindow: "reserved-not-used-for-fit",
  note: "V1 ships frozen interpretable coefficients; replace via versioned offline fit later."
};
