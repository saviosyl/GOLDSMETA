import { createHash } from "node:crypto";
import type { V12PolicyConfig } from "./policy";
import {
  GOLD_HUNTER_V12_FEATURE_SCHEMA_VERSION,
  GOLD_HUNTER_V12_MODEL_RESEARCH_VERSION,
  GOLD_HUNTER_V12_STRATEGY_VERSION,
  type V12ModelFamily
} from "./versions";

export type FrozenV12Config = {
  researchRunId: string;
  strategyVersion: typeof GOLD_HUNTER_V12_STRATEGY_VERSION;
  modelResearchVersion: typeof GOLD_HUNTER_V12_MODEL_RESEARCH_VERSION;
  featureSchemaVersion: typeof GOLD_HUNTER_V12_FEATURE_SCHEMA_VERSION;
  modelFamily: V12ModelFamily;
  datasetHash: string;
  policy: V12PolicyConfig;
  keptFeatureIndices: number[];
  walkForwardFolds: number;
  holdoutRangeUtc: { from: string; to: string };
  holdoutSealed: true;
  knownStressNotUsedForTuning: true;
  createdAt: string;
};

export function hashFrozenV12(cfg: FrozenV12Config): string {
  const { createdAt: _c, ...rest } = cfg;
  void _c;
  return createHash("sha256")
    .update(JSON.stringify(rest, Object.keys(rest).sort()))
    .digest("hex");
}

export function buildFrozenV12(args: {
  researchRunId: string;
  modelFamily: V12ModelFamily;
  datasetHash: string;
  policy: V12PolicyConfig;
  keptFeatureIndices: number[];
  walkForwardFolds: number;
  holdoutRangeUtc: { from: string; to: string };
  createdAt?: string;
}): { config: FrozenV12Config; sha256: string } {
  const config: FrozenV12Config = {
    researchRunId: args.researchRunId,
    strategyVersion: GOLD_HUNTER_V12_STRATEGY_VERSION,
    modelResearchVersion: GOLD_HUNTER_V12_MODEL_RESEARCH_VERSION,
    featureSchemaVersion: GOLD_HUNTER_V12_FEATURE_SCHEMA_VERSION,
    modelFamily: args.modelFamily,
    datasetHash: args.datasetHash,
    policy: args.policy,
    keptFeatureIndices: args.keptFeatureIndices,
    walkForwardFolds: args.walkForwardFolds,
    holdoutRangeUtc: args.holdoutRangeUtc,
    holdoutSealed: true,
    knownStressNotUsedForTuning: true,
    createdAt: args.createdAt ?? new Date().toISOString()
  };
  return { config, sha256: hashFrozenV12(config) };
}
