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

  // ---- V1 multinomial diagnostics (subsample train for speed) ----
  log("v1_diag_start");
  const v1Diagnostics: HorizonRankDiagnosis[] = [];
  for (const h of GH_HORIZONS_SEC) {
    const bundle = trainHorizonModel(
      h,
      trainRows.map((r) => r.features),
      trainLab.map((l) => l[h]!),
      split.validation.map((r) => r.features),
      valLab.map((l) => l[h]!)
    );
    const pUp: number[] = [];
    const pDown: number[] = [];
    const pNoEdge: number[] = [];
    for (const r of split.validation) {
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
        labels: valLab.map((l) => l[h]!)
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
        byHorizon[b.horizonSec] = {
          buyScore: p.calibratedBuyNet,
          sellScore: p.calibratedSellNet,
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
    bundles: HorizonEdgeBundle[]
  ): V11ScoreRow[] =>
    rows.map((r, i) => {
      const byHorizon: V11ScoreRow["scores"]["byHorizon"] = {};
      for (const b of bundles) {
        const e = predictEdge(b, X[i]!);
        const spread = r.quote.ask - r.quote.bid;
        byHorizon[b.horizonSec] = {
          buyScore: e.expectedNetLong,
          sellScore: e.expectedNetShort
        };
        void spread;
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

  // Multinomial baseline scores from V1 bundles (reuse diag training)
  const multiBundles = GH_HORIZONS_SEC.map((h) =>
    trainHorizonModel(
      h,
      trainRows.map((r) => r.features),
      trainLab.map((l) => l[h]!),
      split.validation.map((r) => r.features),
      valLab.map((l) => l[h]!)
    )
  );
  const buildMultiScores = (rows: typeof split.validation): V11ScoreRow[] =>
    rows.map((r) => {
      const byHorizon: V11ScoreRow["scores"]["byHorizon"] = {};
      for (const b of multiBundles) {
        const p = predictHorizon(b, r.features);
        byHorizon[b.horizonSec] = {
          buyScore: p.expectedNetBuy,
          sellScore: p.expectedNetSell,
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

  const families: ScoredFamily[] = [
    {
      family: "multinomial_v1_baseline",
      scoreRows: buildMultiScores(split.validation)
    },
    {
      family: "independent_binary",
      scoreRows: buildBinaryScores(split.validation, valX)
    },
    {
      family: "direct_edge_ridge",
      scoreRows: buildEdgeScores(split.validation, valX, ridgeBundles)
    },
    {
      family: "stump_boost_edge",
      scoreRows: buildEdgeScores(split.validation, valX, stumpBundles)
    }
  ];

  type Cand = {
    family: V11ModelFamily;
    policy: V11PolicyConfig;
    trades: GhShadowTrade[];
    eligibility: ReturnType<typeof evaluateCandidateEligibility>;
  };

  let best: Cand | null = null;
  const modelComparison: V11PipelineResult["modelComparison"] = [];

  const consider = (
    family: V11ModelFamily,
    rows: V11ScoreRow[],
    policy: V11PolicyConfig,
    familyBest: { current: Cand | null }
  ): void => {
    const trades = runV11ShadowReplay(rows, policy);
    const eligibility = evaluateCandidateEligibility(trades);
    if (!(eligibility.eligible && multiDay(trades))) return;
    const cand: Cand = { family, policy, trades, eligibility };
    if (
      !familyBest.current ||
      eligibility.score > familyBest.current.eligibility.score
    ) {
      familyBest.current = cand;
    }
    if (!best || eligibility.score > best.eligibility.score) best = cand;
  };

  log("optimizer_start");
  // Stage 1: family × architecture × coarse edge
  for (const fam of families) {
    const familyBest: { current: Cand | null } = { current: null };
    for (const arch of ARCHITECTURES) {
      const buyScores = fam.scoreRows.map((r) =>
        ensembleBuyScore(arch.id, r.scores.byHorizon)
      );
      const sellScores = fam.scoreRows.map((r) =>
        ensembleSellScore(arch.id, r.scores.byHorizon)
      );
      const rows = fam.scoreRows.map((r, i) => ({
        ...r,
        scores: {
          ...r.scores,
          buyScore: buyScores[i]!,
          sellScore: sellScores[i]!
        }
      }));
      for (const minEdge of [0.02, 0.05, 0.1]) {
        consider(fam.family, rows, {
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
          opposeVetoScore: Math.max(0.15, minEdge * 2),
          theta
        }, familyBest);
      }
    }
    modelComparison.push({
      family: fam.family,
      validationTrades: familyBest.current?.eligibility.stats.tradeCount ?? 0,
      expectancy: familyBest.current?.eligibility.stats.expectancy ?? 0,
      netPnl: familyBest.current?.eligibility.stats.netPnl ?? 0,
      profitFactor: familyBest.current?.eligibility.stats.profitFactor ?? 0,
      maxDrawdown: familyBest.current?.eligibility.stats.maxDrawdown ?? 0,
      eligible: Boolean(familyBest.current?.eligibility.eligible),
      rejectReason: familyBest.current ? null : "NO_ELIGIBLE_STAGE1"
    });
  }

  // Stage 2: edge/rank thresholds around best family+arch
  if (best) {
    const fam = families.find((f) => f.family === best!.family)!;
    const arch =
      ARCHITECTURES.find((a) => a.id === best!.policy.architecture) ??
      ARCHITECTURES[1]!;
    const buyScores = fam.scoreRows.map((r) =>
      ensembleBuyScore(arch.id, r.scores.byHorizon)
    );
    const sellScores = fam.scoreRows.map((r) =>
      ensembleSellScore(arch.id, r.scores.byHorizon)
    );
    const rows = fam.scoreRows.map((r, i) => ({
      ...r,
      scores: {
        ...r.scores,
        buyScore: buyScores[i]!,
        sellScore: sellScores[i]!
      }
    }));
    const familyBest: { current: Cand | null } = { current: best };
    for (const rq of [null, 0.95, 0.99] as const) {
      const buyFloor = rq == null ? 0 : quantile(buyScores, rq);
      const sellFloor = rq == null ? 0 : quantile(sellScores, rq);
      for (const minEdge of [0, 0.02, 0.05, 0.1, 0.15, 0.2]) {
        for (const maxSpread of [spreadP75, spreadP90]) {
          consider(fam.family, rows, {
            architecture: arch.id,
            primaryHorizon: arch.primary,
            contextHorizons: arch.context,
            minEdge,
            rankQuantile: rq,
            buyScoreFloor: Math.max(minEdge, buyFloor),
            sellScoreFloor: Math.max(minEdge, sellFloor),
            maxSpread,
            consecutiveEvals: best.policy.consecutiveEvals,
            maxHoldSec: best.policy.maxHoldSec,
            protectiveStop: best.policy.protectiveStop,
            opposeVetoScore: Math.max(0.1, minEdge * 2),
            theta
          }, familyBest);
        }
      }
    }
    best = familyBest.current ?? best;
  }

  // Stage 3: confirmation + context veto refine
  if (best) {
    const fam = families.find((f) => f.family === best!.family)!;
    const arch =
      ARCHITECTURES.find((a) => a.id === best!.policy.architecture) ??
      ARCHITECTURES[1]!;
    const buyScores = fam.scoreRows.map((r) =>
      ensembleBuyScore(arch.id, r.scores.byHorizon)
    );
    const sellScores = fam.scoreRows.map((r) =>
      ensembleSellScore(arch.id, r.scores.byHorizon)
    );
    const rows = fam.scoreRows.map((r, i) => ({
      ...r,
      scores: {
        ...r.scores,
        buyScore: buyScores[i]!,
        sellScore: sellScores[i]!
      }
    }));
    const familyBest: { current: Cand | null } = { current: best };
    for (const consecutiveEvals of [1, 2, 3]) {
      for (const opposeVetoScore of [
        best.policy.opposeVetoScore,
        best.policy.opposeVetoScore * 0.5,
        best.policy.opposeVetoScore * 1.5
      ]) {
        consider(fam.family, rows, {
          ...best.policy,
          consecutiveEvals,
          opposeVetoScore
        }, familyBest);
      }
    }
    best = familyBest.current ?? best;
  }

  // Stage 4: exit / maxHold / stop
  if (best) {
    const fam = families.find((f) => f.family === best!.family)!;
    const arch =
      ARCHITECTURES.find((a) => a.id === best!.policy.architecture) ??
      ARCHITECTURES[1]!;
    const buyScores = fam.scoreRows.map((r) =>
      ensembleBuyScore(arch.id, r.scores.byHorizon)
    );
    const sellScores = fam.scoreRows.map((r) =>
      ensembleSellScore(arch.id, r.scores.byHorizon)
    );
    const rows = fam.scoreRows.map((r, i) => ({
      ...r,
      scores: {
        ...r.scores,
        buyScore: buyScores[i]!,
        sellScore: sellScores[i]!
      }
    }));
    const familyBest: { current: Cand | null } = { current: best };
    for (const maxHoldSec of [5, 10, 15, 20, 30, 45, 60]) {
      for (const protectiveStop of stopCandidates.slice(0, 4)) {
        consider(fam.family, rows, {
          ...best.policy,
          maxHoldSec,
          protectiveStop
        }, familyBest);
      }
    }
    best = familyBest.current ?? best;
  }
  log("optimizer_done", {
    bestFamily: best?.family ?? null,
    trades: best?.eligibility.stats.tradeCount ?? 0,
    expectancy: best?.eligibility.stats.expectancy ?? 0
  });

  if (!best) {
    const result: V11PipelineResult = {
      ...baseResult,
      v1Diagnostics,
      modelComparison,
      selectedFamily: null,
      selectedPolicy: null,
      frozenConfig: null,
      frozenConfigSha256: null,
      validation: null,
      holdout: null,
      postHoldoutAudit: null,
      qualificationStatus: "NO_PREDICTIVE_EDGE",
      featureDropped: droppedKeys
    };
    if (args.persist && args.dataDir) {
      mkdirSync(args.dataDir, { recursive: true });
      writeFileSync(
        join(args.dataDir, "phase2b2-v11-report.json"),
        JSON.stringify(result, null, 2)
      );
    }
    return result;
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
  let holdRows: V11ScoreRow[];
  if (best.family === "independent_binary") {
    holdRows = buildBinaryScores(split.holdout, holdX);
  } else if (best.family === "direct_edge_ridge") {
    holdRows = buildEdgeScores(split.holdout, holdX, ridgeBundles);
  } else if (best.family === "stump_boost_edge") {
    holdRows = buildEdgeScores(split.holdout, holdX, stumpBundles);
  } else {
    holdRows = buildMultiScores(split.holdout);
  }
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
    let rows2: V11ScoreRow[];
    if (best.family === "independent_binary") {
      rows2 = buildBinaryScores(lab2.rows, X2);
    } else if (best.family === "direct_edge_ridge") {
      rows2 = buildEdgeScores(lab2.rows, X2, ridgeBundles);
    } else if (best.family === "stump_boost_edge") {
      rows2 = buildEdgeScores(lab2.rows, X2, stumpBundles);
    } else {
      rows2 = buildMultiScores(lab2.rows);
    }
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
