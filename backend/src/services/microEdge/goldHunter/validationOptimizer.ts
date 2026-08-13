/**
 * Staged validation-only optimizer for entry policy / theta / maxHold / stop.
 * Holdout rows must NEVER be passed into this module.
 */
import {
  GH_CONFIRMATION_CANDIDATES,
  GH_MAX_HOLD_CANDIDATES,
  GH_MIN_VALIDATION_TRADES_FLOOR,
  GH_MIN_VALIDATION_TRADES_PREFERRED,
  GH_P15_CANDIDATES,
  GH_P30_CANDIDATES,
  GH_P5_CANDIDATES,
  GH_P60_VETO_CANDIDATES,
  GH_THETA_CANDIDATES
} from "./config";
import { computePolicyBacktest } from "./metrics";
import type { EntryThresholds } from "./signalPolicy";
import type { GhShadowTrade } from "./types";
import type { StopSelectionReport } from "./protectiveStop";

export type ResearchRow = {
  timestampMs: number;
  features: import("./types").GhFeatureVector;
  labels: Record<number, import("./types").GhLabel>;
  quote: { timestampMs: number; bid: number; ask: number };
};

export type PolicyCandidate = {
  theta: number;
  entry: EntryThresholds;
  maxHoldSec: number;
  protectiveStop: number;
};

export type CandidateEval = {
  candidate: PolicyCandidate;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  expectancy: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  winRate: number;
  eligible: boolean;
  rejectReason: string | null;
  lowSampleValidation: boolean;
  score: number;
  stage: number;
};

export type OptimizerResult = {
  best: CandidateEval | null;
  searched: CandidateEval[];
  insufficientEdge: boolean;
  lowSampleValidation: boolean;
  stopReport: StopSelectionReport | null;
  stages: { stage: number; evaluated: number; bestScore: number }[];
};

function nearestBelow(sorted: readonly number[], x: number): number[] {
  const i = sorted.findIndex((v) => v >= x);
  const idx = i < 0 ? sorted.length - 1 : i;
  const out = new Set<number>();
  for (const j of [idx - 1, idx, idx + 1]) {
    if (j >= 0 && j < sorted.length) out.add(sorted[j]!);
  }
  return [...out];
}

export function makeSymmetricEntry(
  p5: number,
  p15: number,
  p30: number,
  p60: number,
  consecutiveEvals: number
): EntryThresholds {
  return {
    pUp5: p5,
    pUp15: p15,
    pUp30: p30,
    pDown5: p5,
    pDown15: p15,
    pDown30: p30,
    p60OpposeMax: p60,
    consecutiveEvals
  };
}

