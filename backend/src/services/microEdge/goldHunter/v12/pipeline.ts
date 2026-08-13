/**
 * GOLD_HUNTER V1.2 walk-forward research pipeline.
 * Freeze before clean holdout. Known stress periods are post-hoc only.
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { RawTick } from "../asOfDataset";
import type { GhBarCtx } from "../features";
import { computePolicyBacktest } from "../metrics";
import { ndjsonGzToRows } from "../compactStorage";
import { activityBand, computeActivityMetrics } from "../v11/activityMetrics";
import type { AdaptivePercentile, AdaptiveRankWindowSec } from "./adaptiveRank";
import {
  buildV12ResearchRows,
  horizonNetCompact,
  type V12ResearchRow
} from "./datasetRows";
import { deriveTrailParamsFromTrain, type V12ExitConfig } from "./exits";
import { buildFrozenV12 } from "./frozenConfig";
import {
  edgeOverSpread,
  predictBinarySides,
  predictEdge,
  predictTwoStage,
  trainDirectEdgeHorizon,
  trainIndependentBinaryHorizon,
  trainShallowBoostHorizon,
  trainTwoStageHorizon,
  type HorizonBinaryBundle,
  type HorizonEdgeBundle,
  type TwoStageBundle
} from "./models";
import {
  V12_ARCHITECTURES,
  type V12HorizonScores,
  type V12PolicyConfig
} from "./policy";
import { runV12ShadowReplay, type V12ScoreRow } from "./shadowReplay";
import { scoreStability, summarizeFoldTrades, type FoldResult } from "./stability";
import { buildWalkForwardFolds } from "./walkForward";
import {
  GOLD_HUNTER_V11_NEGATIVE_FROZEN_SHA,
  GOLD_HUNTER_V12_STRATEGY_VERSION,
  V12_KNOWN_STRESS_PERIODS,
  type V12ExitArchitecture,
  type V12ModelFamily,
  type V12QualificationStatus
} from "./versions";

type FittedModels = {
  family: V12ModelFamily;
  primary: HorizonBinaryBundle | HorizonEdgeBundle | TwoStageBundle;
  context: HorizonBinaryBundle | HorizonEdgeBundle | TwoStageBundle;
};

function log(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event: `gh_v12_${event}`, ...payload }));
}

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function datasetHash(rows: V12ResearchRow[]): string {
  return createHash("sha256")
    .update(
      `${rows[0]?.timestampMs ?? 0}:${rows[rows.length - 1]?.timestampMs ?? 0}:${rows.length}`
    )
    .digest("hex")
    .slice(0, 16);
}

function horizonNet(
  row: V12ResearchRow,
  h: number
): { long: number; short: number } {
  return horizonNetCompact(row, h);
}

function pickHorizon(sec: number): 5 | 15 | 30 | 60 {
  if (sec <= 5) return 5;
  if (sec <= 15) return 15;
  if (sec <= 30) return 30;
  return 60;
}

function strideRows<T>(rows: T[], stride: number): T[] {
  if (stride <= 1) return rows;
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += stride) out.push(rows[i]!);
  return out;
}

function trainFamily(
  family: V12ModelFamily,
  primaryH: number,
  contextH: number,
  train: V12ResearchRow[],
  stride: number
): FittedModels | null {
  const tr = strideRows(train, stride);
  if (tr.length < 400) return null;
  const X = tr.map((r) => Array.from(r.x));
  const pH = pickHorizon(primaryH);
  const cH = pickHorizon(contextH);
  const pNets = tr.map((r) => horizonNet(r, pH));
  const cNets = tr.map((r) => horizonNet(r, cH));

  if (family === "independent_binary") {
    const buyYp = pNets.map((n) => (n.long > 0 ? 1 : 0));
    const sellYp = pNets.map((n) => (n.short > 0 ? 1 : 0));
    const buyYc = cNets.map((n) => (n.long > 0 ? 1 : 0));
    const sellYc = cNets.map((n) => (n.short > 0 ? 1 : 0));
    // Use train as val calib proxy (fold-internal); avoid leakage from fold val.
    const primary = trainIndependentBinaryHorizon({
      horizonSec: pH,
      trainX: X,
      trainBuyY: buyYp,
      trainSellY: sellYp,
      valX: X.slice(0, Math.min(5000, X.length)),
      valNetLong: pNets.slice(0, Math.min(5000, X.length)).map((n) => n.long),
      valNetShort: pNets.slice(0, Math.min(5000, X.length)).map((n) => n.short)
    });
    const context = trainIndependentBinaryHorizon({
      horizonSec: cH,
      trainX: X,
      trainBuyY: buyYc,
      trainSellY: sellYc,
      valX: X.slice(0, Math.min(5000, X.length)),
      valNetLong: cNets.slice(0, Math.min(5000, X.length)).map((n) => n.long),
      valNetShort: cNets.slice(0, Math.min(5000, X.length)).map((n) => n.short)
    });
    return { family, primary, context };
  }

  if (family === "two_stage_opportunity") {
    const thr = 0.08;
    return {
      family,
      primary: trainTwoStageHorizon({
        horizonSec: pH,
        trainX: X,
        trainNetLong: pNets.map((n) => n.long),
        trainNetShort: pNets.map((n) => n.short),
        opportunityThr: thr
      }),
      context: trainTwoStageHorizon({
        horizonSec: cH,
        trainX: X,
        trainNetLong: cNets.map((n) => n.long),
        trainNetShort: cNets.map((n) => n.short),
        opportunityThr: thr
      })
    };
  }

  if (family === "shallow_boost_edge") {
    return {
      family,
      primary: trainShallowBoostHorizon({
        horizonSec: pH,
        trainX: X,
        trainNetLong: pNets.map((n) => n.long),
        trainNetShort: pNets.map((n) => n.short)
      }),
      context: trainShallowBoostHorizon({
        horizonSec: cH,
        trainX: X,
        trainNetLong: cNets.map((n) => n.long),
        trainNetShort: cNets.map((n) => n.short)
      })
    };
  }

  const kind = family === "stump_boost_edge" ? "stump_boost" : "ridge";
  return {
    family,
    primary: trainDirectEdgeHorizon({
      horizonSec: pH,
      trainX: X,
      trainNetLong: pNets.map((n) => n.long),
      trainNetShort: pNets.map((n) => n.short),
      kind
    }),
    context: trainDirectEdgeHorizon({
      horizonSec: cH,
      trainX: X,
      trainNetLong: cNets.map((n) => n.long),
      trainNetShort: cNets.map((n) => n.short),
      kind
    })
  };
}

function rowX(row: V12ResearchRow): number[] {
  return Array.from(row.x);
}

function scoreRow(models: FittedModels, row: V12ResearchRow): V12HorizonScores {
  const x = rowX(row);
  if (models.family === "independent_binary") {
    const p = predictBinarySides(models.primary as HorizonBinaryBundle, x);
    const c = predictBinarySides(models.context as HorizonBinaryBundle, x);
    return {
      buyPrimary: p.pBuy,
      sellPrimary: p.pSell,
      buyContext: c.pBuy,
      sellContext: c.pSell,
      pOpportunity: Math.max(p.pBuy, p.pSell),
      expectedAbsEdge: Math.max(
        Math.abs(p.calibratedBuyNet),
        Math.abs(p.calibratedSellNet)
      )
    };
  }
  if (models.family === "two_stage_opportunity") {
    const p = predictTwoStage(models.primary as TwoStageBundle, x);
    const c = predictTwoStage(models.context as TwoStageBundle, x);
    return {
      buyPrimary: p.buy,
      sellPrimary: p.sell,
      buyContext: c.buy,
      sellContext: c.sell,
      pOpportunity: p.pOpportunity,
      expectedAbsEdge: p.pOpportunity * Math.max(p.buy, p.sell)
    };
  }
  const p = predictEdge(models.primary as HorizonEdgeBundle, x);
  const c = predictEdge(models.context as HorizonEdgeBundle, x);
  return {
    buyPrimary: edgeOverSpread(p.expectedNetLong, row.spread),
    sellPrimary: edgeOverSpread(p.expectedNetShort, row.spread),
    buyContext: edgeOverSpread(c.expectedNetLong, row.spread),
    sellContext: edgeOverSpread(c.expectedNetShort, row.spread),
    pOpportunity: Math.max(
      edgeOverSpread(p.expectedNetLong, row.spread),
      edgeOverSpread(p.expectedNetShort, row.spread)
    ),
    expectedAbsEdge: Math.max(
      Math.abs(p.expectedNetLong),
      Math.abs(p.expectedNetShort)
    )
  };
}

function toScoreRows(
  models: FittedModels,
  rows: V12ResearchRow[]
): V12ScoreRow[] {
  return rows.map((r) => ({
    timestampMs: r.timestampMs,
    bid: r.bid,
    ask: r.ask,
    spread: r.spread,
    regime: r.regime,
    scores: scoreRow(models, r),
    dataOk: r.dataOk,
    velocity: r.velocity,
    spreadOverMedian: r.spreadOverMedian
  }));
}

function defaultExit(
  arch: V12ExitArchitecture,
  maxHoldSec: number,
  trail: ReturnType<typeof deriveTrailParamsFromTrain>,
  coldFloor: number
): V12ExitConfig {
  return {
    architecture: arch,
    maxHoldSec,
    protectiveStop: 0.6,
    trailActivateMfe: trail.trailActivateMfe,
    trailDistance: trail.trailDistance,
    profitLockFraction: trail.profitLockFraction,
    edgeFadeFloor: coldFloor * 0.35,
    edgeFlipMin: Math.max(0.45, coldFloor * 0.5),
    rapidInvalidationSec: 3,
    friction: 0.06
  };
}

export type V12PipelineResult = {
  researchRunId: string;
  strategyVersion: typeof GOLD_HUNTER_V12_STRATEGY_VERSION;
  preservedV11FrozenSha: typeof GOLD_HUNTER_V11_NEGATIVE_FROZEN_SHA;
  dataFromUtc: string;
  dataToUtc: string;
  bidTicks: number;
  askTicks: number;
  gridStats: ReturnType<typeof buildV12ResearchRows>["gridStats"];
  datasetHash: string;
  gitSha: string;
  foldCount: number;
  foldResults: FoldResult[];
  stability: ReturnType<typeof scoreStability>;
  selectedFamily: V12ModelFamily | null;
  selectedPolicy: V12PolicyConfig | null;
  frozenConfig: ReturnType<typeof buildFrozenV12>["config"] | null;
  frozenConfigSha256: string | null;
  validationAggregate: ReturnType<typeof computePolicyBacktest> | null;
  validationActivity: ReturnType<typeof computeActivityMetrics> | null;
  holdout: (ReturnType<typeof computePolicyBacktest> & {
    tradesPerHour: number;
    activity: ReturnType<typeof computeActivityMetrics>;
    netExBest: number;
    netExBest3: number;
    maxLosingStreak: number;
  }) | null;
  knownStressReplay: Array<{
    id: string;
    label: string;
    trades: number;
    netPnl: number;
    expectancy: number;
    profitFactor: number;
    tradesPerHour: number;
  }>;
  qualificationStatus: V12QualificationStatus;
  brokerOrders: 0;
  evaluationBrokerRequests: 0;
  mutationSurface: "NONE";
  featureDropped: string[];
  liveShadowPrep: {
    readyForReview: boolean;
    note: string;
  };
};

export async function runGoldHunterV12Pipeline(args: {
  ticks: RawTick[];
  m1Bars: GhBarCtx[];
  m5Bars: GhBarCtx[];
  m15Bars: GhBarCtx[];
  dataFromMs: number;
  dataToMs: number;
  persist?: boolean;
  dataDir?: string;
  trainStride?: number;
  /** Optional known-stress tick bundles loaded after freeze only. */
  stressBundles?: Array<{
    id: string;
    ticks: RawTick[];
    m1: GhBarCtx[];
    m5: GhBarCtx[];
    m15: GhBarCtx[];
    fromMs: number;
    toMs: number;
  }>;
}): Promise<V12PipelineResult> {
  const stride = args.trainStride ?? Number(process.env.GOLD_HUNTER_V12_TRAIN_STRIDE ?? 8);
  const sampleStride = Number(process.env.GOLD_HUNTER_V12_SAMPLE_STRIDE ?? 3);
  log("asof_start", {
    ticks: args.ticks.length,
    gitSha: gitSha(),
    sampleStride,
    trainStride: stride
  });
  const built = buildV12ResearchRows({
    ticks: args.ticks,
    m1Bars: args.m1Bars,
    m5Bars: args.m5Bars,
    m15Bars: args.m15Bars,
    fromMs: args.dataFromMs,
    toMs: args.dataToMs,
    sampleStride
  });
  // Drop raw ticks ASAP — research rows are self-contained.
  args.ticks.length = 0;
  log("asof_done", {
    rows: built.rows.length,
    coveragePct: built.gridStats.coveragePct,
    dropped: built.droppedKeys.length
  });

  const dHash = datasetHash(built.rows);
  const researchRunId = `GH_REAL_V12_${dHash}`;
  const plan = buildWalkForwardFolds(built.rows, {
    trainDayMs: 14 * 86_400_000,
    valDayMs: 4 * 86_400_000,
    stepDayMs: 4 * 86_400_000,
    holdoutFrac: 0.18,
    purgeMs: 60_000,
    minFolds: 5
  });
  log("walk_forward_plan", {
    folds: plan.folds.length,
    holdoutRows: plan.holdout.length,
    purged: plan.purgedCount
  });

  // Compact representative search (fits 56d walk-forward runtime/memory).
  const families: V12ModelFamily[] = [
    "independent_binary",
    "two_stage_opportunity",
    "direct_edge_ridge",
    "shallow_boost_edge"
  ];
  const rankWindows: AdaptiveRankWindowSec[] = [900, 1800];
  const percentiles: AdaptivePercentile[] = [0.9, 0.95];
  const exitArchs: V12ExitArchitecture[] = [
    "FIXED_MAX_HOLD",
    "HYBRID_TRAIL_FADE"
  ];
  const maxHolds = [30, 60];

  type Cand = {
    family: V12ModelFamily;
    policy: V12PolicyConfig;
    folds: FoldResult[];
    stability: ReturnType<typeof scoreStability>;
  };
  const candidates: Cand[] = [];

  const archs = V12_ARCHITECTURES.filter((a) => a.id === "E_5_15");

  for (const family of families) {
    for (const arch of archs) {
      for (const rw of rankWindows) {
        for (const pct of percentiles) {
          for (const ex of exitArchs) {
            for (const mh of maxHolds) {
              // Prefer hybrid exits for nonlinear; skip some low-priority cells.
              if (family === "direct_edge_ridge" && (pct === 0.9 || mh === 30)) {
                continue;
              }
              if (family === "shallow_boost_edge" && ex === "FIXED_MAX_HOLD") {
                continue;
              }
              if (family === "independent_binary" && rw === 1800 && pct === 0.9) {
                continue;
              }
              const foldResults: FoldResult[] = [];
              let coldFloor = family === "independent_binary" || family === "two_stage_opportunity" ? 0.55 : 0.15;

              for (const fold of plan.folds) {
                const models = trainFamily(
                  family,
                  arch.primaryHorizonSec,
                  arch.contextHorizonSec,
                  fold.train,
                  stride
                );
                if (!models) continue;

                // Derive trail from a quick fixed-hold probe on train subsample
                const probePolicyExit = defaultExit(
                  "FIXED_MAX_HOLD",
                  30,
                  { trailActivateMfe: 0.2, trailDistance: 0.1, profitLockFraction: 0.4 },
                  coldFloor
                );
                const probePol: V12PolicyConfig = {
                  family,
                  architecture: arch.id,
                  primaryHorizonSec: arch.primaryHorizonSec,
                  contextHorizonSec: arch.contextHorizonSec,
                  rankWindowSec: rw,
                  rankPercentile: pct,
                  buyColdFloor: coldFloor,
                  sellColdFloor: coldFloor,
                  maxSpread: 0.35,
                  consecutiveEvals: 1,
                  minOpportunity: 0.55,
                  opposeVeto: 1.02,
                  allowedRegimes: null,
                  exit: probePolicyExit
                };
                const trainProbe = runV12ShadowReplay(
                  toScoreRows(models, strideRows(fold.train, Math.max(stride, 8))),
                  probePol
                );
                const trail = deriveTrailParamsFromTrain(
                  trainProbe.map((t) => t.mfe)
                );
                const policy: V12PolicyConfig = {
                  ...probePol,
                  exit: defaultExit(ex, mh, trail, coldFloor)
                };
                const valTrades = runV12ShadowReplay(
                  toScoreRows(models, fold.validation),
                  policy
                );
                foldResults.push(
                  summarizeFoldTrades(
                    fold.foldIndex,
                    valTrades,
                    fold.validationRange.fromMs,
                    fold.validationRange.toMs
                  )
                );
              }

              if (!foldResults.length) continue;
              const stability = scoreStability(foldResults);
              const policy: V12PolicyConfig = {
                family,
                architecture: arch.id,
                primaryHorizonSec: arch.primaryHorizonSec,
                contextHorizonSec: arch.contextHorizonSec,
                rankWindowSec: rw,
                rankPercentile: pct,
                buyColdFloor: coldFloor,
                sellColdFloor: coldFloor,
                maxSpread: 0.35,
                consecutiveEvals: 1,
                minOpportunity: 0.55,
                opposeVeto: 1.02,
                allowedRegimes: null,
                exit: defaultExit(
                  ex,
                  mh,
                  {
                    trailActivateMfe: 0.2,
                    trailDistance: 0.1,
                    profitLockFraction: 0.4
                  },
                  coldFloor
                )
              };
              candidates.push({ family, policy, folds: foldResults, stability });
            }
          }
        }
      }
    }
    log("family_search_done", {
      family,
      candidates: candidates.filter((c) => c.family === family).length
    });
  }

  candidates.sort((a, b) => b.stability.score - a.stability.score);
  const eligible = candidates.filter((c) => c.stability.eligible);
  const best = eligible[0] ?? null;
  log("selection", {
    totalCandidates: candidates.length,
    eligible: eligible.length,
    bestFamily: best?.family ?? null,
    bestScore: best?.stability.score ?? null,
    bestRejectTop: candidates[0]?.stability.rejectReason ?? null
  });

  const baseResult: V12PipelineResult = {
    researchRunId,
    strategyVersion: GOLD_HUNTER_V12_STRATEGY_VERSION,
    preservedV11FrozenSha: GOLD_HUNTER_V11_NEGATIVE_FROZEN_SHA,
    dataFromUtc: new Date(args.dataFromMs).toISOString(),
    dataToUtc: new Date(args.dataToMs).toISOString(),
    bidTicks: args.ticks.filter((t) => t.side === "BID").length,
    askTicks: args.ticks.filter((t) => t.side === "ASK").length,
    gridStats: built.gridStats,
    datasetHash: dHash,
    gitSha: gitSha(),
    foldCount: plan.folds.length,
    foldResults: best?.folds ?? [],
    stability: best?.stability ?? scoreStability([]),
    selectedFamily: best?.family ?? null,
    selectedPolicy: best?.policy ?? null,
    frozenConfig: null,
    frozenConfigSha256: null,
    validationAggregate: null,
    validationActivity: null,
    holdout: null,
    knownStressReplay: [],
    qualificationStatus: "NO_ROBUST_FAST_EDGE",
    brokerOrders: 0,
    evaluationBrokerRequests: 0,
    mutationSurface: "NONE",
    featureDropped: built.droppedKeys,
    liveShadowPrep: {
      readyForReview: false,
      note: "Historical research incomplete or negative — no live-shadow deploy"
    }
  };

  if (!best) {
    if (args.persist && args.dataDir) {
      mkdirSync(args.dataDir, { recursive: true });
      writeFileSync(
        join(args.dataDir, "phase2b3-v12-report.json"),
        JSON.stringify(baseResult, null, 2)
      );
    }
    return baseResult;
  }

  // Refit on all research rows (pre-holdout), freeze, then holdout once.
  const researchRows = built.rows.filter(
    (r) =>
      !plan.holdout.length ||
      r.timestampMs < (plan.holdout[0]?.timestampMs ?? Infinity)
  );
  const finalModels = trainFamily(
    best.family,
    best.policy.primaryHorizonSec,
    best.policy.contextHorizonSec,
    researchRows,
    stride
  );
  if (!finalModels) {
    return { ...baseResult, qualificationStatus: "BLOCKED" };
  }

  // Refresh trail params from research probe
  const probeTrades = runV12ShadowReplay(
    toScoreRows(finalModels, strideRows(researchRows, Math.max(stride, 8))),
    {
      ...best.policy,
      exit: defaultExit(
        "FIXED_MAX_HOLD",
        30,
        { trailActivateMfe: 0.2, trailDistance: 0.1, profitLockFraction: 0.4 },
        best.policy.buyColdFloor
      )
    }
  );
  const trail = deriveTrailParamsFromTrain(probeTrades.map((t) => t.mfe));
  const frozenPolicy: V12PolicyConfig = {
    ...best.policy,
    exit: defaultExit(
      best.policy.exit.architecture,
      best.policy.exit.maxHoldSec,
      trail,
      best.policy.buyColdFloor
    )
  };

  const holdoutRangeUtc = {
    from: plan.holdoutRange
      ? new Date(plan.holdoutRange.fromMs).toISOString()
      : "",
    to: plan.holdoutRange ? new Date(plan.holdoutRange.toMs).toISOString() : ""
  };

  const { config: frozenConfig, sha256: frozenConfigSha256 } = buildFrozenV12({
    researchRunId,
    modelFamily: best.family,
    datasetHash: dHash,
    policy: frozenPolicy,
    keptFeatureIndices: built.keptIndices,
    walkForwardFolds: plan.folds.length,
    holdoutRangeUtc
  });
  log("freeze", { sha256: frozenConfigSha256, family: best.family });

  if (args.persist && args.dataDir) {
    mkdirSync(args.dataDir, { recursive: true });
    writeFileSync(
      join(args.dataDir, "frozen-v12-config.json"),
      JSON.stringify({ config: frozenConfig, sha256: frozenConfigSha256 }, null, 2)
    );
  }

  // Aggregate validation = concat fold vals with frozen policy refit-per-fold already in best.folds
  const valAgg = {
    tradeCount: best.stability.aggregateTrades,
    netPnl: best.stability.aggregateNet,
    expectancy: best.stability.aggregateExpectancy,
    profitFactor: best.stability.aggregatePf,
    maxDrawdown: best.stability.aggregateDd,
    tradesPerHour: best.stability.tradesPerHour
  };

  // Clean holdout — once
  log("holdout_start", { rows: plan.holdout.length });
  const holdTrades = runV12ShadowReplay(
    toScoreRows(finalModels, plan.holdout),
    frozenPolicy
  );
  const holdBt = computePolicyBacktest(holdTrades);
  const holdAct = computeActivityMetrics({
    trades: holdTrades,
    windowFromMs: plan.holdoutRange?.fromMs ?? args.dataFromMs,
    windowToMs: plan.holdoutRange?.toMs ?? args.dataToMs
  });
  const nets = holdTrades.map((t) => t.netMove).sort((a, b) => b - a);
  let streak = 0;
  let maxLosingStreak = 0;
  for (const t of holdTrades) {
    if (t.netMove < 0) {
      streak += 1;
      maxLosingStreak = Math.max(maxLosingStreak, streak);
    } else streak = 0;
  }
  log("holdout_done", {
    trades: holdBt.tradeCount,
    net: holdBt.netPnl,
    exp: holdBt.expectancy,
    pf: holdBt.profitFactor
  });

  // Known stress replay — AFTER freeze, no retune
  const knownStressReplay: V12PipelineResult["knownStressReplay"] = [];
  for (const bundle of args.stressBundles ?? []) {
    try {
      const stressBuilt = buildV12ResearchRows({
        ticks: bundle.ticks,
        m1Bars: bundle.m1,
        m5Bars: bundle.m5,
        m15Bars: bundle.m15,
        fromMs: bundle.fromMs,
        toMs: bundle.toMs,
        keptIndices: built.keptIndices,
        sampleStride: Math.max(sampleStride, 4)
      });
      bundle.ticks.length = 0;
      const trades = runV12ShadowReplay(
        toScoreRows(finalModels, stressBuilt.rows),
        frozenPolicy
      );
      const bt = computePolicyBacktest(trades);
      const hours = Math.max(1e-9, (bundle.toMs - bundle.fromMs) / 3_600_000);
      knownStressReplay.push({
        id: bundle.id,
        label: "KNOWN_STRESS_REPLAY",
        trades: bt.tradeCount,
        netPnl: bt.netPnl,
        expectancy: bt.expectancy,
        profitFactor: bt.profitFactor,
        tradesPerHour: bt.tradeCount / hours
      });
      log("stress_replay", { id: bundle.id, net: bt.netPnl, trades: bt.tradeCount });
    } catch (e) {
      log("stress_replay_skipped", {
        id: bundle.id,
        message: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)
      });
    }
  }
  void V12_KNOWN_STRESS_PERIODS;

  let qualificationStatus: V12QualificationStatus;
  if (holdBt.tradeCount < 8) qualificationStatus = "INSUFFICIENT_EDGE";
  else if (
    holdBt.netPnl > 0 &&
    holdBt.expectancy > 0 &&
    holdBt.profitFactor > 1 &&
    best.stability.eligible &&
    best.stability.medianExpectancy > 0
  ) {
    qualificationStatus = "POSITIVE";
  } else if (holdBt.netPnl <= 0 || holdBt.expectancy <= 0) {
    qualificationStatus =
      best.stability.eligible ? "MIXED" : "NEGATIVE";
  } else {
    qualificationStatus = "MIXED";
  }
  if (!best.stability.eligible && holdBt.expectancy <= 0) {
    qualificationStatus = "NO_ROBUST_FAST_EDGE";
  }

  const result: V12PipelineResult = {
    ...baseResult,
    foldResults: best.folds,
    stability: best.stability,
    selectedFamily: best.family,
    selectedPolicy: frozenPolicy,
    frozenConfig,
    frozenConfigSha256,
    validationAggregate: {
      tradeCount: valAgg.tradeCount,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: 0,
      grossPnl: 0,
      friction: 0,
      netPnl: valAgg.netPnl,
      profitFactor: valAgg.profitFactor,
      expectancy: valAgg.expectancy,
      maxDrawdown: valAgg.maxDrawdown,
      averageDuration: 0,
      buyPnl: 0,
      sellPnl: 0,
      sessionPnl: {},
      regimePnl: {}
    },
    validationActivity: computeActivityMetrics({
      trades: [],
      windowFromMs: args.dataFromMs,
      windowToMs: args.dataToMs,
      opportunityCount: undefined
    }),
    holdout: {
      ...holdBt,
      tradesPerHour: holdAct.overallTradesPerHour,
      activity: holdAct,
      netExBest: holdBt.netPnl - (nets[0] ?? 0),
      netExBest3: holdBt.netPnl - nets.slice(0, 3).reduce((a, b) => a + b, 0),
      maxLosingStreak
    },
    knownStressReplay,
    qualificationStatus,
    liveShadowPrep: {
      readyForReview: qualificationStatus === "POSITIVE",
      note:
        qualificationStatus === "POSITIVE"
          ? "READY FOR LIVE-SHADOW DEPLOYMENT REVIEW ONLY — no Demo/Live orders"
          : "Not cleared for live-shadow review"
    }
  };

  result.validationActivity = {
    overallTradesPerHour: best.stability.tradesPerHour,
    overallTradesPerDay: best.stability.tradesPerHour * 24,
    activityBand: activityBand(best.stability.tradesPerHour),
    bySession: holdAct.bySession,
    opportunitiesPerHour: null,
    qualifiedEntriesPerHour: null
  };

  if (args.persist && args.dataDir) {
    writeFileSync(
      join(args.dataDir, "phase2b3-v12-report.json"),
      JSON.stringify(result, null, 2)
    );
  }
  log("research_done", {
    qualificationStatus: result.qualificationStatus,
    frozen: frozenConfigSha256,
    holdoutNet: holdBt.netPnl
  });
  return result;
}

/** Helper to load optional stress datasets from disk. */
export function loadStressBundleFromDir(
  id: string,
  dir: string,
  fromMs: number,
  toMs: number
): V12PipelineArgsStress | null {
  const ticksPath = join(dir, "ticks-bidask.ndjson.gz");
  if (!existsSync(ticksPath)) return null;
  return {
    id,
    ticks: ndjsonGzToRows<RawTick>(readFileSync(ticksPath)),
    m1: existsSync(join(dir, "bars-m1.ndjson.gz"))
      ? ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m1.ndjson.gz")))
      : [],
    m5: existsSync(join(dir, "bars-m5.ndjson.gz"))
      ? ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m5.ndjson.gz")))
      : [],
    m15: existsSync(join(dir, "bars-m15.ndjson.gz"))
      ? ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m15.ndjson.gz")))
      : [],
    fromMs,
    toMs
  };
}

type V12PipelineArgsStress = NonNullable<
  Parameters<typeof runGoldHunterV12Pipeline>[0]["stressBundles"]
>[number];
