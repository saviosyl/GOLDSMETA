/**
 * V1.1 model families:
 * B — independent binary BUY/SELL logistic
 * C — direct expected-edge ridge regression
 * D — lightweight deterministic stump boosting (optional nonlinear)
 *
 * Multinomial V1 baseline remains in ../model.ts
 */
import { createHash } from "node:crypto";
import type { GhHorizonSec } from "../config";
import {
  applyNormalization,
  fitNormalization,
  type NormParams
} from "../model";

export type BinaryLogisticModel = {
  weights: number[]; // features + bias
  featureDim: number;
};

export type RidgeModel = {
  weights: number[]; // features + bias
  featureDim: number;
  trainClipAbs: number;
};

export type Stump = {
  featureIndex: number;
  threshold: number;
  leftValue: number;
  rightValue: number;
};

export type StumpBoostModel = {
  base: RidgeModel;
  stumps: Stump[];
  learningRate: number;
  featureDim: number;
};

function sigmoid(z: number): number {
  if (z >= 20) return 1;
  if (z <= -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function trainBinaryLogistic(
  X: number[][],
  y: number[], // 0/1
  opts?: { l2?: number; epochs?: number; lr?: number }
): BinaryLogisticModel {
  const l2 = opts?.l2 ?? 0.05;
  const epochs = opts?.epochs ?? 50;
  const lr = opts?.lr ?? 0.05;
  const n = X.length;
  const d = n ? X[0]!.length : 0;
  const W = Array.from({ length: d + 1 }, () => 0);
  if (!n || !d) return { weights: W, featureDim: d };

  for (let ep = 0; ep < epochs; ep++) {
    const grad = Array.from({ length: d + 1 }, () => 0);
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      let z = W[d]!;
      for (let j = 0; j < d; j++) z += W[j]! * xi[j]!;
      const p = sigmoid(z);
      const err = p - y[i]!;
      for (let j = 0; j < d; j++) grad[j]! += err * xi[j]!;
      grad[d]! += err;
    }
    for (let j = 0; j < d; j++) {
      grad[j]! = grad[j]! / n + l2 * W[j]!;
      W[j]! -= lr * grad[j]!;
    }
    grad[d]! /= n;
    W[d]! -= lr * grad[d]!;
  }
  return { weights: W, featureDim: d };
}

export function predictBinaryProb(model: BinaryLogisticModel, x: number[]): number {
  let z = model.weights[model.featureDim] ?? 0;
  for (let j = 0; j < model.featureDim; j++) {
    z += (model.weights[j] ?? 0) * (x[j] ?? 0);
  }
  return sigmoid(z);
}

/** Train-only absolute clip for targets (e.g. p99 of |y|). */
export function trainClipAbs(y: number[], q = 0.99): number {
  const a = y.map(Math.abs).filter(Number.isFinite).sort((u, v) => u - v);
  if (!a.length) return 1;
  const idx = Math.min(a.length - 1, Math.floor(q * (a.length - 1)));
  return Math.max(0.05, a[idx]!);
}

export function trainRidgeRegression(
  X: number[][],
  yRaw: number[],
  opts?: { l2?: number; clipAbs?: number }
): RidgeModel {
  const n = X.length;
  const d = n ? X[0]!.length : 0;
  const clip = opts?.clipAbs ?? trainClipAbs(yRaw);
  const y = yRaw.map((v) => Math.max(-clip, Math.min(clip, v)));
  const l2 = opts?.l2 ?? 1.0;
  // Closed-form via coordinate descent (no matrix lib)
  const W = Array.from({ length: d + 1 }, () => 0);
  if (!n || !d) return { weights: W, featureDim: d, trainClipAbs: clip };

  const epochs = 40;
  for (let ep = 0; ep < epochs; ep++) {
    // bias
    let rb = 0;
    for (let i = 0; i < n; i++) {
      let pred = W[d]!;
      const xi = X[i]!;
      for (let j = 0; j < d; j++) pred += W[j]! * xi[j]!;
      rb += y[i]! - pred + W[d]!;
    }
    W[d] = rb / n;
    for (let j = 0; j < d; j++) {
      let num = 0;
      let den = l2;
      for (let i = 0; i < n; i++) {
        const xi = X[i]!;
        let pred = W[d]!;
        for (let k = 0; k < d; k++) pred += W[k]! * xi[k]!;
        const r = y[i]! - pred + W[j]! * xi[j]!;
        num += xi[j]! * r;
        den += xi[j]! * xi[j]!;
      }
      W[j] = den > 0 ? num / den : 0;
    }
  }
  return { weights: W, featureDim: d, trainClipAbs: clip };
}

export function predictRidge(model: RidgeModel, x: number[]): number {
  let z = model.weights[model.featureDim] ?? 0;
  for (let j = 0; j < model.featureDim; j++) {
    z += (model.weights[j] ?? 0) * (x[j] ?? 0);
  }
  return z;
}

function bestStump(
  X: number[][],
  residual: number[],
  featureSample: number[]
): Stump {
  let best: Stump = {
    featureIndex: featureSample[0] ?? 0,
    threshold: 0,
    leftValue: 0,
    rightValue: 0
  };
  let bestLoss = Number.POSITIVE_INFINITY;
  for (const j of featureSample) {
    const vals = X.map((r) => r[j]!).sort((a, b) => a - b);
    const candidates = [
      vals[Math.floor(vals.length * 0.25)]!,
      vals[Math.floor(vals.length * 0.5)]!,
      vals[Math.floor(vals.length * 0.75)]!
    ];
    for (const thr of candidates) {
      let leftSum = 0;
      let leftN = 0;
      let rightSum = 0;
      let rightN = 0;
      for (let i = 0; i < X.length; i++) {
        if (X[i]![j]! <= thr) {
          leftSum += residual[i]!;
          leftN += 1;
        } else {
          rightSum += residual[i]!;
          rightN += 1;
        }
      }
      const lv = leftN ? leftSum / leftN : 0;
      const rv = rightN ? rightSum / rightN : 0;
      let loss = 0;
      for (let i = 0; i < X.length; i++) {
        const pred = X[i]![j]! <= thr ? lv : rv;
        const e = residual[i]! - pred;
        loss += e * e;
      }
      if (loss < bestLoss) {
        bestLoss = loss;
        best = { featureIndex: j, threshold: thr, leftValue: lv, rightValue: rv };
      }
    }
  }
  return best;
}

export function trainStumpBoost(
  X: number[][],
  yRaw: number[],
  opts?: { stumps?: number; lr?: number; clipAbs?: number; maxFitRows?: number }
): StumpBoostModel {
  const clip = opts?.clipAbs ?? trainClipAbs(yRaw);
  const maxFit = opts?.maxFitRows ?? 30_000;
  const stride = X.length > maxFit ? Math.ceil(X.length / maxFit) : 1;
  const Xfit: number[][] = [];
  const yFitRaw: number[] = [];
  for (let i = 0; i < X.length; i += stride) {
    Xfit.push(X[i]!);
    yFitRaw.push(yRaw[i]!);
  }
  const y = yFitRaw.map((v) => Math.max(-clip, Math.min(clip, v)));
  // Fit ridge + stumps entirely on the deterministic subsample for speed.
  const base = trainRidgeRegression(Xfit, y, { clipAbs: clip, l2: 1.5 });
  const residual = y.map((yi, i) => yi - predictRidge(base, Xfit[i]!));
  const stumps: Stump[] = [];
  const lr = opts?.lr ?? 0.35;
  const nStumps = opts?.stumps ?? 8;
  const d = Xfit[0]?.length ?? 0;
  for (let t = 0; t < nStumps; t++) {
    const featureSample: number[] = [];
    for (let j = 0; j < d; j++) {
      if ((j + t * 7) % 3 === 0) featureSample.push(j);
    }
    if (!featureSample.length && d) featureSample.push(t % d);
    const stump = bestStump(Xfit, residual, featureSample);
    stumps.push(stump);
    for (let i = 0; i < Xfit.length; i++) {
      const pred =
        Xfit[i]![stump.featureIndex]! <= stump.threshold
          ? stump.leftValue
          : stump.rightValue;
      residual[i]! -= lr * pred;
    }
  }
  return { base, stumps, learningRate: lr, featureDim: d };
}

export function predictStumpBoost(model: StumpBoostModel, x: number[]): number {
  let z = predictRidge(model.base, x);
  for (const s of model.stumps) {
    const v =
      (x[s.featureIndex] ?? 0) <= s.threshold ? s.leftValue : s.rightValue;
    z += model.learningRate * v;
  }
  return z;
}

export type HorizonBinaryBundle = {
  horizonSec: GhHorizonSec;
  buy: BinaryLogisticModel;
  sell: BinaryLogisticModel;
  norm: NormParams;
  /** Validation-calibrated: p → mean realized net for that side */
  buyCalib: Array<{ lo: number; hi: number; count: number; avgNet: number }>;
  sellCalib: Array<{ lo: number; hi: number; count: number; avgNet: number }>;
};

export type HorizonEdgeBundle = {
  horizonSec: GhHorizonSec;
  longModel: RidgeModel | StumpBoostModel;
  shortModel: RidgeModel | StumpBoostModel;
  kind: "ridge" | "stump_boost";
  norm: NormParams;
};

export function buildProbBins(
  samples: Array<{ score: number; realized: number }>,
  edges: number[] = [0, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 1.01]
): Array<{ lo: number; hi: number; count: number; avgNet: number }> {
  const bins: Array<{ lo: number; hi: number; count: number; avgNet: number }> =
    [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = samples.filter((s) => s.score >= lo && s.score < hi);
    bins.push({
      lo,
      hi,
      count: inBin.length,
      avgNet: inBin.length
        ? inBin.reduce((a, s) => a + s.realized, 0) / inBin.length
        : 0
    });
  }
  return bins;
}

export function lookupBinAvg(
  bins: Array<{ lo: number; hi: number; count: number; avgNet: number }>,
  score: number
): number {
  for (const b of bins) {
    if (score >= b.lo && score < b.hi && b.count > 0) return b.avgNet;
  }
  return 0;
}

export function trainIndependentBinaryHorizon(args: {
  horizonSec: GhHorizonSec;
  trainX: number[][];
  trainBuyY: number[];
  trainSellY: number[];
  valX: number[][];
  valNetLong: number[];
  valNetShort: number[];
}): HorizonBinaryBundle {
  const norm = fitNormalization(args.trainX);
  const Xt = args.trainX.map((r) => applyNormalization(r, norm));
  const Xv = args.valX.map((r) => applyNormalization(r, norm));
  const buy = trainBinaryLogistic(Xt, args.trainBuyY);
  const sell = trainBinaryLogistic(Xt, args.trainSellY);
  const buySamples = Xv.map((x, i) => ({
    score: predictBinaryProb(buy, x),
    realized: args.valNetLong[i]!
  }));
  const sellSamples = Xv.map((x, i) => ({
    score: predictBinaryProb(sell, x),
    realized: args.valNetShort[i]!
  }));
  return {
    horizonSec: args.horizonSec,
    buy,
    sell,
    norm,
    buyCalib: buildProbBins(buySamples),
    sellCalib: buildProbBins(sellSamples)
  };
}

export function trainDirectEdgeHorizon(args: {
  horizonSec: GhHorizonSec;
  trainX: number[][];
  trainNetLong: number[];
  trainNetShort: number[];
  kind: "ridge" | "stump_boost";
}): HorizonEdgeBundle {
  const norm = fitNormalization(args.trainX);
  const Xt = args.trainX.map((r) => applyNormalization(r, norm));
  if (args.kind === "stump_boost") {
    return {
      horizonSec: args.horizonSec,
      longModel: trainStumpBoost(Xt, args.trainNetLong),
      shortModel: trainStumpBoost(Xt, args.trainNetShort),
      kind: "stump_boost",
      norm
    };
  }
  return {
    horizonSec: args.horizonSec,
    longModel: trainRidgeRegression(Xt, args.trainNetLong),
    shortModel: trainRidgeRegression(Xt, args.trainNetShort),
    kind: "ridge",
    norm
  };
}

export function predictEdge(
  bundle: HorizonEdgeBundle,
  xRaw: number[]
): { expectedNetLong: number; expectedNetShort: number } {
  const x = applyNormalization(xRaw, bundle.norm);
  if (bundle.kind === "stump_boost") {
    return {
      expectedNetLong: predictStumpBoost(bundle.longModel as StumpBoostModel, x),
      expectedNetShort: predictStumpBoost(
        bundle.shortModel as StumpBoostModel,
        x
      )
    };
  }
  return {
    expectedNetLong: predictRidge(bundle.longModel as RidgeModel, x),
    expectedNetShort: predictRidge(bundle.shortModel as RidgeModel, x)
  };
}

export function predictBinarySides(
  bundle: HorizonBinaryBundle,
  xRaw: number[]
): {
  pBuy: number;
  pSell: number;
  calibratedBuyNet: number;
  calibratedSellNet: number;
} {
  const x = applyNormalization(xRaw, bundle.norm);
  const pBuy = predictBinaryProb(bundle.buy, x);
  const pSell = predictBinaryProb(bundle.sell, x);
  return {
    pBuy,
    pSell,
    calibratedBuyNet: lookupBinAvg(bundle.buyCalib, pBuy),
    calibratedSellNet: lookupBinAvg(bundle.sellCalib, pSell)
  };
}

export function hashModelBlob(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

export { fitNormalization, applyNormalization };