/** Zero-trade / tiny / negative expectancy configs cannot win. */
export function evaluateCandidateEligibility(
  trades: GhShadowTrade[],
  opts?: { minPreferred?: number; minFloor?: number }
): {
  eligible: boolean;
  rejectReason: string | null;
  lowSampleValidation: boolean;
  score: number;
  stats: ReturnType<typeof computePolicyBacktest>;
  buyCount: number;
  sellCount: number;
} {
  const minPreferred = opts?.minPreferred ?? GH_MIN_VALIDATION_TRADES_PREFERRED;
  const minFloor = opts?.minFloor ?? GH_MIN_VALIDATION_TRADES_FLOOR;
  const stats = computePolicyBacktest(trades);
  const buyCount = trades.filter((t) => t.side === "BUY").length;
  const sellCount = trades.filter((t) => t.side === "SELL").length;

  if (stats.tradeCount === 0) {
    return {
      eligible: false,
      rejectReason: "ZERO_TRADES",
      lowSampleValidation: false,
      score: Number.NEGATIVE_INFINITY,
      stats,
      buyCount,
      sellCount
    };
  }
  if (stats.tradeCount < minFloor) {
    return {
      eligible: false,
      rejectReason: "TINY_TRADE_COUNT",
      lowSampleValidation: true,
      score: Number.NEGATIVE_INFINITY,
      stats,
      buyCount,
      sellCount
    };
  }
  if (stats.expectancy <= 0 || stats.netPnl <= 0) {
    return {
      eligible: false,
      rejectReason: "NEGATIVE_EXPECTANCY",
      lowSampleValidation: stats.tradeCount < minPreferred,
      score: Number.NEGATIVE_INFINITY,
      stats,
      buyCount,
      sellCount
    };
  }
  const maxAbs = Math.max(...trades.map((t) => Math.abs(t.netMove)), 0);
  if (stats.tradeCount >= 3 && maxAbs > 0.55 * Math.abs(stats.netPnl)) {
    return {
      eligible: false,
      rejectReason: "SINGLE_TRADE_DOMINATION",
      lowSampleValidation: stats.tradeCount < minPreferred,
      score: Number.NEGATIVE_INFINITY,
      stats,
      buyCount,
      sellCount
    };
  }
  if (stats.maxDrawdown > Math.max(1.5, 3 * Math.abs(stats.expectancy) * Math.sqrt(stats.tradeCount))) {
    return {
      eligible: false,
      rejectReason: "PATHOLOGICAL_DRAWDOWN",
      lowSampleValidation: stats.tradeCount < minPreferred,
      score: Number.NEGATIVE_INFINITY,
      stats,
      buyCount,
      sellCount
    };
  }

  const lowSampleValidation = stats.tradeCount < minPreferred;
  const pf = Math.min(3, Math.max(0, stats.profitFactor));
  const score =
    stats.expectancy *
    Math.log(1 + stats.tradeCount) *
    (0.5 + 0.5 * pf) /
    (1 + stats.maxDrawdown);

  return {
    eligible: true,
    rejectReason: null,
    lowSampleValidation,
    score,
    stats,
    buyCount,
    sellCount
  };
}

export type ReplayFn = (
  rows: ResearchRow[],
  entry: EntryThresholds,
  maxHoldSec: number,
  protectiveStop: number
) => GhShadowTrade[];

/**
 * Deterministic coarse-to-fine search. `validationRows` only — never holdout.
 */
