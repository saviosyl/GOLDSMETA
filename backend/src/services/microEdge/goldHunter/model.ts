/**
 * Transparent multinomial logistic regression baseline (no giant opaque deps).
 * Probabilities sum ~1. Calibration from VALIDATION only.
 */
import { createHash } from "node:crypto";
import {
  GH_CALIBRATION_BIN_EDGES,
  GOLD_HUNTER_FEATURE_SCHEMA_VERSION,
  GOLD_HUNTER_MODEL_VERSION,
  GOLD_HUNTER_STRATEGY_VERSION,
  type GhHorizonSec
} from "./config";
import { featureVectorToArray } from "./features";
import type {
  GhClass,
  GhFeatureVector,
  GhHorizonProb,
  GhLabel,
  GhModelArtifact
} from "./types";

const CLASS_INDEX: Record<GhClass, number> = {
  UP_TRADEABLE: 0,
  DOWN_TRADEABLE: 1,
  NO_EDGE: 2
};

export type NormParams = {
  mean: number[];
  std: number[];
};

export function fitNormalization(rows: number[][]): NormParams {
  if (rows.length === 0) return { mean: [], std: [] };
  const d = rows[0]!.length;
  const mean = new Array(d).fill(0);
  for (const r of rows) {
    for (let j = 0; j < d; j++) mean[j]! += r[j]!;
  }
  for (let j = 0; j < d; j++) mean[j]! /= rows.length;
  const std = new Array(d).fill(0);
  for (const r of rows) {
    for (let j = 0; j < d; j++) {
      const dlt = r[j]! - mean[j]!;
      std[j]! += dlt * dlt;
    }
  }
  for (let j = 0; j < d; j++) {
    std[j] = Math.sqrt(std[j]! / Math.max(1, rows.length - 1)) || 1;
  }
  return { mean, std };
}

export function applyNormalization(x: number[], norm: NormParams): number[] {
  return x.map((v, i) => (v - (norm.mean[i] ?? 0)) / (norm.std[i] || 1));
}

function softmax(logits: number[]): number[] {
  const m = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - m));
  const s = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / s);
}

export type SoftmaxModel = {
  weights: number[][]; // [class][feature+1 bias]
  featureDim: number;
};

export function trainMultinomialLogReg(
  X: number[][],
  y: GhClass[],
  opts?: { l2?: number; epochs?: number; lr?: number }
): SoftmaxModel {
  const l2 = opts?.l2 ?? 0.01;
  const epochs = opts?.epochs ?? 60;
  const lr = opts?.lr ?? 0.05;
  const n = X.length;
  const d = n > 0 ? X[0]!.length : 0;
  const W = Array.from({ length: 3 }, () => new Array(d + 1).fill(0));

  for (let ep = 0; ep < epochs; ep++) {
    const grad = Array.from({ length: 3 }, () => new Array(d + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      const logits = [0, 1, 2].map((c) => {
        let z = W[c]![d]!;
        for (let j = 0; j < d; j++) z += W[c]![j]! * xi[j]!;
        return z;
      });
      const probs = softmax(logits);
      const yi = CLASS_INDEX[y[i]!];
      for (let c = 0; c < 3; c++) {
        const err = probs[c]! - (c === yi ? 1 : 0);
        for (let j = 0; j < d; j++) grad[c]![j]! += err * xi[j]!;
        grad[c]![d]! += err;
      }
    }
    for (let c = 0; c < 3; c++) {
      for (let j = 0; j < d; j++) {
        W[c]![j]! -= (lr / Math.max(1, n)) * (grad[c]![j]! + l2 * W[c]![j]!);
      }
      W[c]![d]! -= (lr / Math.max(1, n)) * grad[c]![d]!;
    }
  }
  return { weights: W, featureDim: d };
}

export type ProbTriple = { pUp: number; pDown: number; pNoEdge: number };

export function predictProbs(model: SoftmaxModel, xNorm: number[]): ProbTriple {
  const d = model.featureDim;
  const logits = [0, 1, 2].map((c) => {
    let z = model.weights[c]![d] ?? 0;
    for (let j = 0; j < d; j++) z += (model.weights[c]![j] ?? 0) * (xNorm[j] ?? 0);
    return z;
  });
  const p = softmax(logits);
  return { pUp: p[0]!, pDown: p[1]!, pNoEdge: p[2]! };
}

export function probsSumApproxOne(p: ProbTriple, eps = 1e-6): boolean {
  return Math.abs(p.pUp + p.pDown + p.pNoEdge - 1) < eps;
}

export type CalibrationBin = {
  lo: number;
  hi: number;
  count: number;
  avgRealizedNet: number;
};

export function buildCalibrationBins(
  samples: Array<{ prob: number; realizedNet: number }>,
  edges: readonly number[] = GH_CALIBRATION_BIN_EDGES
): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = samples.filter((s) => s.prob >= lo && s.prob < hi);
    const avg =
      inBin.length > 0
        ? inBin.reduce((a, s) => a + s.realizedNet, 0) / inBin.length
        : 0;
    bins.push({ lo, hi, count: inBin.length, avgRealizedNet: avg });
  }
  const lastLo = edges[edges.length - 1]!;
  const top = samples.filter((s) => s.prob >= lastLo);
  bins.push({
    lo: lastLo,
    hi: 1.01,
    count: top.length,
    avgRealizedNet:
      top.length > 0 ? top.reduce((a, s) => a + s.realizedNet, 0) / top.length : 0
  });
  return bins;
}

