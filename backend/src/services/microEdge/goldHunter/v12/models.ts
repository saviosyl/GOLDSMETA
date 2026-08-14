/**
 * V1.2 model families — reuses V1.1 trainers + two-stage + deeper shallow boost.
 */
import type { GhHorizonSec } from "../config";
import {
  applyNormalization,
  fitNormalization,
  type NormParams
} from "../model";
import {
  predictBinaryProb,
  predictBinarySides,
  predictEdge,
  trainBinaryLogistic,
  trainDirectEdgeHorizon,
  trainIndependentBinaryHorizon,
  trainStumpBoost,
  type BinaryLogisticModel,
  type HorizonBinaryBundle,
  type HorizonEdgeBundle,
  type StumpBoostModel
} from "../v11/models";

export type TwoStageBundle = {
  opportunity: BinaryLogisticModel;
  buy: BinaryLogisticModel;
  sell: BinaryLogisticModel;
  norm: NormParams;
  horizonSec: GhHorizonSec;
};

export type ShallowBoostBundle = HorizonEdgeBundle;

/** Opportunity label: |netLong| or |netShort| exceeds friction-aware threshold. */
export function opportunityLabel(
  netLong: number,
  netShort: number,
  thr: number
): number {
  return Math.max(Math.abs(netLong), Math.abs(netShort)) >= thr ? 1 : 0;
}

export function trainTwoStageHorizon(args: {
  horizonSec: GhHorizonSec;
  trainX: number[][];
  trainNetLong: number[];
  trainNetShort: number[];
  opportunityThr: number;
}): TwoStageBundle {
  const norm = fitNormalization(args.trainX);
  const Xt = args.trainX.map((r) => applyNormalization(r, norm));
  const yOpp = args.trainNetLong.map((_, i) =>
    opportunityLabel(
      args.trainNetLong[i]!,
      args.trainNetShort[i]!,
      args.opportunityThr
    )
  );
  const opportunity = trainBinaryLogistic(Xt, yOpp, { l2: 0.08, epochs: 40 });

  const buyY = args.trainNetLong.map((v) => (v > 0 ? 1 : 0));
  const sellY = args.trainNetShort.map((v) => (v > 0 ? 1 : 0));
  const idx = yOpp
    .map((y, i) => (y > 0 ? i : -1))
    .filter((i) => i >= 0);
  const Xdir = idx.length >= 200 ? idx.map((i) => Xt[i]!) : Xt;
  const buyYd = idx.length >= 200 ? idx.map((i) => buyY[i]!) : buyY;
  const sellYd = idx.length >= 200 ? idx.map((i) => sellY[i]!) : sellY;
  const buy = trainBinaryLogistic(Xdir, buyYd, { l2: 0.05, epochs: 50 });
  const sell = trainBinaryLogistic(Xdir, sellYd, { l2: 0.05, epochs: 50 });
  return { opportunity, buy, sell, norm, horizonSec: args.horizonSec };
}

export function predictTwoStage(
  model: TwoStageBundle,
  x: number[]
): { pOpportunity: number; buy: number; sell: number } {
  const xn = applyNormalization(x, model.norm);
  return {
    pOpportunity: predictBinaryProb(model.opportunity, xn),
    buy: predictBinaryProb(model.buy, xn),
    sell: predictBinaryProb(model.sell, xn)
  };
}

/** Improved shallow boost: more stumps, interaction-friendly subsample. */
export function trainShallowBoostHorizon(args: {
  horizonSec: GhHorizonSec;
  trainX: number[][];
  trainNetLong: number[];
  trainNetShort: number[];
}): ShallowBoostBundle {
  return trainDirectEdgeHorizon({
    horizonSec: args.horizonSec,
    trainX: args.trainX,
    trainNetLong: args.trainNetLong,
    trainNetShort: args.trainNetShort,
    kind: "stump_boost"
  });
}

export function edgeOverSpread(edge: number, spread: number): number {
  return edge / Math.max(spread, 1e-6);
}

export {
  trainIndependentBinaryHorizon,
  trainDirectEdgeHorizon,
  predictBinarySides,
  predictEdge,
  trainStumpBoost,
  type HorizonBinaryBundle,
  type HorizonEdgeBundle,
  type BinaryLogisticModel,
  type StumpBoostModel
};