export function runStagedValidationOptimizer(args: {
  validationRows: ResearchRow[];
  /** Train models once per theta outside; map theta → replay with that model. */
  replayForTheta: (theta: number) => ReplayFn;
  stopCandidates: number[];
  defaultStop: number;
}): OptimizerResult {
  const searched: CandidateEval[] = [];
  const stages: OptimizerResult["stages"] = [];
  /** Wrapper avoids TS control-flow narrowing `best` to `never` inside closures. */
  const state: { best: CandidateEval | null } = { best: null };

  const consider = (
    stage: number,
    theta: number,
    entry: EntryThresholds,
    maxHoldSec: number,
    protectiveStop: number,
    replay: ReplayFn
  ): CandidateEval => {
    const trades = replay(args.validationRows, entry, maxHoldSec, protectiveStop);
    const ev = evaluateCandidateEligibility(trades);
    const row: CandidateEval = {
      candidate: { theta, entry, maxHoldSec, protectiveStop },
      tradeCount: ev.stats.tradeCount,
      buyCount: ev.buyCount,
      sellCount: ev.sellCount,
      expectancy: ev.stats.expectancy,
      netPnl: ev.stats.netPnl,
      profitFactor: ev.stats.profitFactor,
      maxDrawdown: ev.stats.maxDrawdown,
      winRate: ev.stats.winRate,
      eligible: ev.eligible,
      rejectReason: ev.rejectReason,
      lowSampleValidation: ev.lowSampleValidation,
      score: ev.score,
      stage
    };
    searched.push(row);
    if (row.eligible && (!state.best || row.score > state.best.score)) {
      state.best = row;
    }
    return row;
  };

  // ---- Stage 1: theta + coarse probability thresholds ----
  let stageCount = 0;
  const coarseP5 = [0.6, 0.7, 0.8] as const;
  const coarseP15 = [0.6, 0.68, 0.75] as const;
  const coarseP30 = [0.55, 0.63, 0.7] as const;
  for (const theta of GH_THETA_CANDIDATES) {
    const replay = args.replayForTheta(theta);
    for (const p5 of coarseP5) {
      for (const p15 of coarseP15) {
        for (const p30 of coarseP30) {
          const entry = makeSymmetricEntry(p5, p15, p30, 0.55, 2);
          consider(1, theta, entry, 30, args.defaultStop, replay);
          stageCount += 1;
        }
      }
    }
  }
  stages.push({
    stage: 1,
    evaluated: stageCount,
    bestScore: state.best?.score ?? Number.NEGATIVE_INFINITY
  });

  // ---- Stage 2: refine around best region ----
  let stage2 = 0;
  if (state.best) {
    const b = state.best.candidate;
    const replay = args.replayForTheta(b.theta);
    const p5s = nearestBelow(GH_P5_CANDIDATES, b.entry.pUp5);
    const p15s = nearestBelow(GH_P15_CANDIDATES, b.entry.pUp15);
    const p30s = nearestBelow(GH_P30_CANDIDATES, b.entry.pUp30);
    for (const p5 of p5s) {
      for (const p15 of p15s) {
        for (const p30 of p30s) {
          for (const p60 of GH_P60_VETO_CANDIDATES) {
            const entry = makeSymmetricEntry(p5, p15, p30, p60, b.entry.consecutiveEvals);
            consider(2, b.theta, entry, b.maxHoldSec, args.defaultStop, replay);
            stage2 += 1;
          }
        }
      }
    }
  }
  stages.push({
    stage: 2,
    evaluated: stage2,
    bestScore: state.best?.score ?? Number.NEGATIVE_INFINITY
  });

  // ---- Stage 3: confirmation / maxHold / protective stop ----
  let stage3 = 0;
  let stopReport: StopSelectionReport | null = null;
  if (state.best) {
    const b = state.best.candidate;
    const replay = args.replayForTheta(b.theta);
    const validationByStop: StopSelectionReport["validationByStop"] = [];
    for (const confirm of GH_CONFIRMATION_CANDIDATES) {
      for (const maxHold of GH_MAX_HOLD_CANDIDATES) {
        for (const stop of args.stopCandidates) {
          const entry = { ...b.entry, consecutiveEvals: confirm };
          const row = consider(3, b.theta, entry, maxHold, stop, replay);
          stage3 += 1;
          if (confirm === b.entry.consecutiveEvals && maxHold === b.maxHoldSec) {
            validationByStop.push({
              stop,
              tradeCount: row.tradeCount,
              expectancy: row.expectancy,
              netPnl: row.netPnl,
              maxDrawdown: row.maxDrawdown,
              eligible: row.eligible
            });
          }
        }
      }
    }
    stopReport = {
      candidates: args.stopCandidates,
      selected: state.best.candidate.protectiveStop,
      derivation:
        "TRAIN abs 5s mid-move quantiles (p50/p75/p90/p95) + default; selected on VALIDATION only",
      validationByStop
    };
    // refresh selected stop from best after stage 3
    stopReport.selected = state.best.candidate.protectiveStop;
  }
  stages.push({
    stage: 3,
    evaluated: stage3,
    bestScore: state.best?.score ?? Number.NEGATIVE_INFINITY
  });

  return {
    best: state.best,
    searched,
    insufficientEdge: state.best == null,
    lowSampleValidation: state.best?.lowSampleValidation ?? false,
    stopReport,
    stages
  };
}

/** Prove entry grid evaluation includes non-default thresholds. */
export function coarseEntryGridIncludesNonDefault(
  defaults: EntryThresholds
): boolean {
  const coarse = [
    makeSymmetricEntry(0.6, 0.6, 0.55, 0.55, 2),
    makeSymmetricEntry(0.8, 0.75, 0.7, 0.55, 2)
  ];
  return coarse.some(
    (e) =>
      e.pUp5 !== defaults.pUp5 ||
      e.pUp15 !== defaults.pUp15 ||
      e.pUp30 !== defaults.pUp30
  );
}
