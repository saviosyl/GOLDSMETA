import { createHash } from "node:crypto";
import type { V11PolicyConfig } from "./policy";
import {
  GOLD_HUNTER_V11_FEATURE_SCHEMA_VERSION,
  GOLD_HUNTER_V11_MODEL_RESEARCH_VERSION,
  GOLD_HUNTER_V11_STRATEGY_VERSION,
  type V11ModelFamily
} from "./versions";

export type FrozenV11Config = {
  researchRunId: string;
  strategyVersion: typeof GOLD_HUNTER_V11_STRATEGY_VERSION;
  modelResearchVersion: typeof GOLD_HUNTER_V11_MODEL_RESEARCH_VERSION;
  featureSchemaVersion: typeof GOLD_HUNTER_V11_FEATURE_SCHEMA_VERSION;
  modelFamily: V11ModelFamily;
  datasetHash: string;
  policy: V11PolicyConfig;
  keptFeatureIndices: number[];
  trainRangeUtc: { from: string; to: string };
  validationRangeUtc: { from: string; to: string };
  holdoutRangeUtc: { from: string; to: string };
  holdoutSealed: true;
  createdAt: string;
};

/** Hash excludes createdAt so freeze identity is deterministic. */
export function hashFrozenV11(cfg: FrozenV11Config): string {
  const { createdAt: _c, ...rest } = cfg;
  void _c;
  return createHash("sha256")
    .update(JSON.stringify(rest, Object.keys(rest).sort()))
    .digest("hex");
}

export function buildFrozenV11(args: {
  researchRunId: string;
  modelFamily: V11ModelFamily;
  datasetHash: string;
  policy: V11PolicyConfig;
  keptFeatureIndices: number[];
  trainRangeUtc: { from: string; to: string };
  validationRangeUtc: { from: string; to: string };
  holdoutRangeUtc: { from: string; to: string };
  createdAt?: string;
}): { config: FrozenV11Config; sha256: string } {
  const config: FrozenV11Config = {
    researchRunId: args.researchRunId,
    strategyVersion: GOLD_HUNTER_V11_STRATEGY_VERSION,
    modelResearchVersion: GOLD_HUNTER_V11_MODEL_RESEARCH_VERSION,
    featureSchemaVersion: GOLD_HUNTER_V11_FEATURE_SCHEMA_VERSION,
    modelFamily: args.modelFamily,
    datasetHash: args.datasetHash,
    policy: args.policy,
    keptFeatureIndices: args.keptFeatureIndices,
    trainRangeUtc: args.trainRangeUtc,
    validationRangeUtc: args.validationRangeUtc,
    holdoutRangeUtc: args.holdoutRangeUtc,
    holdoutSealed: true,
    createdAt: args.createdAt ?? new Date().toISOString()
  };
  return { config, sha256: hashFrozenV11(config) };
}
