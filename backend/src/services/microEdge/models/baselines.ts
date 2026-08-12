import type { MicroModel, MicroModelOutput } from "./modelInterface";
import { normalizeProbs } from "./modelInterface";

export const alwaysNoEdgeBaseline: MicroModel = {
  version: "baseline-always-no-edge-v1",
  predict(): MicroModelOutput {
    return {
      pUp: 0,
      pDown: 0,
      pNoEdge: 1,
      expectedSignedMove: 0,
      expectedAbsoluteMove: 0,
      modelVersion: "baseline-always-no-edge-v1",
      calibrationVersion: "calibration-none-v1.0.0"
    };
  }
};

export const momentumSignBaseline: MicroModel = {
  version: "baseline-mom5-sign-v1",
  predict(v): MicroModelOutput {
    const mom = v.mom_5m ?? 0;
    const raw =
      mom > 0
        ? { pUp: 0.45, pDown: 0.25, pNoEdge: 0.3 }
        : mom < 0
          ? { pUp: 0.25, pDown: 0.45, pNoEdge: 0.3 }
          : { pUp: 0.2, pDown: 0.2, pNoEdge: 0.6 };
    const p = normalizeProbs(raw.pUp, raw.pDown, raw.pNoEdge);
    return {
      ...p,
      expectedSignedMove: mom * 0.2,
      expectedAbsoluteMove: Math.abs(mom * 0.2),
      modelVersion: "baseline-mom5-sign-v1",
      calibrationVersion: "calibration-none-v1.0.0"
    };
  }
};
