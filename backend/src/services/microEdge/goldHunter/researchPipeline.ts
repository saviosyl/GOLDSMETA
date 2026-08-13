/**
 * GOLD_HUNTER research pipeline:
 * as-of dataset → chronological split → theta/entry freeze on validation →
 * train models → ONE holdout shadow run → baselines.
 *
 * Never optimizes on holdout.
 */
import {
  GH_DEFAULT_ENTRY,
  GH_DEFAULT_ENTRY_SLIPPAGE,
  GH_DEFAULT_EXECUTION_BUFFER,
  GH_DEFAULT_EXIT_SLIPPAGE,
  GH_HORIZONS_SEC,
  GH_MAX_HOLD_CANDIDATES,
  GH_TARGET_TOLERANCE_MS,
  GH_THETA_CANDIDATES,
  GOLD_HUNTER_FEATURE_SCHEMA_VERSION,
  GOLD_HUNTER_MODEL_VERSION,
  GOLD_HUNTER_STRATEGY_VERSION,
  type GhHorizonSec
} from "./config";
import {
  buildAsOfSecondRows,
  buildLabeledResearchRows,
  type RawTick
} from "./asOfDataset";
import { chronologicalSplit } from "./chronologicalSplit";
import { finalizeDataQualityReport, emptyTickAudit } from "./dataQuality";
import {
  applyNormalization,
  buildModelArtifact,
  fitNormalization,
  hashDataset,
  predictProbs,
  trainHorizonModel,
  type HorizonModelBundle
} from "./model";
import { featureVectorToArray } from "./features";
import { computeHorizonMetrics, computePolicyBacktest } from "./metrics";
import { baselineComparisons } from "./baselines";
import { buildForecast } from "./forecastBuilder";
import {
  createShadowEngine,
  evaluateShadow,
  type ShadowEngineState
} from "./shadowEngine";
import {
  DEFAULT_ENTRY_THRESHOLDS,
  type EntryThresholds
} from "./signalPolicy";
import { classFromNets } from "./labels";
import type {
  GhDataQualityReport,
  GhHorizonMetrics,
  GhLabel,
  GhModelArtifact,
  GhPolicyBacktest,
  GhShadowTrade
} from "./types";
import {
  defaultResearchDataDir,
  writeChunkFile,
  writeManifest,
  writeModelArtifactFile
} from "./compactStorage";
import { buildQuoteBook } from "./quoteValidity";

export type ResearchPipelineResult = {
  dataQuality: GhDataQualityReport;
  secondRows: number;
  unscorableFeatureRows: number;
  unscorableLabelRows: number;
  trainCount: number;
  validationCount: number;
  holdoutCount: number;
  trainRange: { fromMs: number; toMs: number } | null;
  validationRange: { fromMs: number; toMs: number } | null;
  holdoutRange: { fromMs: number; toMs: number } | null;
  selectedTheta: number;
  selectedEntry: EntryThresholds;
  selectedMaxHoldSec: number;
  protectiveStop: number;
  horizonMetrics: Record<GhHorizonSec, GhHorizonMetrics>;
  holdoutBacktest: GhPolicyBacktest;
  holdoutTrades: GhShadowTrade[];
  baselines: ReturnType<typeof baselineComparisons>;
  artifact: GhModelArtifact;
  bundles: HorizonModelBundle[];
  datasetHash: string;
  bidTicks: number;
  askTicks: number;
};

function auditTicks(ticks: RawTick[]): GhDataQualityReport {
  const bid = emptyTickAudit("BID");
  const ask = emptyTickAudit("ASK");
  for (const t of ticks) {
    const a = t.side === "BID" ? bid : ask;
    a.totalWireTicks += 1;
    if (!Number.isFinite(t.timestampMs) || t.timestampMs <= 0) {
      a.malformedTimestampTicks += 1;
      continue;
    }
    if (!(t.price > 0) || !Number.isFinite(t.price)) {
      a.invalidPriceTicks += 1;
      continue;
    }
    a.validTicks += 1;
  }
  return finalizeDataQualityReport(bid, ask);
}

