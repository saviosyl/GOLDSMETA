/**
 * Frozen config artifact — written AFTER validation selection, BEFORE holdout.
 */
import { createHash } from "node:crypto";
import type { EntryThresholds } from "./signalPolicy";
import {
  GOLD_HUNTER_FEATURE_SCHEMA_VERSION,
  GOLD_HUNTER_MODEL_VERSION,
  GOLD_HUNTER_STRATEGY_VERSION
} from "./config";

export type FrozenGoldHunterConfig = {
  researchRunId: string;
  strategyVersion: string;
  modelVersion: string;
  featureSchemaVersion: string;
  dataSource: "PEPPERSTONE_DEMO_REAL" | "SYNTHETIC_SMOKE";
  datasetHash: string;
  theta: number;
  entry: EntryThresholds;
  maxHoldSec: number;
  protectiveStop: number;
  labelFriction: {
    entrySlippage: number;
    exitSlippage: number;
    executionBuffer: number;
  };
  trainRangeUtc: { from: string; to: string };
  validationRangeUtc: { from: string; to: string };
  holdoutRangeUtc: { from: string; to: string };
  /** Set only after freeze — holdout must not have been used. */
  holdoutSealed: true;
  createdAt: string;
};

export function utcIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function hashFrozenConfig(cfg: FrozenGoldHunterConfig): string {
  const canonical = JSON.stringify(cfg, Object.keys(cfg).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildFrozenConfig(args: {
  researchRunId: string;
  dataSource: FrozenGoldHunterConfig["dataSource"];
  datasetHash: string;
  theta: number;
  entry: EntryThresholds;
  maxHoldSec: number;
  protectiveStop: number;
  labelFriction: FrozenGoldHunterConfig["labelFriction"];
  trainRange: { fromMs: number; toMs: number };
  validationRange: { fromMs: number; toMs: number };
  holdoutRange: { fromMs: number; toMs: number };
}): { config: FrozenGoldHunterConfig; sha256: string } {
  const config: FrozenGoldHunterConfig = {
    researchRunId: args.researchRunId,
    strategyVersion: GOLD_HUNTER_STRATEGY_VERSION,
    modelVersion: GOLD_HUNTER_MODEL_VERSION,
    featureSchemaVersion: GOLD_HUNTER_FEATURE_SCHEMA_VERSION,
    dataSource: args.dataSource,
    datasetHash: args.datasetHash,
    theta: args.theta,
    entry: args.entry,
    maxHoldSec: args.maxHoldSec,
    protectiveStop: args.protectiveStop,
    labelFriction: args.labelFriction,
    trainRangeUtc: {
      from: utcIso(args.trainRange.fromMs),
      to: utcIso(args.trainRange.toMs)
    },
    validationRangeUtc: {
      from: utcIso(args.validationRange.fromMs),
      to: utcIso(args.validationRange.toMs)
    },
    holdoutRangeUtc: {
      from: utcIso(args.holdoutRange.fromMs),
      to: utcIso(args.holdoutRange.toMs)
    },
    holdoutSealed: true,
    createdAt: new Date().toISOString()
  };
  return { config, sha256: hashFrozenConfig(config) };
}
