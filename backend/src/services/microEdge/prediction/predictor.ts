import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_COST_MODEL_VERSION,
  MICRO_FEATURE_VERSION,
  MICRO_HORIZONS,
  MICRO_LABEL_VERSION,
  MICRO_MODEL_VERSION,
  MICRO_PRIMARY_HORIZON,
  MICRO_REGIME_VERSION,
  MICRO_SESSION_VERSION,
  MICRO_SHADOW_ONLY,
  type MicroHorizon
} from "../config";
import { classifyMicroSession, nowIso } from "../clock";
import { buildFeatureVector } from "../features/buildFeatureVector";
import { classifyMicroRegime } from "../regime/classifier";
import { logisticChampionModel } from "../models/logisticModel";
import { applyCalibration } from "../models/calibration";
import { estimateFriction, netEdgeFromSignedMove } from "./costModel";
import { decideHorizon, overallDecision } from "./decision";
import type {
  MicroBar,
  MicroFeatureSnapshot,
  MicroHorizonForecast,
  MicroPrediction,
  MicroQuote
} from "../types";

export function predictionIdFor(candleCloseEpochMs: number, modelVersion = MICRO_MODEL_VERSION): string {
  return `XAUUSD_${candleCloseEpochMs}_${modelVersion}`;
}

export function createPrediction(args: {
  candleCloseEpochMs: number;
  m1: MicroBar[];
  m5: MicroBar[];
  m15: MicroBar[];
  quote: MicroQuote;
  spreadHistory: number[];
  nowMs?: number;
}): { prediction: MicroPrediction; features: MicroFeatureSnapshot } {
  const nowMs = args.nowMs ?? Date.now();
  const predictionId = predictionIdFor(args.candleCloseEpochMs);
  const features = buildFeatureVector({
    predictionId,
    cutoffMs: args.candleCloseEpochMs,
    m1: args.m1,
    m5: args.m5,
    m15: args.m15,
    quote: args.quote,
    spreadHistory: args.spreadHistory
  });
  // Leakage guard: cutoff must equal candle close.
  if (new Date(features.cutoffTs).getTime() > args.candleCloseEpochMs) {
    throw new Error("FEATURE_LEAKAGE: cutoff after candle close");
  }

  const { session } = classifyMicroSession(new Date(args.candleCloseEpochMs).getUTCHours());
  const regime = classifyMicroRegime(features.values, features.missingFlags);
  const raw = logisticChampionModel.predict(features.values);
  const cal = applyCalibration(raw);
  const friction = estimateFriction({
    currentSpread: args.quote.spread,
    historicalSpreads: args.spreadHistory
  });
  const dataOk =
    !features.missingFlags.m1_insufficient &&
    !features.missingFlags.quote_stale &&
    regime.regime !== "DANGER";

  const horizons = {} as Record<MicroHorizon, MicroHorizonForecast>;
  for (const h of MICRO_HORIZONS) {
    // V1 uses shared move estimate scaled lightly by horizon length.
    const scale = h === "1m" ? 0.5 : h === "5m" ? 1 : 1.4;
    const expectedSignedMove = raw.expectedSignedMove * scale;
    const expectedAbsoluteMove = raw.expectedAbsoluteMove * scale;
    const e = netEdgeFromSignedMove(expectedSignedMove, friction.estimatedFriction);
    const dec = decideHorizon({
      netEdgeUp: e.netEdgeUp,
      netEdgeDown: e.netEdgeDown,
      pUp: cal.pUp,
      pDown: cal.pDown,
      pNoEdge: cal.pNoEdge,
      regime: regime.regime,
      dataOk
    });
    horizons[h] = {
      horizon: h,
      pUp: cal.pUp,
      pDown: cal.pDown,
      pNoEdge: cal.pNoEdge,
      expectedSignedMove,
      expectedAbsoluteMove,
      estimatedFriction: friction.estimatedFriction,
      netEdgeUp: e.netEdgeUp,
      netEdgeDown: e.netEdgeDown,
      confidence: Math.max(cal.pUp, cal.pDown, cal.pNoEdge),
      decision: dec.decision,
      eligibleOpportunity: dec.eligible,
      eligibilityReasons: dec.reasons
    };
  }

  const overall = overallDecision(
    Object.fromEntries(
      MICRO_HORIZONS.map((h) => [
        h,
        {
          decision: horizons[h]!.decision,
          netEdgeUp: horizons[h]!.netEdgeUp,
          netEdgeDown: horizons[h]!.netEdgeDown
        }
      ])
    ) as Record<MicroHorizon, { decision: (typeof horizons)[MicroHorizon]["decision"]; netEdgeUp: number; netEdgeDown: number }>
  );

  const topFactors = [
    `regime=${regime.regime}`,
    `session=${session}`,
    `spread_vs_median=${(features.values.spread_vs_median ?? 0).toFixed(2)}`,
    `mom_5m=${(features.values.mom_5m ?? 0).toFixed(3)}`,
    `agreement=${overall.agreement}`
  ];

  const prediction: MicroPrediction = {
    predictionId,
    symbol: "XAUUSD",
    candleCloseTs: new Date(args.candleCloseEpochMs).toISOString(),
    candleCloseEpochMs: args.candleCloseEpochMs,
    createdAt: nowIso(nowMs),
    quoteTs: args.quote.brokerTimestamp,
    bid: args.quote.bid,
    ask: args.quote.ask,
    mid: args.quote.mid,
    spread: args.quote.spread,
    quoteAgeMs: args.quote.ageMs,
    dataFreshness: args.quote.freshness,
    featureRef: features.featureRef,
    featureVersion: MICRO_FEATURE_VERSION,
    modelVersion: MICRO_MODEL_VERSION,
    calibrationVersion: cal.calibrationVersion,
    costModelVersion: MICRO_COST_MODEL_VERSION,
    labelVersion: MICRO_LABEL_VERSION,
    regimeVersion: MICRO_REGIME_VERSION,
    sessionVersion: MICRO_SESSION_VERSION,
    session,
    regime: regime.regime,
    regimeReasons: regime.reasons,
    shadowOnly: MICRO_SHADOW_ONLY,
    brokerExecutionEnabled: MICRO_BROKER_EXECUTION_ENABLED,
    dataQuality: {
      ok: dataOk,
      flags: Object.entries(features.missingFlags)
        .filter(([, v]) => v)
        .map(([k]) => k)
    },
    strongestHorizon: overall.strongest,
    overallMicroDecision: overall.overall,
    forecastAgreementState: overall.agreement,
    topFactors,
    horizons,
    primaryResearchHorizon: MICRO_PRIMARY_HORIZON
  };

  return { prediction, features };
}
