import { MICRO_CALIBRATION_VERSION } from "../config";

/**
 * V1: identity calibration (dataset too small for flexible calibrator).
 * Fit only on train/validation — never forward.
 */
export function applyCalibration(p: {
  pUp: number;
  pDown: number;
  pNoEdge: number;
}): { pUp: number; pDown: number; pNoEdge: number; calibrationVersion: string; method: "IDENTITY" } {
  return { ...p, calibrationVersion: MICRO_CALIBRATION_VERSION, method: "IDENTITY" };
}