export function lookupCalibratedEdge(
  bins: CalibrationBin[],
  prob: number
): number {
  for (const b of bins) {
    if (prob >= b.lo && prob < b.hi && b.count > 0) return b.avgRealizedNet;
  }
  return 0;
}

export type HorizonModelBundle = {
  horizonSec: GhHorizonSec;
  model: SoftmaxModel;
  norm: NormParams;
  calibrationUp: CalibrationBin[];
  calibrationDown: CalibrationBin[];
};

export function trainHorizonModel(
  horizonSec: GhHorizonSec,
  trainFeatures: GhFeatureVector[],
  trainLabels: GhLabel[],
  valFeatures: GhFeatureVector[],
  valLabels: GhLabel[]
): HorizonModelBundle {
  const usable = trainFeatures
    .map((f, i) => ({ f, l: trainLabels[i]! }))
    .filter((x) => x.l.classLabel !== "UNSCORABLE_DATA_GAP");
  const Xraw = usable.map((x) => featureVectorToArray(x.f));
  const norm = fitNormalization(Xraw);
  const X = Xraw.map((r) => applyNormalization(r, norm));
  const y = usable.map((x) => x.l.classLabel as GhClass);
  const model =
    X.length > 0
      ? trainMultinomialLogReg(X, y)
      : { weights: [[], [], []], featureDim: 0 };

  const upSamples: Array<{ prob: number; realizedNet: number }> = [];
  const downSamples: Array<{ prob: number; realizedNet: number }> = [];
  for (let i = 0; i < valFeatures.length; i++) {
    const lab = valLabels[i]!;
    if (lab.classLabel === "UNSCORABLE_DATA_GAP") continue;
    if (lab.netLong == null || lab.netShort == null) continue;
    const xn = applyNormalization(featureVectorToArray(valFeatures[i]!), norm);
    const p = predictProbs(model, xn);
    upSamples.push({ prob: p.pUp, realizedNet: lab.netLong });
    downSamples.push({ prob: p.pDown, realizedNet: lab.netShort });
  }

  return {
    horizonSec,
    model,
    norm,
    calibrationUp: buildCalibrationBins(upSamples),
    calibrationDown: buildCalibrationBins(downSamples)
  };
}

export function predictHorizon(
  bundle: HorizonModelBundle,
  features: GhFeatureVector
): GhHorizonProb {
  const xn = applyNormalization(featureVectorToArray(features), bundle.norm);
  const probs = predictProbs(bundle.model, xn);
  return {
    horizonSec: bundle.horizonSec,
    pUp: probs.pUp,
    pDown: probs.pDown,
    pNoEdge: probs.pNoEdge,
    expectedNetBuy: lookupCalibratedEdge(bundle.calibrationUp, probs.pUp),
    expectedNetSell: lookupCalibratedEdge(bundle.calibrationDown, probs.pDown)
  };
}

