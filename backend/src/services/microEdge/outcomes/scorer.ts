import {
  MICRO_COST_MODEL_VERSION,
  MICRO_EXECUTION_BUFFER,
  MICRO_LABEL_VERSION,
  MICRO_MODEL_VERSION,
  MICRO_TARGET_QUOTE_TOLERANCE_SECONDS,
  type MicroHorizon
} from "../config";
import { horizonMs, nowIso } from "../clock";
import { estimateFriction } from "../prediction/costModel";
import { labelFromNets } from "../prediction/labels";
import type { MicroOutcome, MicroPrediction, MicroQuote } from "../types";
import { argmaxClass } from "../models/modelInterface";

/**
 * Resolve first valid quote at or after target within tolerance.
 * No interpolation. No later quote beyond tolerance.
 */
export function resolveTargetQuote(args: {
  targetMs: number;
  quotes: MicroQuote[];
  toleranceSeconds?: number;
}): { quote: MicroQuote | null; reason: string | null } {
  const tol = (args.toleranceSeconds ?? MICRO_TARGET_QUOTE_TOLERANCE_SECONDS) * 1000;
  const sorted = [...args.quotes].sort(
    (a, b) => new Date(a.brokerTimestamp).getTime() - new Date(b.brokerTimestamp).getTime()
  );
  for (const q of sorted) {
    const ts = new Date(q.brokerTimestamp).getTime();
    if (ts < args.targetMs) continue;
    if (ts - args.targetMs <= tol) return { quote: q, reason: null };
    return { quote: null, reason: "UNSCORABLE_DATA_GAP" };
  }
  return { quote: null, reason: "UNSCORABLE_DATA_GAP" };
}

export function scoreHorizon(args: {
  prediction: MicroPrediction;
  horizon: MicroHorizon;
  pathQuotes: MicroQuote[];
  nowMs?: number;
}): MicroOutcome {
  const pred = args.prediction;
  const targetMs = pred.candleCloseEpochMs + horizonMs(args.horizon);
  const { quote, reason } = resolveTargetQuote({
    targetMs,
    quotes: args.pathQuotes
  });
  const predictedClass = argmaxClass(pred.horizons[args.horizon]);
  const friction = estimateFriction({
    currentSpread: pred.spread,
    historicalSpreads: [pred.spread]
  });

  if (!quote) {
    return {
      predictionId: pred.predictionId,
      horizon: args.horizon,
      targetTs: new Date(targetMs).toISOString(),
      scoredAt: nowIso(args.nowMs),
      scorable: false,
      unscorableReason: reason ?? "UNSCORABLE_DATA_GAP",
      exitQuoteTs: null,
      exitBid: null,
      exitAsk: null,
      exitMid: null,
      actualSignedMove: null,
      actualAbsoluteMove: null,
      actualClass: null,
      grossLong: null,
      grossShort: null,
      netLong: null,
      netShort: null,
      estimatedCosts: null,
      slippageProxy: null,
      executionBuffer: null,
      predictedClass,
      directionCorrect: null,
      classCorrect: null,
      brierComponents: null,
      logLossComponent: null,
      modelVersion: MICRO_MODEL_VERSION,
      costModelVersion: MICRO_COST_MODEL_VERSION,
      labelVersion: MICRO_LABEL_VERSION,
      mfeLong: null,
      maeLong: null,
      mfeShort: null,
      maeShort: null,
      pathCoverage: null
    };
  }

  // Executable-side gross already includes spread — do NOT subtract spread again.
  const grossLong = quote.bid - pred.ask;
  const grossShort = pred.bid - quote.ask;
  const slip = friction.entrySlippageProxy + friction.exitSlippageProxy;
  const netLong = grossLong - slip - MICRO_EXECUTION_BUFFER;
  const netShort = grossShort - slip - MICRO_EXECUTION_BUFFER;
  const actualSignedMove = quote.mid - pred.mid;
  const actualAbsoluteMove = Math.abs(actualSignedMove);
  const { actualClass } = labelFromNets({
    horizon: args.horizon,
    netLong,
    netShort
  });

  const hz = pred.horizons[args.horizon];
  const probs = [hz.pUp, hz.pDown, hz.pNoEdge];
  const idx = actualClass === "UP_TRADEABLE" ? 0 : actualClass === "DOWN_TRADEABLE" ? 1 : 2;
  const brier =
    probs.reduce((s, p, i) => s + (p - (i === idx ? 1 : 0)) ** 2, 0) / 3;
  const logLoss = -Math.log(Math.max(1e-9, probs[idx]!));

  // Path MFE/MAE when coverage exists.
  const path = args.pathQuotes
    .map((q) => ({ q, t: new Date(q.brokerTimestamp).getTime() }))
    .filter((x) => x.t >= pred.candleCloseEpochMs && x.t <= targetMs)
    .sort((a, b) => a.t - b.t);
  const longPath = path.map((x) => x.q.bid - pred.ask);
  const shortPath = path.map((x) => pred.bid - x.q.ask);
  const mfeLong = longPath.length ? Math.max(...longPath) : null;
  const maeLong = longPath.length ? Math.min(...longPath) : null;
  const mfeShort = shortPath.length ? Math.max(...shortPath) : null;
  const maeShort = shortPath.length ? Math.min(...shortPath) : null;

  const dirPred = hz.expectedSignedMove >= 0 ? 1 : -1;
  const dirAct = actualSignedMove >= 0 ? 1 : -1;

  return {
    predictionId: pred.predictionId,
    horizon: args.horizon,
    targetTs: new Date(targetMs).toISOString(),
    scoredAt: nowIso(args.nowMs),
    scorable: true,
    unscorableReason: null,
    exitQuoteTs: quote.brokerTimestamp,
    exitBid: quote.bid,
    exitAsk: quote.ask,
    exitMid: quote.mid,
    actualSignedMove,
    actualAbsoluteMove,
    actualClass,
    grossLong,
    grossShort,
    netLong,
    netShort,
    estimatedCosts: slip + MICRO_EXECUTION_BUFFER,
    slippageProxy: slip,
    executionBuffer: MICRO_EXECUTION_BUFFER,
    predictedClass,
    directionCorrect: dirPred === dirAct,
    classCorrect: predictedClass === actualClass,
    brierComponents: brier,
    logLossComponent: logLoss,
    modelVersion: MICRO_MODEL_VERSION,
    costModelVersion: MICRO_COST_MODEL_VERSION,
    labelVersion: MICRO_LABEL_VERSION,
    mfeLong,
    maeLong,
    mfeShort,
    maeShort,
    pathCoverage: path.length ? path.length / Math.max(1, horizonMs(args.horizon) / 1000) : 0
  };
}
