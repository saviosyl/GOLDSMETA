/**
 * Stability-first walk-forward candidate ranking.
 */
import type { GhShadowTrade } from "../types";
import { computePolicyBacktest } from "../metrics";

export type FoldResult = {
  foldIndex: number;
  tradeCount: number;
  tradesPerHour: number;
  netPnl: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  netExBest: number;
  netExBest3: number;
  winningDays: number;
  losingDays: number;
  bestTrade: number;
};

export type StabilityScore = {
  eligible: boolean;
  rejectReason: string | null;
  medianExpectancy: number;
  positiveFolds: number;
  foldCount: number;
  aggregateNet: number;
  aggregateExpectancy: number;
  aggregatePf: number;
  aggregateDd: number;
  aggregateTrades: number;
  tradesPerHour: number;
  score: number;
};

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function summarizeFoldTrades(
  foldIndex: number,
  trades: GhShadowTrade[],
  windowFromMs: number,
  windowToMs: number
): FoldResult {
  const bt = computePolicyBacktest(trades);
  const nets = trades.map((t) => t.netMove).sort((a, b) => b - a);
  const best = nets[0] ?? 0;
  const best3 = nets.slice(0, 3).reduce((a, b) => a + b, 0);
  const netExBest = bt.netPnl - best;
  const netExBest3 = bt.netPnl - best3;
  const byDay = new Map<string, number>();
  for (const t of trades) {
    const k = dayKey(t.entryTimestampMs);
    byDay.set(k, (byDay.get(k) ?? 0) + t.netMove);
  }
  let winningDays = 0;
  let losingDays = 0;
  for (const v of byDay.values()) {
    if (v > 0) winningDays += 1;
    else if (v < 0) losingDays += 1;
  }
  const hours = Math.max(1e-9, (windowToMs - windowFromMs) / 3_600_000);
  return {
    foldIndex,
    tradeCount: bt.tradeCount,
    tradesPerHour: bt.tradeCount / hours,
    netPnl: bt.netPnl,
    expectancy: bt.expectancy,
    profitFactor: bt.profitFactor,
    maxDrawdown: bt.maxDrawdown,
    netExBest,
    netExBest3,
    winningDays,
    losingDays,
    bestTrade: best
  };
}

export function scoreStability(folds: FoldResult[]): StabilityScore {
  const n = folds.length;
  if (!n) {
    return {
      eligible: false,
      rejectReason: "NO_FOLDS",
      medianExpectancy: 0,
      positiveFolds: 0,
      foldCount: 0,
      aggregateNet: 0,
      aggregateExpectancy: 0,
      aggregatePf: 0,
      aggregateDd: 0,
      aggregateTrades: 0,
      tradesPerHour: 0,
      score: -1e9
    };
  }

  const exps = folds.map((f) => f.expectancy).sort((a, b) => a - b);
  const medianExpectancy = exps[Math.floor(exps.length / 2)]!;
  const positiveFolds = folds.filter((f) => f.expectancy > 0 && f.netPnl > 0).length;
  const aggregateNet = folds.reduce((s, f) => s + f.netPnl, 0);
  const aggregateTrades = folds.reduce((s, f) => s + f.tradeCount, 0);
  const aggregateExpectancy =
    aggregateTrades > 0
      ? folds.reduce((s, f) => s + f.expectancy * f.tradeCount, 0) /
        aggregateTrades
      : 0;
  const grossProfit = folds
    .filter((f) => f.netPnl > 0)
    .reduce((s, f) => s + f.netPnl, 0);
  const grossLoss = Math.abs(
    folds.filter((f) => f.netPnl < 0).reduce((s, f) => s + f.netPnl, 0)
  );
  const aggregatePf =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const aggregateDd = Math.max(...folds.map((f) => f.maxDrawdown));
  const tradesPerHour =
    folds.reduce((s, f) => s + f.tradesPerHour, 0) / n;

  const needPositive = Math.max(1, Math.ceil(n * 0.6));
  let rejectReason: string | null = null;

  if (aggregateTrades < 15) rejectReason = "TINY_TRADE_COUNT";
  else if (positiveFolds < needPositive) rejectReason = "INSUFFICIENT_POSITIVE_FOLDS";
  else if (!(medianExpectancy > 0)) rejectReason = "NON_POSITIVE_MEDIAN_EXPECTANCY";
  else if (!(aggregateExpectancy > 0)) rejectReason = "NON_POSITIVE_AGG_EXPECTANCY";
  else if (!(aggregatePf > 1)) rejectReason = "PF_LE_1";
  else if (!(aggregateNet > 0)) rejectReason = "NON_POSITIVE_AGG_NET";
  else if (folds.some((f) => f.netPnl < -Math.max(20, Math.abs(aggregateNet)))) {
    rejectReason = "CATASTROPHIC_FOLD";
  } else {
    // One-fold domination
    const maxFoldNet = Math.max(...folds.map((f) => f.netPnl));
    if (maxFoldNet > 0 && maxFoldNet / Math.max(aggregateNet, 1e-9) > 0.85) {
      rejectReason = "ONE_FOLD_DOMINATION";
    }
    const netEx3 = folds.reduce((s, f) => s + f.netExBest3, 0);
    if (netEx3 <= 0 && aggregateTrades >= 20) {
      rejectReason = "OUTLIER_TRADE_DOMINATION";
    }
  }

  // Prefer stable + active among eligibles
  const foldVar =
    exps.reduce((s, e) => s + (e - medianExpectancy) ** 2, 0) / n;
  const score =
    medianExpectancy * 10 +
    aggregateExpectancy * 5 +
    Math.min(aggregatePf, 3) +
    positiveFolds +
    Math.min(tradesPerHour, 20) * 0.05 -
    foldVar * 20 -
    aggregateDd * 0.02 -
    (rejectReason ? 1000 : 0);

  return {
    eligible: rejectReason == null,
    rejectReason,
    medianExpectancy,
    positiveFolds,
    foldCount: n,
    aggregateNet,
    aggregateExpectancy,
    aggregatePf,
    aggregateDd,
    aggregateTrades,
    tradesPerHour,
    score
  };
}