export function hashDataset(rows: Array<{ timestampMs: number }>): string {
  const h = createHash("sha256");
  h.update(String(rows.length));
  if (rows[0]) h.update(String(rows[0].timestampMs));
  if (rows[rows.length - 1]) h.update(String(rows[rows.length - 1]!.timestampMs));
  return h.digest("hex").slice(0, 16);
}

export function buildModelArtifact(args: {
  bundles: HorizonModelBundle[];
  trainingRange: { fromMs: number; toMs: number };
  validationRange: { fromMs: number; toMs: number };
  holdoutRange: { fromMs: number; toMs: number };
  labelConfig: GhModelArtifact["labelConfig"];
  entryPolicy: GhModelArtifact["entryPolicy"];
  datasetHash: string;
  qualificationStatus: GhModelArtifact["qualificationStatus"];
  sharedNorm: NormParams;
}): GhModelArtifact {
  const weightsByHorizon = {} as GhModelArtifact["weightsByHorizon"];
  const calibration = {} as GhModelArtifact["calibration"];
  for (const b of args.bundles) {
    const d = b.model.featureDim;
    weightsByHorizon[b.horizonSec] = {
      up: b.model.weights[0]?.slice(0, d) ?? [],
      down: b.model.weights[1]?.slice(0, d) ?? [],
      noEdge: b.model.weights[2]?.slice(0, d) ?? [],
      bias: [
        b.model.weights[0]?.[d] ?? 0,
        b.model.weights[1]?.[d] ?? 0,
        b.model.weights[2]?.[d] ?? 0
      ]
    };
    const edges = new Set([
      ...b.calibrationUp.map((x) => `${x.lo}-${x.hi}`),
      ...b.calibrationDown.map((x) => `${x.lo}-${x.hi}`)
    ]);
    const bins = [...edges].map((key) => {
      const [loS, hiS] = key.split("-");
      const lo = Number(loS);
      const hi = Number(hiS);
      const up = b.calibrationUp.find((x) => x.lo === lo && x.hi === hi);
      const down = b.calibrationDown.find((x) => x.lo === lo && x.hi === hi);
      return {
        lo,
        hi,
        avgNetBuy: up?.avgRealizedNet ?? 0,
        avgNetSell: down?.avgRealizedNet ?? 0,
        n: (up?.count ?? 0) + (down?.count ?? 0)
      };
    });
    calibration[b.horizonSec] = { bins };
  }
  return {
    modelVersion: GOLD_HUNTER_MODEL_VERSION,
    featureSchemaVersion: GOLD_HUNTER_FEATURE_SCHEMA_VERSION,
    strategyVersion: GOLD_HUNTER_STRATEGY_VERSION,
    trainingRange: args.trainingRange,
    validationRange: args.validationRange,
    holdoutRange: args.holdoutRange,
    labelConfig: args.labelConfig,
    entryPolicy: args.entryPolicy,
    normalization: args.sharedNorm,
    weightsByHorizon,
    calibration,
    datasetHash: args.datasetHash,
    createdAt: new Date().toISOString(),
    qualificationStatus: args.qualificationStatus
  };
}

/** Load SoftmaxModel from artifact weights for one horizon. */
export function modelFromArtifact(
  artifact: GhModelArtifact,
  horizon: GhHorizonSec
): HorizonModelBundle {
  const w = artifact.weightsByHorizon[horizon];
  const d = w.up.length;
  const weights = [
    [...w.up, w.bias[0] ?? 0],
    [...w.down, w.bias[1] ?? 0],
    [...w.noEdge, w.bias[2] ?? 0]
  ];
  const cal = artifact.calibration[horizon]?.bins ?? [];
  return {
    horizonSec: horizon,
    model: { weights, featureDim: d },
    norm: artifact.normalization,
    calibrationUp: cal.map((b) => ({
      lo: b.lo,
      hi: b.hi,
      count: b.n,
      avgRealizedNet: b.avgNetBuy
    })),
    calibrationDown: cal.map((b) => ({
      lo: b.lo,
      hi: b.hi,
      count: b.n,
      avgRealizedNet: b.avgNetSell
    }))
  };
}