function relabel(
  labels: Record<number, GhLabel>,
  theta: number
): Record<number, GhLabel> {
  const out: Record<number, GhLabel> = {};
  for (const h of GH_HORIZONS_SEC) {
    const lab = labels[h]!;
    if (
      lab.classLabel === "UNSCORABLE_DATA_GAP" ||
      lab.netLong == null ||
      lab.netShort == null
    ) {
      out[h] = lab;
    } else {
      out[h] = {
        ...lab,
        classLabel: classFromNets(lab.netLong, lab.netShort, theta)
      };
    }
  }
  return out;
}

function scoreValidationExpectancy(
  rows: Array<{
    timestampMs: number;
    features: import("./types").GhFeatureVector;
    labels: Record<number, GhLabel>;
    quote: { timestampMs: number; bid: number; ask: number };
  }>,
  bundles: HorizonModelBundle[],
  entry: EntryThresholds,
  maxHoldSec: number
): number {
  const trades = runShadowReplay(rows, bundles, entry, maxHoldSec);
  return computePolicyBacktest(trades).expectancy;
}

export function runShadowReplay(
  rows: Array<{
    timestampMs: number;
    features: import("./types").GhFeatureVector;
    labels: Record<number, GhLabel>;
    quote: { timestampMs: number; bid: number; ask: number };
  }>,
  bundles: HorizonModelBundle[],
  thresholds: EntryThresholds,
  maxHoldSec: number,
  protectiveStop = GH_DEFAULT_ENTRY.protectiveStop
): GhShadowTrade[] {
  let state: ShadowEngineState = createShadowEngine();
  for (const row of rows) {
    const book = buildQuoteBook({
      nowMs: row.timestampMs,
      brokerTimestampMs: row.timestampMs,
      bid: row.quote.bid,
      ask: row.quote.ask,
      bidUpdatedMs: row.timestampMs,
      askUpdatedMs: row.timestampMs
    });
    const forecast = buildForecast({
      book,
      features: row.features,
      bundles,
      dataQuality: book.valid ? "OK" : "INVALID",
      thresholds,
      researchModel: true
    });
    state = evaluateShadow(state, {
      nowMs: row.timestampMs,
      quote: {
        timestampMs: row.timestampMs,
        bid: row.quote.bid,
        ask: row.quote.ask,
        spread: row.quote.ask - row.quote.bid
      },
      forecast,
      thresholds,
      maxHoldSec,
      protectiveStopUsd: protectiveStop
    });
  }
  return state.completedTrades;
}

