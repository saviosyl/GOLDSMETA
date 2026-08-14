/**
 * GOLD_HUNTER research pipeline (real-data qualification path).
 *
 * Train → Validation optimizer (theta/entry/confirm/maxHold/stop) →
 * Freeze config (hash) → ONE holdout shadow run.
 *
 * Holdout is never used during selection.
 */
import { createHash } from "node:crypto";
import {
  GH_DEFAULT_ENTRY,
  GH_DEFAULT_ENTRY_SLIPPAGE,
  GH_DEFAULT_EXECUTION_BUFFER,
  GH_DEFAULT_EXIT_SLIPPAGE,
  GH_DEFAULT_PROTECTIVE_STOP,
  GH_HORIZONS_SEC,
  GH_TARGET_TOLERANCE_MS,
  GOLD_HUNTER_FEATURE_SCHEMA_VERSION,
  GOLD_HUNTER_MODEL_VERSION,
  GOLD_HUNTER_STRATEGY_VERSION,
  GOLD_HUNTER_SYNTHETIC_SMOKE_LABEL,
  type GhHorizonSec
} from "./config";
import {
  buildAsOfSecondRows,
  buildLabeledResearchRows,
  type AsOfGridStats,
  type RawTick
} from "./asOfDataset";
import { chronologicalSplit } from "./chronologicalSplit";
import { emptyTickAudit, finalizeDataQualityReport } from "./dataQuality";
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
import type { GhBarCtx } from "./features";
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
import { deriveProtectiveStopCandidatesFromTrain } from "./protectiveStop";
import {
  buildFrozenConfig,
  utcIso,
  type FrozenGoldHunterConfig
} from "./frozenConfig";
import {
  runStagedValidationOptimizer,
  type OptimizerResult,
  type ResearchRow
} from "./validationOptimizer";
import {
  absoluteMidMoveDistribution,
  executableOpportunityDistribution,
  holdTimeBuckets,
  maxLosingStreak,
  slicePerformance,
  spreadDistribution
} from "./researchReports";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type ResearchDataSource = "PEPPERSTONE_DEMO_REAL" | "SYNTHETIC_SMOKE";

