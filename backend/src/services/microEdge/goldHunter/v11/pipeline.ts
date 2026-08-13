/**
 * GOLD_HUNTER V1.1 edge-discovery research pipeline.
 * TRAIN/VALIDATION selection only → freeze → ONE clean holdout → optional post-audit.
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GH_HORIZONS_SEC, type GhHorizonSec } from "../config";
import { GH_FEATURE_KEYS } from "../types";
import {
  buildAsOfSecondRows,
  buildLabeledResearchRows,
  type RawTick
} from "../asOfDataset";
import { chronologicalSplit } from "../chronologicalSplit";
import type { GhBarCtx } from "../features";
import { classFromNets } from "../labels";
import {
  applyNormalization,
  fitNormalization,
  hashDataset,
  predictHorizon,
  predictProbs,
  trainHorizonModel,
  trainMultinomialLogReg
} from "../model";
import { featureVectorToArray } from "../features";
import { computePolicyBacktest } from "../metrics";
import { evaluateCandidateEligibility } from "../validationOptimizer";
import { deriveProtectiveStopCandidatesFromTrain } from "../protectiveStop";
import {
  absoluteMidMoveDistribution,
  holdTimeBuckets,
  slicePerformance,
  spreadDistribution
} from "../researchReports";
import { utcIso } from "../frozenConfig";
import { classifyRegime } from "../sessionRegime";
import type { GhLabel, GhShadowTrade } from "../types";
import {
  allHorizonOpportunity,
  diagnoseHorizonScores,
  type HorizonRankDiagnosis,
  type OpportunityEconomics
} from "./diagnostics";
import {
  auditAndSelectFeatures,
  featureVectorToV11Array,
  projectFeatures,
  v11FeatureKeyNames
} from "./features";
import { buildFrozenV11, type FrozenV11Config } from "./frozenConfig";
import {
  predictBinarySides,
  predictEdge,
  trainDirectEdgeHorizon,
  trainIndependentBinaryHorizon,
  type HorizonBinaryBundle,
  type HorizonEdgeBundle
} from "./models";
import {
  ARCHITECTURES,
  ensembleBuyScore,
  ensembleSellScore,
  type V11PolicyConfig
} from "./policy";
import { runV11ShadowReplay, type V11ScoreRow } from "./shadowReplay";
import {
  GOLD_HUNTER_V1_REAL_7D_LABEL,
  GOLD_HUNTER_V1_REAL_7D_RUN_ID,
  GOLD_HUNTER_V11_MODEL_RESEARCH_VERSION,
  GOLD_HUNTER_V11_STRATEGY_VERSION,
  type V11ModelFamily,
  type V11QualificationStatus
} from "./versions";

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

function quantile(xs: number[], q: number): number {
  const a = xs.filter(Number.isFinite).sort((u, v) => u - v);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]!;
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function multiDay(trades: GhShadowTrade[]): boolean {
  return new Set(trades.map((t) => t.date)).size >= 2;
}

function dailyStats(trades: GhShadowTrade[]): {
  winningDays: number;
  losingDays: number;
  flatDays: number;
  medianDaily: number;
  bestDay: number;
  worstDay: number;
  tradesPerDay: number;
} {
  const by: Record<string, number> = {};
  for (const t of trades) {
    by[t.date] = (by[t.date] ?? 0) + t.netMove;
  }
  const vals = Object.values(by);
  const winningDays = vals.filter((v) => v > 0).length;
  const losingDays = vals.filter((v) => v < 0).length;
  const flatDays = vals.filter((v) => v === 0).length;
  const sorted = [...vals].sort((a, b) => a - b);
  const medianDaily = sorted.length
    ? sorted[Math.floor(sorted.length / 2)]!
    : 0;
  return {
    winningDays,
    losingDays,
    flatDays,
    medianDaily,
    bestDay: sorted.length ? sorted[sorted.length - 1]! : 0,
    worstDay: sorted.length ? sorted[0]! : 0,
    tradesPerDay: vals.length ? trades.length / vals.length : 0
  };
}

function robustness(trades: GhShadowTrade[]): {
  bestTrade: number;
  worstTrade: number;
  netExBest: number;
  netExBest3: number;
} {
  const nets = trades.map((t) => t.netMove).sort((a, b) => b - a);
  const total = nets.reduce((a, b) => a + b, 0);
  return {
    bestTrade: nets[0] ?? 0,
    worstTrade: nets.length ? nets[nets.length - 1]! : 0,
    netExBest: total - (nets[0] ?? 0),
    netExBest3: total - nets.slice(0, 3).reduce((a, b) => a + b, 0)
  };
}

function maxLosingStreak(trades: GhShadowTrade[]): number {
  let cur = 0;
  let max = 0;
  for (const t of trades) {
    if (t.netMove < 0) {
      cur += 1;
      max = Math.max(max, cur);
    } else cur = 0;
  }
  return max;
}

export type V11PipelineResult = {
  researchRunId: string;
  strategyVersion: string;
  preservedV1: {
    runId: string;
    label: string;
    classification: string;
  };
  dataFromUtc: string;
  dataToUtc: string;
  bidTicks: number;
  askTicks: number;
  gridStats: ReturnType<typeof buildAsOfSecondRows>["stats"];
  spread: ReturnType<typeof spreadDistribution>;
  movement: Record<string, ReturnType<typeof absoluteMidMoveDistribution>>;
  opportunity: Record<GhHorizonSec, OpportunityEconomics>;
  v1Diagnostics: HorizonRankDiagnosis[];
  modelComparison: Array<{
    family: V11ModelFamily;
    validationTrades: number;
    expectancy: number;
    netPnl: number;
    profitFactor: number;
    maxDrawdown: number;
    eligible: boolean;
    rejectReason: string | null;
  }>;
  selectedFamily: V11ModelFamily | null;
  selectedPolicy: V11PolicyConfig | null;
  frozenConfig: FrozenV11Config | null;
  frozenConfigSha256: string | null;
  validation: ReturnType<typeof computePolicyBacktest> & {
    tradesPerDay: number;
    daily: ReturnType<typeof dailyStats>;
  } | null;
  holdout: (ReturnType<typeof computePolicyBacktest> & {
    tradesPerDay: number;
    daily: ReturnType<typeof dailyStats>;
    robustness: ReturnType<typeof robustness>;
    maxLosingStreak: number;
    holdBuckets: ReturnType<typeof holdTimeBuckets>;
    session: ReturnType<typeof slicePerformance>;
    regime: ReturnType<typeof slicePerformance>;
  }) | null;
  postHoldoutAudit: {
    trades: number;
    netPnl: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdown: number;
  } | null;
  qualificationStatus: V11QualificationStatus;
  featureDropped: string[];
  brokerOrders: 0;
  evaluationBrokerRequests: 0;
  mutationSurface: "NONE";
};

function log(event: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: `gh_v11_${event}`, ...extra }));
}

export async function runGoldHunterV11Pipeline(args: {
  ticks: RawTick[];
  m1Bars: GhBarCtx[];
  m5Bars: GhBarCtx[];
  m15Bars: GhBarCtx[];
  dataFromMs: number;
  dataToMs: number;
  /** Optional already-built Aug6-13 rows for post-audit only (after freeze). */
  postAuditTicks?: RawTick[];
  postAuditM1?: GhBarCtx[];
  postAuditM5?: GhBarCtx[];
  postAuditM15?: GhBarCtx[];
  postAuditFromMs?: number;
  postAuditToMs?: number;
  persist?: boolean;
  dataDir?: string;
  /** Subsample step for heavy training (1 = full). */
  trainStride?: number;
}): Promise<V11PipelineResult> {
  const trainStride = Math.max(1, args.trainStride ?? 2);
  const datasetHashSeed = hashDataset(
    args.ticks.map((t) => ({ timestampMs: t.timestampMs }))
  );
  const researchRunId = `GH_REAL_28D_PRE_V1_${datasetHashSeed.slice(0, 8)}`;

  log("asof_start", { ticks: args.ticks.length });
  const { rows: seconds, stats: gridStats } = buildAsOfSecondRows(args.ticks, {
    fromMs: args.dataFromMs,
    toMs: args.dataToMs
  });
  log("asof_done", gridStats);
  const labeled = buildLabeledResearchRows({
    seconds,
    theta: 0,
    m1Bars: args.m1Bars,
    m5Bars: args.m5Bars,
    m15Bars: args.m15Bars
  });
  log("label_done", { rows: labeled.rows.length });
  const split = chronologicalSplit(labeled.rows);
  const datasetHash = hashDataset(labeled.rows);

  const quotes = labeled.rows.map((r) => r.quote);
  const movement = {
    "5": absoluteMidMoveDistribution(quotes, 5),
    "15": absoluteMidMoveDistribution(quotes, 15),
    "30": absoluteMidMoveDistribution(quotes, 30),
    "60": absoluteMidMoveDistribution(quotes, 60)
  };
  const spread = spreadDistribution(quotes);
  const opportunity = allHorizonOpportunity(
    quotes,
    labeled.rows.map((r) => r.labels)
  );

  const bidTicks = args.ticks.filter((t) => t.side === "BID").length;
  const askTicks = args.ticks.filter((t) => t.side === "ASK").length;

  const baseResult = {
    researchRunId,
    strategyVersion: GOLD_HUNTER_V11_STRATEGY_VERSION,
    preservedV1: {
      runId: GOLD_HUNTER_V1_REAL_7D_RUN_ID,
      label: GOLD_HUNTER_V1_REAL_7D_LABEL,
      classification: "INSUFFICIENT_EDGE"
    },
    dataFromUtc: new Date(args.dataFromMs).toISOString(),
    dataToUtc: new Date(args.dataToMs).toISOString(),
    bidTicks,
    askTicks,
    gridStats,
    spread,
    movement,
    opportunity,
    brokerOrders: 0 as const,
    evaluationBrokerRequests: 0 as const,
    mutationSurface: "NONE" as const
  };

  if (split.train.length < 500 || split.validation.length < 100) {
    return {
      ...baseResult,
      v1Diagnostics: [],
      modelComparison: [],
      selectedFamily: null,
      selectedPolicy: null,
      frozenConfig: null,
      frozenConfigSha256: null,
      validation: null,
      holdout: null,
      postHoldoutAudit: null,
      qualificationStatus: "BLOCKED",
      featureDropped: []
    };
  }

  // ---- Feature matrix ----
  const keyNames = v11FeatureKeyNames(GH_FEATURE_KEYS as unknown as string[]);
  const trainIdx = split.train
    .map((_, i) => i)
    .filter((i) => i % trainStride === 0);
  const trainRows = trainIdx.map((i) => split.train[i]!);
  const trainXfull = trainRows.map((r) => featureVectorToV11Array(r.features));
  const { keptIndices, droppedKeys } = auditAndSelectFeatures(
    trainXfull,
    keyNames
  );
  const trainX = projectFeatures(trainXfull, keptIndices);
  const valX = projectFeatures(
    split.validation.map((r) => featureVectorToV11Array(r.features)),
    keptIndices
  );
  const holdX = projectFeatures(
    split.holdout.map((r) => featureVectorToV11Array(r.features)),
    keptIndices
  );

  const theta = 0.05;
  const trainLab = trainRows.map((r) => relabel(r.labels, theta));
  const valLab = split.validation.map((r) => relabel(r.labels, theta));

  // ---- V1 multinomial diagnostics (subsample train + val for speed) ----
  log("v1_diag_start");
  const v1Diagnostics: HorizonRankDiagnosis[] = [];
  const valDiagStride = Math.max(1, Math.ceil(split.validation.length / 80_000));
  const valDiagRows = split.validation.filter((_, i) => i % valDiagStride === 0);
  const valDiagLab = valDiagRows.map((r) => relabel(r.labels, theta));
  const multiBundles: ReturnType<typeof trainHorizonModel>[] = [];
  for (const h of GH_HORIZONS_SEC) {
    const bundle = trainHorizonModel(
      h,
      trainRows.map((r) => r.features),
      trainLab.map((l) => l[h]!),
      valDiagRows.map((r) => r.features),
      valDiagLab.map((l) => l[h]!)
    );
    multiBundles.push(bundle);
    const pUp: number[] = [];
    const pDown: number[] = [];
    const pNoEdge: number[] = [];
    for (const r of valDiagRows) {
      const pr = predictHorizon(bundle, r.features);
      pUp.push(pr.pUp);
      pDown.push(pr.pDown);
      pNoEdge.push(pr.pNoEdge);
    }
    v1Diagnostics.push(
      diagnoseHorizonScores({
        horizonSec: h,
        pUp,
        pDown,
        pNoEdge,
        labels: valDiagLab.map((l) => l[h]!)
      })
    );
  }
  log("v1_diag_done", {
    ranks: v1Diagnostics.map((d) => ({ h: d.horizonSec, r: d.rankSignal }))
  });

  // ---- Family B: independent binary ----
  log("train_binary");
  const binaryBundles: HorizonBinaryBundle[] = [];
  for (const h of GH_HORIZONS_SEC) {
    const buyY = trainLab.map((l) =>
      l[h]!.netLong != null && l[h]!.netLong >= theta ? 1 : 0
    );
    const sellY = trainLab.map((l) =>
      l[h]!.netShort != null && l[h]!.netShort >= theta ? 1 : 0
    );
    binaryBundles.push(
      trainIndependentBinaryHorizon({
        horizonSec: h,
        trainX,
        trainBuyY: buyY,
        trainSellY: sellY,
        valX,
        valNetLong: valLab.map((l) => l[h]!.netLong ?? 0),
        valNetShort: valLab.map((l) => l[h]!.netShort ?? 0)
      })
    );
  }

  // ---- Family C: ridge edge ----
  log("train_ridge");
  const ridgeBundles: HorizonEdgeBundle[] = [];
  for (const h of GH_HORIZONS_SEC) {
    ridgeBundles.push(
      trainDirectEdgeHorizon({
        horizonSec: h,
        trainX,
        trainNetLong: trainLab.map((l) => l[h]!.netLong ?? 0),
        trainNetShort: trainLab.map((l) => l[h]!.netShort ?? 0),
        kind: "ridge"
      })
    );
  }

  // ---- Family D: stump boost ----
  log("train_stumps");
  const stumpBundles: HorizonEdgeBundle[] = [];
  for (const h of GH_HORIZONS_SEC) {
    stumpBundles.push(
      trainDirectEdgeHorizon({
        horizonSec: h,
        trainX,
        trainNetLong: trainLab.map((l) => l[h]!.netLong ?? 0),
        trainNetShort: trainLab.map((l) => l[h]!.netShort ?? 0),
        kind: "stump_boost"
      })
    );
  }

  const stopCandidates = deriveProtectiveStopCandidatesFromTrain({
    trainMids: split.train.map((r) => (r.quote.bid + r.quote.ask) / 2),
    absMoves5: (() => {
      const m = new Map(
        split.train.map((r) => [r.timestampMs, (r.quote.bid + r.quote.ask) / 2])
      );
      const out: number[] = [];
      for (const r of split.train) {
        const n = m.get(r.timestampMs + 5000);
        if (n == null) continue;
        out.push(Math.abs(n - (r.quote.bid + r.quote.ask) / 2));
      }
      return out;
    })()
  });

  const spreadP75 = quantile(
    split.validation.map((r) => r.quote.ask - r.quote.bid),
    0.75
  );
  const spreadP90 = quantile(
    split.validation.map((r) => r.quote.ask - r.quote.bid),
    0.9
  );

  type ScoredFamily = {
    family: V11ModelFamily;
    scoreRows: V11ScoreRow[];
  };

  const buildBinaryScores = (
    rows: typeof split.validation,
    X: number[][]
  ): V11ScoreRow[] =>
    rows.map((r, i) => {
      const byHorizon: V11ScoreRow["scores"]["byHorizon"] = {};
      for (const b of binaryBundles) {
        const p = predictBinarySides(b, X[i]!);
        // Rank on raw tradeable probability; calibrated nets remain available
        // via pBuy/pSell metadata for reporting. Absolute calibrated floors
        // alone compressed V1 into ZERO_TRADES.
        byHorizon[b.horizonSec] = {
          buyScore: p.pBuy,
          sellScore: p.pSell,
          pBuy: p.pBuy,
          pSell: p.pSell
        };
      }
      return {
        timestampMs: r.timestampMs,
        bid: r.quote.bid,
        ask: r.quote.ask,
        spread: r.quote.ask - r.quote.bid,
        regime: r.features.regime,
        dataOk: true,
        scores: {
          buyScore: byHorizon[15]?.buyScore ?? 0,
          sellScore: byHorizon[15]?.sellScore ?? 0,
          byHorizon
        }
      };
    });

  const buildEdgeScores = (
    rows: typeof split.validation,
    X: number[][],
    bundles: HorizonEdgeBundle[],
    mode: "raw" | "edgeOverSpread" = "edgeOverSpread"
  ): V11ScoreRow[] =>
    rows.map((r, i) => {
      const byHorizon: V11ScoreRow["scores"]["byHorizon"] = {};
      const spread = Math.max(r.quote.ask - r.quote.bid, 1e-6);
      for (const b of bundles) {
        const e = predictEdge(b, X[i]!);
        const buy =
          mode === "edgeOverSpread"
            ? e.expectedNetLong / spread
            : e.expectedNetLong;
        const sell =
          mode === "edgeOverSpread"
            ? e.expectedNetShort / spread
            : e.expectedNetShort;
        byHorizon[b.horizonSec] = { buyScore: buy, sellScore: sell };
      }
      return {
        timestampMs: r.timestampMs,
        bid: r.quote.bid,
        ask: r.quote.ask,
        spread: r.quote.ask - r.quote.bid,
        regime: r.features.regime,
        dataOk: true,
        scores: {
          buyScore: byHorizon[15]?.buyScore ?? 0,
          sellScore: byHorizon[15]?.sellScore ?? 0,
          byHorizon
        }
      };
    });

  const withArchScores = (
    rows: V11ScoreRow[],
    archId: V11PolicyConfig["architecture"]
  ): V11ScoreRow[] =>
    rows.map((r) => ({
      ...r,
      scores: {
        ...r.scores,
        buyScore: ensembleBuyScore(archId, r.scores.byHorizon),
        sellScore: ensembleSellScore(archId, r.scores.byHorizon)
      }
    }));

  // Multinomial baseline scores reuse diag-trained bundles
  const buildMultiScores = (rows: typeof split.validation): V11ScoreRow[] =>
    rows.map((r) => {
      const byHorizon: V11ScoreRow["scores"]["byHorizon"] = {};
      for (const b of multiBundles) {
        const p = predictHorizon(b, r.features);
        byHorizon[b.horizonSec] = {
          buyScore: p.pUp,
          sellScore: p.pDown,
          pBuy: p.pUp,
          pSell: p.pDown
        };
      }
      return {
        timestampMs: r.timestampMs,
        bid: r.quote.bid,
        ask: r.quote.ask,
        spread: r.quote.ask - r.quote.bid,
        regime: r.features.regime,
        dataOk: true,
        scores: {
          buyScore: byHorizon[15]?.buyScore ?? 0,
          sellScore: byHorizon[15]?.sellScore ?? 0,
          byHorizon
        }
      };
    });

  // Optimizer uses a deterministic validation subsample for search speed;
  // final selected policy is re-scored on full validation before freeze.
  const valOptStride = Math.max(1, Math.ceil(split.validation.length / 120_000));
  const valOptRows = split.validation.filter((_, i) => i % valOptStride === 0);
  const valOptX = valX.filter((_, i) => i % valOptStride === 0);
  log("optimizer_val_subsample", {
    full: split.validation.length,
    used: valOptRows.length,
    stride: valOptStride
  });

  const families: ScoredFamily[] = [
    {
      family: "multinomial_v1_baseline",
      scoreRows: buildMultiScores(valOptRows)
    },
    {
      family: "independent_binary",
      scoreRows: buildBinaryScores(valOptRows, valOptX)
    },
    {
      family: "direct_edge_ridge",
      scoreRows: buildEdgeScores(valOptRows, valOptX, ridgeBundles)
    },
    {
      family: "stump_boost_edge",
      scoreRows: buildEdgeScores(valOptRows, valOptX, stumpBundles)
    }
  ];

  type Cand = {
    family: V11ModelFamily;
    policy: V11PolicyConfig;
    trades: GhShadowTrade[];
    eligibility: ReturnType<typeof evaluateCandidateEligibility>;
  };

  let best: Cand | null = null;
  /** Best non-eligible with positive net — for reporting + full-val promotion. */
  let bestNearMiss: Cand | null = null;
  const modelComparison: V11PipelineResult["modelComparison"] = [];
  const rejectHistogram: Record<string, number> = {};

  const noteReject = (reason: string | null): void => {
    const key = reason ?? "UNKNOWN";
    rejectHistogram[key] = (rejectHistogram[key] ?? 0) + 1;
  };

  const consider = (
    family: V11ModelFamily,
    rows: V11ScoreRow[],
    policy: V11PolicyConfig,
    familyBest: { current: Cand | null; nearMiss: Cand | null }
  ): void => {
    const trades = runV11ShadowReplay(rows, policy);
    const eligibility = evaluateCandidateEligibility(trades);
    const cand: Cand = { family, policy, trades, eligibility };
    if (!eligibility.eligible || !multiDay(trades)) {
      noteReject(
        !multiDay(trades) && eligibility.stats.tradeCount > 0
          ? "SINGLE_DAY_ONLY"
          : eligibility.rejectReason
      );
      // Promote near-misses that look economically positive but fail
      // subsample domination / tiny-day checks — full val may dilute outliers.
      if (
        eligibility.stats.tradeCount >= 30 &&
        eligibility.stats.expectancy > 0 &&
        eligibility.stats.netPnl > 0 &&
        eligibility.stats.profitFactor > 1
      ) {
        if (
          !familyBest.nearMiss ||
          eligibility.stats.expectancy >
            familyBest.nearMiss.eligibility.stats.expectancy
        ) {
          familyBest.nearMiss = cand;
        }
        if (
          !bestNearMiss ||
          eligibility.stats.expectancy >
            bestNearMiss.eligibility.stats.expectancy
        ) {
          bestNearMiss = cand;
        }
      }
      return;
    }
    if (
      !familyBest.current ||
      eligibility.score > familyBest.current.eligibility.score
    ) {
      familyBest.current = cand;
    }
    if (!best || eligibility.score > best.eligibility.score) best = cand;
  };

  log("optimizer_start");
  // Stage 1: family × architecture × absolute floors + rank/quantile entry
  for (const fam of families) {
    const familyBest: { current: Cand | null; nearMiss: Cand | null } = {
      current: null,
      nearMiss: null
    };
    for (const arch of ARCHITECTURES) {
      const rows = withArchScores(fam.scoreRows, arch.id);
      const buyScores = rows.map((r) => r.scores.buyScore);
      const sellScores = rows.map((r) => r.scores.sellScore);
      // Absolute edge floors (useful for direct-edge families)
      for (const minEdge of [0, 0.02, 0.05, 0.1]) {
        consider(
          fam.family,
          rows,
          {
            architecture: arch.id,
            primaryHorizon: arch.primary,
            contextHorizons: arch.context,
            minEdge,
            rankQuantile: null,
            buyScoreFloor: minEdge,
            sellScoreFloor: minEdge,
            maxSpread: spreadP90,
            consecutiveEvals: 1,
            maxHoldSec: 30,
            protectiveStop: stopCandidates[2] ?? 0.6,
            opposeVetoScore: 999,
            theta
          },
          familyBest
        );
      }
      // Rank / quantile entry — critical when absolute probs are compressed
      for (const rq of [0.9, 0.95, 0.98, 0.99, 0.995] as const) {
        const buyFloor = quantile(buyScores, rq);
        const sellFloor = quantile(sellScores, rq);
        for (const maxHoldSec of [5, 10, 30] as const) {
          for (const opposeVetoScore of [999, 0.55] as const) {
            consider(
              fam.family,
              rows,
              {
                architecture: arch.id,
                primaryHorizon: arch.primary,
                contextHorizons: arch.context,
                minEdge: 0,
                rankQuantile: rq,
                buyScoreFloor: buyFloor,
                sellScoreFloor: sellFloor,
                maxSpread: spreadP90,
                consecutiveEvals: 1,
                maxHoldSec,
                protectiveStop: stopCandidates[2] ?? 0.6,
                opposeVetoScore,
                theta
              },
              familyBest
            );
          }
        }
      }
    }
    const reportCand = familyBest.current ?? familyBest.nearMiss;
    modelComparison.push({
      family: fam.family,
      validationTrades: reportCand?.eligibility.stats.tradeCount ?? 0,
      expectancy: reportCand?.eligibility.stats.expectancy ?? 0,
      netPnl: reportCand?.eligibility.stats.netPnl ?? 0,
      profitFactor: reportCand?.eligibility.stats.profitFactor ?? 0,
      maxDrawdown: reportCand?.eligibility.stats.maxDrawdown ?? 0,
      eligible: Boolean(familyBest.current?.eligibility.eligible),
      rejectReason: familyBest.current
        ? null
        : familyBest.nearMiss?.eligibility.rejectReason ?? "NO_ELIGIBLE_STAGE1"
    });
  }

  // Stage 2: edge/rank thresholds around best family+arch (or near-miss seed)
  const stageSeed = best ?? bestNearMiss;
  if (stageSeed) {
    const fam = families.find((f) => f.family === stageSeed.family)!;
    const arch =
      ARCHITECTURES.find((a) => a.id === stageSeed.policy.architecture) ??
      ARCHITECTURES[1]!;
    const rows = withArchScores(fam.scoreRows, arch.id);
    const buyScores = rows.map((r) => r.scores.buyScore);
    const sellScores = rows.map((r) => r.scores.sellScore);
    const familyBest: { current: Cand | null; nearMiss: Cand | null } = {
      current: best,
      nearMiss: bestNearMiss
    };
    for (const rq of [null, 0.95, 0.99, 0.995] as const) {
      const buyFloor = rq == null ? 0 : quantile(buyScores, rq);
      const sellFloor = rq == null ? 0 : quantile(sellScores, rq);
      for (const minEdge of [0, 0.02, 0.05, 0.1, 0.15, 0.2]) {
        for (const maxSpread of [spreadP75, spreadP90]) {
          consider(
            fam.family,
            rows,
            {
              architecture: arch.id,
              primaryHorizon: arch.primary,
              contextHorizons: arch.context,
              minEdge,
              rankQuantile: rq,
              buyScoreFloor:
                rq == null ? minEdge : Math.max(minEdge, buyFloor),
              sellScoreFloor:
                rq == null ? minEdge : Math.max(minEdge, sellFloor),
              maxSpread,
              consecutiveEvals: stageSeed.policy.consecutiveEvals,
              maxHoldSec: stageSeed.policy.maxHoldSec,
              protectiveStop: stageSeed.policy.protectiveStop,
              opposeVetoScore: stageSeed.policy.opposeVetoScore,
              theta
            },
            familyBest
          );
        }
      }
    }
    best = familyBest.current ?? best;
    bestNearMiss = familyBest.nearMiss ?? bestNearMiss;
  }

  // Stage 3: confirmation + context veto refine
  if (best || bestNearMiss) {
    const seed = best ?? bestNearMiss!;
    const fam = families.find((f) => f.family === seed.family)!;
    const arch =
      ARCHITECTURES.find((a) => a.id === seed.policy.architecture) ??
      ARCHITECTURES[1]!;
    const rows = withArchScores(fam.scoreRows, arch.id);
    const familyBest: { current: Cand | null; nearMiss: Cand | null } = {
      current: best,
      nearMiss: bestNearMiss
    };
    for (const consecutiveEvals of [1, 2, 3]) {
      for (const opposeVetoScore of [999, 0.55, 0.45, seed.policy.opposeVetoScore]) {
        consider(
          fam.family,
          rows,
          {
            ...seed.policy,
            consecutiveEvals,
            opposeVetoScore
          },
          familyBest
        );
      }
    }
    best = familyBest.current ?? best;
    bestNearMiss = familyBest.nearMiss ?? bestNearMiss;
  }

  // Stage 4: exit / maxHold / stop
  if (best || bestNearMiss) {
    const seed = best ?? bestNearMiss!;
    const fam = families.find((f) => f.family === seed.family)!;
    const arch =
      ARCHITECTURES.find((a) => a.id === seed.policy.architecture) ??
      ARCHITECTURES[1]!;
    const rows = withArchScores(fam.scoreRows, arch.id);
    const familyBest: { current: Cand | null; nearMiss: Cand | null } = {
      current: best,
      nearMiss: bestNearMiss
    };
    for (const maxHoldSec of [5, 10, 15, 20, 30, 45, 60]) {
      for (const protectiveStop of stopCandidates.slice(0, 4)) {
        consider(
          fam.family,
          rows,
          {
            ...seed.policy,
            maxHoldSec,
            protectiveStop
          },
          familyBest
        );
      }
    }
    best = familyBest.current ?? best;
    bestNearMiss = familyBest.nearMiss ?? bestNearMiss;
  }
  log("optimizer_done", {
    bestFamily: best?.family ?? null,
    trades: best?.eligibility.stats.tradeCount ?? 0,
    expectancy: best?.eligibility.stats.expectancy ?? 0,
    nearMissFamily: bestNearMiss?.family ?? null,
    nearMissExp: bestNearMiss?.eligibility.stats.expectancy ?? 0,
    nearMissReject: bestNearMiss?.eligibility.rejectReason ?? null,
    rejectHistogram
  });

  const scoreFamilyRows = (
    family: V11ModelFamily,
    rows: typeof split.train,
    X: number[][]
  ): V11ScoreRow[] => {
    if (family === "independent_binary") return buildBinaryScores(rows as typeof split.validation, X);
    if (family === "direct_edge_ridge")
      return buildEdgeScores(rows as typeof split.validation, X, ridgeBundles);
    if (family === "stump_boost_edge")
      return buildEdgeScores(rows as typeof split.validation, X, stumpBundles);
    return buildMultiScores(rows as typeof split.validation);
  };

  // If subsample found no eligible winner, promote near-misses to FULL validation
  // (outlier domination often dilutes with more trades / days).
  if (!best && bestNearMiss) {
    log("full_validation_promote_nearmiss", {
      family: bestNearMiss.family,
      reject: bestNearMiss.eligibility.rejectReason,
      subsampleTrades: bestNearMiss.eligibility.stats.tradeCount,
      subsampleExp: bestNearMiss.eligibility.stats.expectancy
    });
    const promotePolicies: V11PolicyConfig[] = [bestNearMiss.policy];
    // Also try a few close variants on full val
    for (const maxHoldSec of [5, 10, 15, 30]) {
      promotePolicies.push({ ...bestNearMiss.policy, maxHoldSec });
    }
    for (const maxSpread of [spreadP75, spreadP90]) {
      promotePolicies.push({ ...bestNearMiss.policy, maxSpread });
    }
    const seen = new Set<string>();
    for (const policy of promotePolicies) {
      const key = JSON.stringify(policy);
      if (seen.has(key)) continue;
      seen.add(key);
      const fullRows = withArchScores(
        scoreFamilyRows(bestNearMiss.family, split.validation, valX),
        policy.architecture
      );
      const trades = runV11ShadowReplay(fullRows, policy);
      const elig = evaluateCandidateEligibility(trades);
      if (elig.eligible && multiDay(trades)) {
        best = {
          family: bestNearMiss.family,
          policy,
          trades,
          eligibility: elig
        };
        log("full_validation_promote_hit", {
          trades: elig.stats.tradeCount,
          exp: elig.stats.expectancy,
          pf: elig.stats.profitFactor
        });
        break;
      }
    }
  }

  if (!best) {
    const result: V11PipelineResult = {
      ...baseResult,
      v1Diagnostics,
      modelComparison,
      selectedFamily: bestNearMiss?.family ?? null,
      selectedPolicy: bestNearMiss?.policy ?? null,
      frozenConfig: null,
      frozenConfigSha256: null,
      validation: bestNearMiss
        ? {
            ...bestNearMiss.eligibility.stats,
            tradesPerDay: dailyStats(bestNearMiss.trades).tradesPerDay,
            daily: dailyStats(bestNearMiss.trades)
          }
        : null,
      holdout: null,
      postHoldoutAudit: null,
      qualificationStatus: "NO_PREDICTIVE_EDGE",
      featureDropped: droppedKeys
    };
    if (args.persist && args.dataDir) {
      mkdirSync(args.dataDir, { recursive: true });
      writeFileSync(
        join(args.dataDir, "phase2b2-v11-report.json"),
        JSON.stringify(
          { ...result, rejectHistogram, nearMiss: bestNearMiss?.policy ?? null },
          null,
          2
        )
      );
    }
    return result;
  }

  // Re-score selected policy on FULL validation before freeze
  log("full_validation_rescore", { family: best.family });
  const fullValRows = withArchScores(
    scoreFamilyRows(best.family, split.validation, valX),
    best.policy.architecture
  );
  const fullValTrades = runV11ShadowReplay(fullValRows, best.policy);
  const fullValElig = evaluateCandidateEligibility(fullValTrades);
  if (!(fullValElig.eligible && multiDay(fullValTrades))) {
    const result: V11PipelineResult = {
      ...baseResult,
      v1Diagnostics,
      modelComparison,
      selectedFamily: best.family,
      selectedPolicy: best.policy,
      frozenConfig: null,
      frozenConfigSha256: null,
      validation: {
        ...fullValElig.stats,
        tradesPerDay: dailyStats(fullValTrades).tradesPerDay,
        daily: dailyStats(fullValTrades)
      },
      holdout: null,
      postHoldoutAudit: null,
      qualificationStatus: "NO_PREDICTIVE_EDGE",
      featureDropped: droppedKeys
    };
    if (args.persist && args.dataDir) {
      mkdirSync(args.dataDir, { recursive: true });
      writeFileSync(
        join(args.dataDir, "phase2b2-v11-report.json"),
        JSON.stringify({ ...result, rejectHistogram }, null, 2)
      );
    }
    return result;
  }
  // Re-derive rank floors on FULL validation (never holdout) before freeze
  let freezePolicy = best.policy;
  if (best.policy.rankQuantile != null) {
    const rq = best.policy.rankQuantile;
    freezePolicy = {
      ...best.policy,
      buyScoreFloor: quantile(
        fullValRows.map((r) => r.scores.buyScore),
        rq
      ),
      sellScoreFloor: quantile(
        fullValRows.map((r) => r.scores.sellScore),
        rq
      )
    };
    const refitTrades = runV11ShadowReplay(fullValRows, freezePolicy);
    const refitElig = evaluateCandidateEligibility(refitTrades);
    if (!(refitElig.eligible && multiDay(refitTrades))) {
      const result: V11PipelineResult = {
        ...baseResult,
        v1Diagnostics,
        modelComparison,
        selectedFamily: best.family,
        selectedPolicy: freezePolicy,
        frozenConfig: null,
        frozenConfigSha256: null,
        validation: {
          ...refitElig.stats,
          tradesPerDay: dailyStats(refitTrades).tradesPerDay,
          daily: dailyStats(refitTrades)
        },
        holdout: null,
        postHoldoutAudit: null,
        qualificationStatus: "NO_PREDICTIVE_EDGE",
        featureDropped: droppedKeys
      };
      if (args.persist && args.dataDir) {
        mkdirSync(args.dataDir, { recursive: true });
        writeFileSync(
          join(args.dataDir, "phase2b2-v11-report.json"),
          JSON.stringify({ ...result, rejectHistogram }, null, 2)
        );
      }
      return result;
    }
    best = {
      family: best.family,
      policy: freezePolicy,
      trades: refitTrades,
      eligibility: refitElig
    };
  } else {
    best = {
      family: best.family,
      policy: freezePolicy,
      trades: fullValTrades,
      eligibility: fullValElig
    };
  }

  // ---- FREEZE ----
  const trainRangeUtc = {
    from: utcIso(split.trainRange!.fromMs),
    to: utcIso(split.trainRange!.toMs)
  };
  const validationRangeUtc = {
    from: utcIso(split.validationRange!.fromMs),
    to: utcIso(split.validationRange!.toMs)
  };
  const holdoutRangeUtc = {
    from: utcIso(split.holdoutRange!.fromMs),
    to: utcIso(split.holdoutRange!.toMs)
  };
  log("freeze", { family: best.family, arch: best.policy.architecture });
  const { config: frozenConfig, sha256: frozenConfigSha256 } = buildFrozenV11({
    researchRunId,
    modelFamily: best.family,
    datasetHash,
    policy: best.policy,
    keptFeatureIndices: keptIndices,
    trainRangeUtc,
    validationRangeUtc,
    holdoutRangeUtc
  });

  const valDaily = dailyStats(best.trades);
  const validation = {
    ...best.eligibility.stats,
    tradesPerDay: valDaily.tradesPerDay,
    daily: valDaily
  };

  // ---- HOLDOUT (scores with frozen family only) ----
  log("holdout_start");
  const holdRows = withArchScores(
    scoreFamilyRows(best.family, split.holdout, holdX),
    best.policy.architecture
  );
  const holdTrades = runV11ShadowReplay(holdRows, best.policy);
  const holdBt = computePolicyBacktest(holdTrades);
  const holdDaily = dailyStats(holdTrades);
  const holdout = {
    ...holdBt,
    tradesPerDay: holdDaily.tradesPerDay,
    daily: holdDaily,
    robustness: robustness(holdTrades),
    maxLosingStreak: maxLosingStreak(holdTrades),
    holdBuckets: holdTimeBuckets(holdTrades),
    session: slicePerformance(holdTrades, (t) => t.session),
    regime: slicePerformance(holdTrades, (t) => t.regime)
  };
  log("holdout_done", {
    trades: holdBt.tradeCount,
    net: holdBt.netPnl,
    exp: holdBt.expectancy
  });

  // ---- Post-holdout audit on Aug6-13 (frozen policy, no retune) ----
  let postHoldoutAudit: V11PipelineResult["postHoldoutAudit"] = null;
  if (
    args.postAuditTicks?.length &&
    args.postAuditFromMs != null &&
    args.postAuditToMs != null
  ) {
    log("post_audit_start");
    const { rows: sec2 } = buildAsOfSecondRows(args.postAuditTicks, {
      fromMs: args.postAuditFromMs,
      toMs: args.postAuditToMs
    });
    const lab2 = buildLabeledResearchRows({
      seconds: sec2,
      theta: 0,
      m1Bars: args.postAuditM1 ?? [],
      m5Bars: args.postAuditM5 ?? [],
      m15Bars: args.postAuditM15 ?? []
    });
    const X2 = projectFeatures(
      lab2.rows.map((r) => featureVectorToV11Array(r.features)),
      keptIndices
    );
    const rows2 = withArchScores(
      scoreFamilyRows(best.family, lab2.rows, X2),
      best.policy.architecture
    );
    const t2 = runV11ShadowReplay(rows2, best.policy);
    const bt2 = computePolicyBacktest(t2);
    postHoldoutAudit = {
      trades: bt2.tradeCount,
      netPnl: bt2.netPnl,
      profitFactor: bt2.profitFactor,
      expectancy: bt2.expectancy,
      maxDrawdown: bt2.maxDrawdown
    };
    log("post_audit_done", postHoldoutAudit);
  }

  let qualificationStatus: V11QualificationStatus;
  if (holdBt.tradeCount < 5) qualificationStatus = "INSUFFICIENT_EDGE";
  else if (
    holdBt.netPnl > 0 &&
    holdBt.expectancy > 0 &&
    holdBt.profitFactor > 1
  ) {
    if (
      postHoldoutAudit &&
      postHoldoutAudit.trades >= 5 &&
      postHoldoutAudit.netPnl < 0 &&
      postHoldoutAudit.expectancy < 0
    ) {
      qualificationStatus = "MIXED";
    } else {
      qualificationStatus = "POSITIVE";
    }
  } else if (holdBt.netPnl <= 0 || holdBt.expectancy <= 0) {
    qualificationStatus = "NEGATIVE";
  } else {
    qualificationStatus = "MIXED";
  }

  const result: V11PipelineResult = {
    ...baseResult,
    v1Diagnostics,
    modelComparison,
    selectedFamily: best.family,
    selectedPolicy: best.policy,
    frozenConfig,
    frozenConfigSha256,
    validation,
    holdout,
    postHoldoutAudit,
    qualificationStatus,
    featureDropped: droppedKeys
  };

  if (args.persist && args.dataDir) {
    mkdirSync(args.dataDir, { recursive: true });
    writeFileSync(
      join(args.dataDir, "frozen-v11-config.json"),
      JSON.stringify({ config: frozenConfig, sha256: frozenConfigSha256 }, null, 2)
    );
    writeFileSync(
      join(args.dataDir, "phase2b2-v11-report.json"),
      JSON.stringify(result, null, 2)
    );
  }
  return result;
}

// silence unused import warnings for helpers kept for API symmetry
void createHash;
void fitNormalization;
void applyNormalization;
void featureVectorToArray;
void trainMultinomialLogReg;
void predictProbs;
void classifyRegime;
void dayKey;
void GOLD_HUNTER_V11_MODEL_RESEARCH_VERSION;