export async function runGoldHunterResearchPipeline(args: {
  ticks: RawTick[];
  persist?: boolean;
  dataDir?: string;
}): Promise<ResearchPipelineResult> {
  const dataQuality = auditTicks(args.ticks);
  const bidTicks = dataQuality.bid.validTicks;
  const askTicks = dataQuality.ask.validTicks;

  if (dataQuality.datasetStatus === "DATA_QUALITY_FAILED") {
    const emptyArt = buildModelArtifact({
      bundles: [],
      trainingRange: { fromMs: 0, toMs: 0 },
      validationRange: { fromMs: 0, toMs: 0 },
      holdoutRange: { fromMs: 0, toMs: 0 },
      labelConfig: {
        theta: 0,
        entrySlippage: GH_DEFAULT_ENTRY_SLIPPAGE,
        exitSlippage: GH_DEFAULT_EXIT_SLIPPAGE,
        executionBuffer: GH_DEFAULT_EXECUTION_BUFFER,
        targetToleranceMs: GH_TARGET_TOLERANCE_MS
      },
      entryPolicy: {
        pUp5: GH_DEFAULT_ENTRY.pUp5,
        pUp15: GH_DEFAULT_ENTRY.pUp15,
        pUp30: GH_DEFAULT_ENTRY.pUp30,
        consecutiveEvals: GH_DEFAULT_ENTRY.consecutiveEvals,
        maxHoldSec: GH_DEFAULT_ENTRY.maxHoldSec,
        protectiveStop: GH_DEFAULT_ENTRY.protectiveStop
      },
      datasetHash: "failed",
      qualificationStatus: "INSUFFICIENT_DATA",
      sharedNorm: { mean: [], std: [] }
    });
    return {
      dataQuality,
      secondRows: 0,
      unscorableFeatureRows: 0,
      unscorableLabelRows: 0,
      trainCount: 0,
      validationCount: 0,
      holdoutCount: 0,
      trainRange: null,
      validationRange: null,
      holdoutRange: null,
      selectedTheta: 0,
      selectedEntry: DEFAULT_ENTRY_THRESHOLDS,
      selectedMaxHoldSec: 60,
      protectiveStop: GH_DEFAULT_ENTRY.protectiveStop,
      horizonMetrics: {
        5: emptyMetrics(5),
        15: emptyMetrics(15),
        30: emptyMetrics(30),
        60: emptyMetrics(60)
      },
      holdoutBacktest: computePolicyBacktest([]),
      holdoutTrades: [],
      baselines: baselineComparisons([]),
      artifact: emptyArt,
      bundles: [],
      datasetHash: "failed",
      bidTicks,
      askTicks
    };
  }

  // Label with theta=0 first for nets; reclass later per candidate
  const seconds = buildAsOfSecondRows(args.ticks);
  const labeled = buildLabeledResearchRows({ seconds, theta: 0 });
  const split = chronologicalSplit(labeled.rows);

  if (split.train.length < 200 || split.validation.length < 50) {
    const art = buildModelArtifact({
      bundles: [],
      trainingRange: split.trainRange ?? { fromMs: 0, toMs: 0 },
      validationRange: split.validationRange ?? { fromMs: 0, toMs: 0 },
      holdoutRange: split.holdoutRange ?? { fromMs: 0, toMs: 0 },
      labelConfig: {
        theta: 0,
        entrySlippage: GH_DEFAULT_ENTRY_SLIPPAGE,
        exitSlippage: GH_DEFAULT_EXIT_SLIPPAGE,
        executionBuffer: GH_DEFAULT_EXECUTION_BUFFER,
        targetToleranceMs: GH_TARGET_TOLERANCE_MS
      },
      entryPolicy: {
        pUp5: GH_DEFAULT_ENTRY.pUp5,
        pUp15: GH_DEFAULT_ENTRY.pUp15,
        pUp30: GH_DEFAULT_ENTRY.pUp30,
        consecutiveEvals: GH_DEFAULT_ENTRY.consecutiveEvals,
        maxHoldSec: GH_DEFAULT_ENTRY.maxHoldSec,
        protectiveStop: GH_DEFAULT_ENTRY.protectiveStop
      },
      datasetHash: hashDataset(labeled.rows),
      qualificationStatus: "INSUFFICIENT_DATA",
      sharedNorm: { mean: [], std: [] }
    });
    return {
      dataQuality,
      secondRows: labeled.totalSeconds,
      unscorableFeatureRows: labeled.unscorableFeatureRows,
      unscorableLabelRows: labeled.unscorableLabelRows,
      trainCount: split.train.length,
      validationCount: split.validation.length,
      holdoutCount: split.holdout.length,
      trainRange: split.trainRange,
      validationRange: split.validationRange,
      holdoutRange: split.holdoutRange,
      selectedTheta: 0,
      selectedEntry: DEFAULT_ENTRY_THRESHOLDS,
      selectedMaxHoldSec: 60,
      protectiveStop: GH_DEFAULT_ENTRY.protectiveStop,
      horizonMetrics: {
        5: emptyMetrics(5),
        15: emptyMetrics(15),
        30: emptyMetrics(30),
        60: emptyMetrics(60)
      },
      holdoutBacktest: computePolicyBacktest([]),
      holdoutTrades: [],
      baselines: baselineComparisons(
        labeled.rows.map((r) => r.quote)
      ),
      artifact: art,
      bundles: [],
      datasetHash: art.datasetHash,
      bidTicks,
      askTicks
    };
  }

  // --- Validation-only theta / max-hold selection ---
  let bestTheta = 0.1;
  let bestMaxHold = 60;
  let bestScore = -Infinity;
  let bestEntry = { ...DEFAULT_ENTRY_THRESHOLDS };

  for (const theta of GH_THETA_CANDIDATES) {
    const trainRelabeled = split.train.map((r) => ({
      ...r,
      labels: relabel(r.labels, theta)
    }));
    const valRelabeled = split.validation.map((r) => ({
      ...r,
      labels: relabel(r.labels, theta)
    }));

    const bundles: HorizonModelBundle[] = [];
    for (const h of GH_HORIZONS_SEC) {
      bundles.push(
        trainHorizonModel(
          h,
          trainRelabeled.map((r) => r.features),
          trainRelabeled.map((r) => r.labels[h]!),
          valRelabeled.map((r) => r.features),
          valRelabeled.map((r) => r.labels[h]!)
        )
      );
    }

    for (const maxHold of GH_MAX_HOLD_CANDIDATES) {
      const score = scoreValidationExpectancy(
        valRelabeled,
        bundles,
        DEFAULT_ENTRY_THRESHOLDS,
        maxHold
      );
      if (score > bestScore) {
        bestScore = score;
        bestTheta = theta;
        bestMaxHold = maxHold;
        bestEntry = { ...DEFAULT_ENTRY_THRESHOLDS };
      }
    }
  }

  // Freeze selection — train final bundles on train with frozen theta; val for calibration
  const trainFinal = split.train.map((r) => ({
    ...r,
    labels: relabel(r.labels, bestTheta)
  }));
  const valFinal = split.validation.map((r) => ({
    ...r,
    labels: relabel(r.labels, bestTheta)
  }));
  const holdoutFinal = split.holdout.map((r) => ({
    ...r,
    labels: relabel(r.labels, bestTheta)
  }));

  const bundles: HorizonModelBundle[] = [];
  for (const h of GH_HORIZONS_SEC) {
    bundles.push(
      trainHorizonModel(
        h,
        trainFinal.map((r) => r.features),
        trainFinal.map((r) => r.labels[h]!),
        valFinal.map((r) => r.features),
        valFinal.map((r) => r.labels[h]!)
      )
    );
  }

  // Shared norm from train (for artifact)
  const sharedNorm = fitNormalization(
    trainFinal.map((r) => featureVectorToArray(r.features))
  );

  const horizonMetrics = {} as Record<GhHorizonSec, GhHorizonMetrics>;
  for (const h of GH_HORIZONS_SEC) {
    const bundle = bundles.find((b) => b.horizonSec === h)!;
    const preds = valFinal.map((r) => {
      const xn = applyNormalization(
        featureVectorToArray(r.features),
        bundle.norm
      );
      return predictProbs(bundle.model, xn);
    });
    horizonMetrics[h] = computeHorizonMetrics({
      horizonSec: h,
      labels: valFinal.map((r) => r.labels[h]!),
      preds
    });
  }

  // ONE holdout shadow run — locked config
  const holdoutTrades = runShadowReplay(
    holdoutFinal,
    bundles,
    bestEntry,
    bestMaxHold
  );
  const holdoutBacktest = computePolicyBacktest(holdoutTrades);
  const qualificationStatus: GhModelArtifact["qualificationStatus"] =
    holdoutTrades.length < 5
      ? "INSUFFICIENT_DATA"
      : holdoutBacktest.netPnl > 0 && holdoutBacktest.expectancy > 0
        ? "HOLDOUT_POSITIVE"
        : "HOLDOUT_NEGATIVE";

  const datasetHash = hashDataset(labeled.rows);
  const artifact = buildModelArtifact({
    bundles,
    trainingRange: split.trainRange ?? { fromMs: 0, toMs: 0 },
    validationRange: split.validationRange ?? { fromMs: 0, toMs: 0 },
    holdoutRange: split.holdoutRange ?? { fromMs: 0, toMs: 0 },
    labelConfig: {
      theta: bestTheta,
      entrySlippage: GH_DEFAULT_ENTRY_SLIPPAGE,
      exitSlippage: GH_DEFAULT_EXIT_SLIPPAGE,
      executionBuffer: GH_DEFAULT_EXECUTION_BUFFER,
      targetToleranceMs: GH_TARGET_TOLERANCE_MS
    },
    entryPolicy: {
      pUp5: bestEntry.pUp5,
      pUp15: bestEntry.pUp15,
      pUp30: bestEntry.pUp30,
      consecutiveEvals: GH_DEFAULT_ENTRY.consecutiveEvals,
      maxHoldSec: bestMaxHold,
      protectiveStop: GH_DEFAULT_ENTRY.protectiveStop
    },
    datasetHash,
    qualificationStatus:
      qualificationStatus === "INSUFFICIENT_DATA"
        ? "INSUFFICIENT_DATA"
        : qualificationStatus === "HOLDOUT_POSITIVE"
          ? "HOLDOUT_POSITIVE"
          : holdoutTrades.length
            ? "HOLDOUT_NEGATIVE"
            : "TRAINED_RESEARCH",
    sharedNorm
  });

  // Ensure strategy/model versions on artifact path
  void GOLD_HUNTER_STRATEGY_VERSION;
  void GOLD_HUNTER_MODEL_VERSION;
  void GOLD_HUNTER_FEATURE_SCHEMA_VERSION;

  if (args.persist) {
    const dir = args.dataDir ?? defaultResearchDataDir();
    const chunk = await writeChunkFile(
      dir,
      "seconds-all",
      labeled.rows.map((r) => ({
        timestampMs: r.timestampMs,
        bid: r.quote.bid,
        ask: r.quote.ask
      }))
    );
    await writeManifest(dir, {
      datasetId: `gh-${datasetHash}`,
      featureSchemaVersion: GOLD_HUNTER_FEATURE_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      chunks: [chunk],
      totalRows: labeled.rows.length,
      datasetHash
    });
    await writeModelArtifactFile(dir, artifact);
  }

  return {
    dataQuality,
    secondRows: labeled.totalSeconds,
    unscorableFeatureRows: labeled.unscorableFeatureRows,
    unscorableLabelRows: labeled.unscorableLabelRows,
    trainCount: split.train.length,
    validationCount: split.validation.length,
    holdoutCount: split.holdout.length,
    trainRange: split.trainRange,
    validationRange: split.validationRange,
    holdoutRange: split.holdoutRange,
    selectedTheta: bestTheta,
    selectedEntry: bestEntry,
    selectedMaxHoldSec: bestMaxHold,
    protectiveStop: GH_DEFAULT_ENTRY.protectiveStop,
    horizonMetrics,
    holdoutBacktest,
    holdoutTrades,
    baselines: baselineComparisons(holdoutFinal.map((r) => r.quote)),
    artifact,
    bundles,
    datasetHash,
    bidTicks,
    askTicks
  };
}

