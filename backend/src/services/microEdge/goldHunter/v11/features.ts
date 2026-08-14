/**
 * V1.1 feature vector: V1 base + compact interaction features.
 * All computable live without look-ahead.
 */
import { featureVectorToArray } from "../features";
import type { GhFeatureVector } from "../types";
import { GOLD_HUNTER_V11_FEATURE_SCHEMA_VERSION } from "./versions";

export const V11_INTERACTION_KEYS = [
  "ret5OverSpread",
  "ret15OverSpread",
  "ret30OverSpread",
  "mom5OverSpread",
  "range5OverSpread",
  "range15OverSpread",
  "velocityXTickImbalance",
  "velocityXShortVol",
  "dist15HighXVelocity",
  "dist15LowXVelocity",
  "ret5MinusRet30",
  "ret15MinusRet60",
  "bidAskUpdateImbalance",
  "accelerationAbs",
  "breakoutStrength",
  "reversalPressure",
  "volPercentileProxy",
  "spreadNormMomentum"
] as const;

export type V11InteractionKey = (typeof V11_INTERACTION_KEYS)[number];

export function v11FeatureSchemaVersion(): string {
  return GOLD_HUNTER_V11_FEATURE_SCHEMA_VERSION;
}

/** Append interaction features to V1 numeric vector. */
export function featureVectorToV11Array(f: GhFeatureVector): number[] {
  const base = featureVectorToArray(f);
  const eps = Math.max(f.spread, 1e-6);
  const bidAskImb =
    f.bidUpdateCount + f.askUpdateCount === 0
      ? 0
      : (f.bidUpdateCount - f.askUpdateCount) /
        (f.bidUpdateCount + f.askUpdateCount);
  const breakoutStrength =
    f.dist15High < eps * 0.5
      ? Math.max(0, f.velocity)
      : f.dist15Low < eps * 0.5
        ? Math.max(0, -f.velocity)
        : 0;
  const reversalPressure =
    f.ret5 * f.ret30 < 0 ? Math.abs(f.ret5) - Math.abs(f.ret30) : 0;
  const interactions: number[] = [
    f.ret5 / eps,
    f.ret15 / eps,
    f.ret30 / eps,
    f.mom5 / eps,
    f.range5 / eps,
    f.range15 / eps,
    f.velocity * f.tickImbalance,
    f.velocity * f.shortVol,
    f.dist15High * f.velocity,
    f.dist15Low * f.velocity,
    f.ret5 - f.ret30,
    f.ret15 - f.ret60,
    bidAskImb,
    Math.abs(f.acceleration),
    breakoutStrength,
    reversalPressure,
    Math.min(1, f.shortVol * 10000), // proxy percentile-like scale
    f.mom5 / Math.max(f.spreadOverMedian, 1e-6)
  ];
  return [...base, ...interactions];
}

export type FeatureAuditRow = {
  key: string;
  variance: number;
  dropped: boolean;
  reason: string | null;
};

/** Drop near-zero-variance features (TRAIN only). Returns kept indices + audit. */
export function auditAndSelectFeatures(
  trainX: number[][],
  keyNames: string[],
  minVariance = 1e-12
): { keptIndices: number[]; audit: FeatureAuditRow[]; droppedKeys: string[] } {
  if (!trainX.length) {
    return { keptIndices: [], audit: [], droppedKeys: [] };
  }
  const d = trainX[0]!.length;
  const audit: FeatureAuditRow[] = [];
  const keptIndices: number[] = [];
  const droppedKeys: string[] = [];
  for (let j = 0; j < d; j++) {
    let mean = 0;
    for (const r of trainX) mean += r[j]!;
    mean /= trainX.length;
    let v = 0;
    for (const r of trainX) {
      const dlt = r[j]! - mean;
      v += dlt * dlt;
    }
    v /= Math.max(1, trainX.length - 1);
    const key = keyNames[j] ?? `f${j}`;
    const drop = !(v >= minVariance) || !Number.isFinite(v);
    audit.push({
      key,
      variance: v,
      dropped: drop,
      reason: drop ? "near_zero_variance" : null
    });
    if (!drop) keptIndices.push(j);
    else droppedKeys.push(key);
  }
  return { keptIndices, audit, droppedKeys };
}

export function projectFeatures(
  X: number[][],
  keptIndices: number[]
): number[][] {
  return X.map((r) => keptIndices.map((i) => r[i]!));
}

export function v11FeatureKeyNames(baseKeys: readonly string[]): string[] {
  return [...baseKeys, ...V11_INTERACTION_KEYS];
}