export type ResearchPipelineResult = {
  researchRunId: string;
  dataSource: ResearchDataSource;
  dataQuality: GhDataQualityReport;
  gridStats: AsOfGridStats;
  secondRows: number;
  unscorableFeatureRows: number;
  unscorableLabelRows: number;
  trainCount: number;
  validationCount: number;
  holdoutCount: number;
  purgedCount: number;
  trainRange: { fromMs: number; toMs: number } | null;
  validationRange: { fromMs: number; toMs: number } | null;
  holdoutRange: { fromMs: number; toMs: number } | null;
  trainRangeUtc: { from: string; to: string } | null;
  validationRangeUtc: { from: string; to: string } | null;
  holdoutRangeUtc: { from: string; to: string } | null;
  selectedTheta: number;
  selectedEntry: EntryThresholds;
  selectedMaxHoldSec: number;
  protectiveStop: number;
  optimizer: OptimizerResult | null;
  frozenConfig: FrozenGoldHunterConfig | null;
  frozenConfigSha256: string | null;
  horizonMetrics: Record<GhHorizonSec, GhHorizonMetrics>;
  holdoutBacktest: GhPolicyBacktest;
  holdoutTrades: GhShadowTrade[];
  holdoutMaxLosingStreak: number;
  holdoutHoldBuckets: ReturnType<typeof holdTimeBuckets>;
  holdoutSession: ReturnType<typeof slicePerformance>;
  holdoutRegime: ReturnType<typeof slicePerformance>;
  baselines: ReturnType<typeof baselineComparisons>;
  movement: Record<string, ReturnType<typeof absoluteMidMoveDistribution>>;
  spread: ReturnType<typeof spreadDistribution>;
  opportunities: Record<
    string,
    ReturnType<typeof executableOpportunityDistribution>
  >;
  artifact: GhModelArtifact;
  bundles: HorizonModelBundle[];
  datasetHash: string;
  bidTicks: number;
  askTicks: number;
  m1BarCount: number;
  m5BarCount: number;
  m15BarCount: number;
  qualificationStatus: GhModelArtifact["qualificationStatus"] | "INSUFFICIENT_EDGE";
  lowSampleValidation: boolean;
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

export function runShadowReplay(
  rows: ResearchRow[],
  bundles: HorizonModelBundle[],
  thresholds: EntryThresholds,
  maxHoldSec: number,
  protectiveStop: number = GH_DEFAULT_PROTECTIVE_STOP
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

function rangeUtc(
  r: { fromMs: number; toMs: number } | null
): { from: string; to: string } | null {
  if (!r) return null;
  return { from: utcIso(r.fromMs), to: utcIso(r.toMs) };
}

export async function runGoldHunterResearchPipeline(args: {
  ticks: RawTick[];
  m1Bars?: GhBarCtx[];
  m5Bars?: GhBarCtx[];
  m15Bars?: GhBarCtx[];
  dataSource: ResearchDataSource;
  /** When true, refuse SYNTHETIC_SMOKE — real qualification only. */
  requireRealData?: boolean;
  persist?: boolean;
  dataDir?: string;
  dataFromMs?: number;
  dataToMs?: number;
}): Promise<ResearchPipelineResult> {
  if (args.requireRealData && args.dataSource !== "PEPPERSTONE_DEMO_REAL") {
    throw Object.assign(
      new Error("GOLD_HUNTER_REAL_DATA_REQUIRED: refusing synthetic fallback"),
      { code: "REAL_DATA_REQUIRED" }
    );
  }
  if (args.dataSource === "SYNTHETIC_SMOKE" && args.requireRealData) {
    throw Object.assign(new Error("SYNTHETIC_SMOKE_BLOCKED"), {
      code: "SYNTHETIC_SMOKE_BLOCKED"
    });
  }

  const dataQuality = auditTicks(args.ticks);
  const bidTicks = dataQuality.bid.validTicks;
  const askTicks = dataQuality.ask.validTicks;
  const m1BarCount = args.m1Bars?.length ?? 0;
  const m5BarCount = args.m5Bars?.length ?? 0;
  const m15BarCount = args.m15Bars?.length ?? 0;

  const datasetHashSeed = hashDataset(
    args.ticks.map((t) => ({ timestampMs: t.timestampMs }))
  );
  const researchRunId =
    args.dataSource === "PEPPERSTONE_DEMO_REAL"
      ? `GH_REAL_7D_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${datasetHashSeed.slice(0, 8)}`
      : `${GOLD_HUNTER_SYNTHETIC_SMOKE_LABEL}_${datasetHashSeed.slice(0, 8)}`;

  const fail = (
    status: ResearchPipelineResult["qualificationStatus"],
    gridStats: AsOfGridStats,
    extra?: Partial<ResearchPipelineResult>
  ): ResearchPipelineResult => {
    const art = buildModelArtifact({
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
      datasetHash: datasetHashSeed,
      qualificationStatus:
        status === "INSUFFICIENT_EDGE" ? "INSUFFICIENT_DATA" : status,
      sharedNorm: { mean: [], std: [] }
    });
    return {
      researchRunId,
      dataSource: args.dataSource,
      dataQuality,
      gridStats,
      secondRows: gridStats.totalSeconds,
      unscorableFeatureRows: 0,
      unscorableLabelRows: 0,
      trainCount: 0,
      validationCount: 0,
      holdoutCount: 0,
      purgedCount: 0,
      trainRange: null,
      validationRange: null,
      holdoutRange: null,
      trainRangeUtc: null,
      validationRangeUtc: null,
      holdoutRangeUtc: null,
      selectedTheta: 0,
      selectedEntry: DEFAULT_ENTRY_THRESHOLDS,
      selectedMaxHoldSec: 60,
      protectiveStop: GH_DEFAULT_PROTECTIVE_STOP,
      optimizer: null,
      frozenConfig: null,
      frozenConfigSha256: null,
      horizonMetrics: {
        5: emptyMetrics(5),
        15: emptyMetrics(15),
        30: emptyMetrics(30),
        60: emptyMetrics(60)
      },
      holdoutBacktest: computePolicyBacktest([]),
      holdoutTrades: [],
      holdoutMaxLosingStreak: 0,
      holdoutHoldBuckets: holdTimeBuckets([]),
      holdoutSession: {},
      holdoutRegime: {},
      baselines: baselineComparisons([]),
      movement: {},
      spread: spreadDistribution([]),
      opportunities: {},
      artifact: art,
      bundles: [],
      datasetHash: datasetHashSeed,
      bidTicks,
      askTicks,
      m1BarCount,
      m5BarCount,
      m15BarCount,
      qualificationStatus: status,
      lowSampleValidation: false,
      ...extra
    };
  };

  if (dataQuality.datasetStatus === "DATA_QUALITY_FAILED") {
    return fail("INSUFFICIENT_DATA", {
      totalSeconds: 0,
      validSeconds: 0,
      staleGapSeconds: 0,
      invalidSeconds: 0,
      coveragePct: 0
    });
  }

  const log = (event: string, extra?: Record<string, unknown>) => {
    console.log(JSON.stringify({ event: `gh_pipeline_${event}`, ...extra }));
  };
  log("asof_start", { tickCount: args.ticks.length });
  const { rows: seconds, stats: gridStats } = buildAsOfSecondRows(args.ticks, {
    fromMs: args.dataFromMs,
    toMs: args.dataToMs
  });
  log("asof_done", {
    totalSeconds: gridStats.totalSeconds,
    validSeconds: gridStats.validSeconds
  });
  log("label_start");
  const labeled = buildLabeledResearchRows({
    seconds,
    theta: 0,
    m1Bars: args.m1Bars,
    m5Bars: args.m5Bars,
    m15Bars: args.m15Bars
  });
  log("label_done", {
    rows: labeled.rows.length,
    unscorableFeatureRows: labeled.unscorableFeatureRows,
    unscorableLabelRows: labeled.unscorableLabelRows
  });
  const split = chronologicalSplit(labeled.rows);
  const datasetHash = hashDataset(labeled.rows);
  log("split_done", {
    train: split.train.length,
    validation: split.validation.length,
    holdout: split.holdout.length
  });

  const quotes = labeled.rows.map((r) => r.quote);
  const movement = {
    "5": absoluteMidMoveDistribution(quotes, 5),
    "15": absoluteMidMoveDistribution(quotes, 15),
    "30": absoluteMidMoveDistribution(quotes, 30),
    "60": absoluteMidMoveDistribution(quotes, 60)
  };
  const spread = spreadDistribution(quotes);
  const friction =
    GH_DEFAULT_ENTRY_SLIPPAGE +
    GH_DEFAULT_EXIT_SLIPPAGE +
    GH_DEFAULT_EXECUTION_BUFFER;
  const opportunities = {
    "5": executableOpportunityDistribution(quotes, 5, friction),
    "15": executableOpportunityDistribution(quotes, 15, friction),
    "30": executableOpportunityDistribution(quotes, 30, friction),
    "60": executableOpportunityDistribution(quotes, 60, friction)
  };

  if (split.train.length < 200 || split.validation.length < 50) {
    return fail("INSUFFICIENT_DATA", gridStats, {
      secondRows: labeled.totalSeconds,
      unscorableFeatureRows: labeled.unscorableFeatureRows,
      unscorableLabelRows: labeled.unscorableLabelRows,
      trainCount: split.train.length,
      validationCount: split.validation.length,
      holdoutCount: split.holdout.length,
      purgedCount: split.purgedCount,
      trainRange: split.trainRange,
      validationRange: split.validationRange,
      holdoutRange: split.holdoutRange,
      trainRangeUtc: rangeUtc(split.trainRange),
      validationRangeUtc: rangeUtc(split.validationRange),
      holdoutRangeUtc: rangeUtc(split.holdoutRange),
      movement,
      spread,
      opportunities,
      datasetHash
    });
  }

  // TRAIN-only abs 5s moves for stop candidates
  const trainQuotes = split.train.map((r) => r.quote);
  const absMoves5: number[] = [];
  const tq = new Map(trainQuotes.map((q) => [q.timestampMs, q]));
  for (const q of trainQuotes) {
    const n = tq.get(q.timestampMs + 5000);
    if (!n) continue;
    absMoves5.push(
      Math.abs((n.bid + n.ask) / 2 - (q.bid + q.ask) / 2)
    );
  }
  const stopCandidates = deriveProtectiveStopCandidatesFromTrain({
    trainMids: trainQuotes.map((q) => (q.bid + q.ask) / 2),
    absMoves5
  });

  // Bundle cache per theta (TRAIN fit / VAL calibrate) — holdout never seen
  const bundleCache = new Map<number, HorizonModelBundle[]>();
  const bundlesForTheta = (theta: number): HorizonModelBundle[] => {
    const hit = bundleCache.get(theta);
    if (hit) return hit;
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
    bundleCache.set(theta, bundles);
    return bundles;
  };

  log("optimizer_start", {
    validationRows: split.validation.length,
    stopCandidates
  });
  const optimizer = runStagedValidationOptimizer({
    validationRows: split.validation,
    stopCandidates,
    defaultStop: GH_DEFAULT_PROTECTIVE_STOP,
    replayForTheta: (theta) => {
      const bundles = bundlesForTheta(theta);
      return (rows, entry, maxHold, stop) =>
        runShadowReplay(rows, bundles, entry, maxHold, stop);
    }
  });
  log("optimizer_done", {
    bestScore: optimizer.best?.score ?? null,
    tradeCount: optimizer.best?.tradeCount ?? 0
  });

  if (!optimizer.best) {
    // Holdout remains untouched for policy selection, but naive baselines may
    // still be reported for market-context honesty (not used for tuning).
    const holdoutQuotes = split.holdout.map((r) => r.quote);
    const rejectCounts: Record<string, number> = {};
    let maxTrades = 0;
    let bestRejectedExpectancy = Number.NEGATIVE_INFINITY;
    for (const row of optimizer.searched) {
      const reason = row.rejectReason ?? "UNKNOWN";
      rejectCounts[reason] = (rejectCounts[reason] ?? 0) + 1;
      maxTrades = Math.max(maxTrades, row.tradeCount);
      if (Number.isFinite(row.expectancy)) {
        bestRejectedExpectancy = Math.max(bestRejectedExpectancy, row.expectancy);
      }
    }
    log("insufficient_edge", {
      searched: optimizer.searched.length,
      rejectCounts,
      maxTrades,
      bestRejectedExpectancy
    });
    if (args.persist && args.dataDir) {
      const { writeFileSync: wfs, mkdirSync: mks } = await import("node:fs");
      mks(args.dataDir, { recursive: true });
      wfs(
        `${args.dataDir}/validation-search-report.json`,
        JSON.stringify(
          {
            researchRunId,
            insufficientEdge: true,
            stages: optimizer.stages,
            rejectCounts,
            maxTrades,
            bestRejectedExpectancy,
            searched: optimizer.searched.map((s) => ({
              stage: s.stage,
              theta: s.candidate.theta,
              entry: s.candidate.entry,
              maxHoldSec: s.candidate.maxHoldSec,
              protectiveStop: s.candidate.protectiveStop,
              tradeCount: s.tradeCount,
              buyCount: s.buyCount,
              sellCount: s.sellCount,
              expectancy: s.expectancy,
              netPnl: s.netPnl,
              rejectReason: s.rejectReason,
              score: s.score
            }))
          },
          null,
          2
        )
      );
    }
    return fail("INSUFFICIENT_EDGE", gridStats, {
      secondRows: labeled.totalSeconds,
      unscorableFeatureRows: labeled.unscorableFeatureRows,
      unscorableLabelRows: labeled.unscorableLabelRows,
      trainCount: split.train.length,
      validationCount: split.validation.length,
      holdoutCount: split.holdout.length,
      purgedCount: split.purgedCount,
      trainRange: split.trainRange,
      validationRange: split.validationRange,
      holdoutRange: split.holdoutRange,
      trainRangeUtc: rangeUtc(split.trainRange),
      validationRangeUtc: rangeUtc(split.validationRange),
      holdoutRangeUtc: rangeUtc(split.holdoutRange),
      optimizer,
      movement,
      spread,
      opportunities,
      baselines: baselineComparisons(holdoutQuotes),
      datasetHash,
      lowSampleValidation: optimizer.lowSampleValidation
    });
  }

  const selected = optimizer.best.candidate;
  const bundles = bundlesForTheta(selected.theta);

  // Validation metrics for reporting (not holdout)
  const valFinal = split.validation.map((r) => ({
    ...r,
    labels: relabel(r.labels, selected.theta)
  }));
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

  const sharedNorm = fitNormalization(
    split.train.map((r) => featureVectorToArray(r.features))
  );

  // ---- FREEZE before holdout ----
  log("freeze_start", { theta: selected.theta, maxHold: selected.maxHoldSec });
  const { config: frozenConfig, sha256: frozenConfigSha256 } = buildFrozenConfig({
    researchRunId,
    dataSource: args.dataSource,
    datasetHash,
    theta: selected.theta,
    entry: selected.entry,
    maxHoldSec: selected.maxHoldSec,
    protectiveStop: selected.protectiveStop,
    labelFriction: {
      entrySlippage: GH_DEFAULT_ENTRY_SLIPPAGE,
      exitSlippage: GH_DEFAULT_EXIT_SLIPPAGE,
      executionBuffer: GH_DEFAULT_EXECUTION_BUFFER
    },
    trainRange: split.trainRange!,
    validationRange: split.validationRange!,
    holdoutRange: split.holdoutRange!
  });

  // ---- ONE holdout run (locked) ----
  const holdoutFinal = split.holdout.map((r) => ({
    ...r,
    labels: relabel(r.labels, selected.theta)
  }));
  const holdoutTrades = runShadowReplay(
    holdoutFinal,
    bundles,
    selected.entry,
    selected.maxHoldSec,
    selected.protectiveStop
  );
  const holdoutBacktest = computePolicyBacktest(holdoutTrades);

  let qualificationStatus: ResearchPipelineResult["qualificationStatus"];
  if (holdoutTrades.length < 5) {
    qualificationStatus = "INSUFFICIENT_DATA";
  } else if (holdoutBacktest.netPnl > 0 && holdoutBacktest.expectancy > 0) {
    qualificationStatus = "HOLDOUT_POSITIVE";
  } else {
    qualificationStatus = "HOLDOUT_NEGATIVE";
  }

  const artifact = buildModelArtifact({
    bundles,
    trainingRange: split.trainRange!,
    validationRange: split.validationRange!,
    holdoutRange: split.holdoutRange!,
    labelConfig: {
      theta: selected.theta,
      entrySlippage: GH_DEFAULT_ENTRY_SLIPPAGE,
      exitSlippage: GH_DEFAULT_EXIT_SLIPPAGE,
      executionBuffer: GH_DEFAULT_EXECUTION_BUFFER,
      targetToleranceMs: GH_TARGET_TOLERANCE_MS
    },
    entryPolicy: {
      pUp5: selected.entry.pUp5,
      pUp15: selected.entry.pUp15,
      pUp30: selected.entry.pUp30,
      consecutiveEvals: selected.entry.consecutiveEvals,
      maxHoldSec: selected.maxHoldSec,
      protectiveStop: selected.protectiveStop
    },
    datasetHash,
    qualificationStatus,
    sharedNorm
  });

  if (args.persist) {
    const dir = args.dataDir ?? defaultResearchDataDir();
    await mkdir(dir, { recursive: true });
    const chunk = await writeChunkFile(
      dir,
      "seconds-quotes",
      labeled.rows.map((r) => ({
        timestampMs: r.timestampMs,
        bid: r.quote.bid,
        ask: r.quote.ask
      }))
    );
    await writeManifest(dir, {
      datasetId: researchRunId,
      featureSchemaVersion: GOLD_HUNTER_FEATURE_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      chunks: [chunk],
      totalRows: labeled.rows.length,
      datasetHash
    });
    await writeModelArtifactFile(dir, artifact);
    await writeFile(
      join(dir, "frozen-config.json"),
      JSON.stringify({ ...frozenConfig, sha256: frozenConfigSha256 }, null, 2)
    );
    await writeFile(
      join(dir, "validation-search.json"),
      JSON.stringify(
        {
          stages: optimizer.stages,
          best: optimizer.best,
          searchedCount: optimizer.searched.length,
          insufficientEdge: optimizer.insufficientEdge,
          stopReport: optimizer.stopReport
        },
        null,
        2
      )
    );
    await writeFile(
      join(dir, "holdout-report.json"),
      JSON.stringify(
        {
          researchRunId,
          strategyVersion: GOLD_HUNTER_STRATEGY_VERSION,
          modelVersion: GOLD_HUNTER_MODEL_VERSION,
          frozenConfigSha256,
          backtest: holdoutBacktest,
          tradeCount: holdoutTrades.length,
          maxLosingStreak: maxLosingStreak(holdoutTrades),
          holdBuckets: holdTimeBuckets(holdoutTrades),
          session: slicePerformance(holdoutTrades, (t) => t.session),
          regime: slicePerformance(holdoutTrades, (t) => t.regime),
          baselines: baselineComparisons(holdoutFinal.map((r) => r.quote))
        },
        null,
        2
      )
    );
  }

  void createHash;

  return {
    researchRunId,
    dataSource: args.dataSource,
    dataQuality,
    gridStats,
    secondRows: labeled.totalSeconds,
    unscorableFeatureRows: labeled.unscorableFeatureRows,
    unscorableLabelRows: labeled.unscorableLabelRows,
    trainCount: split.train.length,
    validationCount: split.validation.length,
    holdoutCount: split.holdout.length,
    purgedCount: split.purgedCount,
    trainRange: split.trainRange,
    validationRange: split.validationRange,
    holdoutRange: split.holdoutRange,
    trainRangeUtc: rangeUtc(split.trainRange),
    validationRangeUtc: rangeUtc(split.validationRange),
    holdoutRangeUtc: rangeUtc(split.holdoutRange),
    selectedTheta: selected.theta,
    selectedEntry: selected.entry,
    selectedMaxHoldSec: selected.maxHoldSec,
    protectiveStop: selected.protectiveStop,
    optimizer,
    frozenConfig,
    frozenConfigSha256,
    horizonMetrics,
    holdoutBacktest,
    holdoutTrades,
    holdoutMaxLosingStreak: maxLosingStreak(holdoutTrades),
    holdoutHoldBuckets: holdTimeBuckets(holdoutTrades),
    holdoutSession: slicePerformance(holdoutTrades, (t) => t.session),
    holdoutRegime: slicePerformance(holdoutTrades, (t) => t.regime),
    baselines: baselineComparisons(holdoutFinal.map((r) => r.quote)),
    movement,
    spread,
    opportunities,
    artifact,
    bundles,
    datasetHash,
    bidTicks,
    askTicks,
    m1BarCount,
    m5BarCount,
    m15BarCount,
    qualificationStatus,
    lowSampleValidation: optimizer.best.lowSampleValidation
  };
}

/** Generate synthetic ticks for unit tests ONLY — never for qualification. */
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
    mid += (rand() - 0.48) * 0.08;
    const bid = mid - spread / 2;
    const ask = mid + spread / 2;
    ticks.push({ timestampMs: t, side: "BID", price: bid });
    ticks.push({ timestampMs: t + 1, side: "ASK", price: ask });
  }
  return ticks;
}