function emptyMetrics(h: GhHorizonSec): GhHorizonMetrics {
  return {
    horizonSec: h,
    sampleCount: 0,
    classBalance: {},
    directionAccuracy: 0,
    precisionUp: 0,
    recallUp: 0,
    precisionDown: 0,
    recallDown: 0,
    brierScore: 0,
    tradeableCoverage: 0,
    avgNetLong: 0,
    avgNetShort: 0
  };
}

/** Generate synthetic ticks for offline unit/research smoke (not production). */
export function synthesizeResearchTicks(args: {
  fromMs: number;
  seconds: number;
  startMid?: number;
  spread?: number;
  seed?: number;
}): RawTick[] {
  const mid0 = args.startMid ?? 2400;
  const spread = args.spread ?? 0.15;
  let mid = mid0;
  let s = args.seed ?? 42;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const ticks: RawTick[] = [];
  for (let i = 0; i < args.seconds; i++) {
    const t = args.fromMs + i * 1000;
    // mild momentum + noise
    mid += (rand() - 0.48) * 0.08;
    const bid = mid - spread / 2;
    const ask = mid + spread / 2;
    ticks.push({ timestampMs: t, side: "BID", price: bid });
    ticks.push({ timestampMs: t + 1, side: "ASK", price: ask });
  }
  return ticks;
}
