/**
 * V1 probability compression diagnosis + opportunity economics.
 */
import type { GhHorizonSec } from "../config";
import { GH_HORIZONS_SEC } from "../config";
import type { GhLabel } from "../types";
import type { V11RankSignalClass } from "./versions";

export type DistStats = {
  min: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  n: number;
  mean: number;
};

function quantiles(xs: number[]): DistStats {
  const a = xs.filter(Number.isFinite).sort((u, v) => u - v);
  if (!a.length) {
    return {
      min: 0,
      p10: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
      n: 0,
      mean: 0
    };
  }
  const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]!;
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return {
    min: a[0]!,
    p10: q(0.1),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    p95: q(0.95),
    p99: q(0.99),
    max: a[a.length - 1]!,
    n: a.length,
    mean
  };
}

export type DecileEdgeRow = {
  decile: number;
  count: number;
  avgBuyNet: number;
  avgSellNet: number;
};

export type HorizonRankDiagnosis = {
  horizonSec: GhHorizonSec;
  pUp: DistStats;
  pDown: DistStats;
  pNoEdge: DistStats;
  classFrequency: Record<string, number>;
  buyDeciles: DecileEdgeRow[];
  sellDeciles: DecileEdgeRow[];
  topVsBottomBuyLift: number;
  topVsBottomSellLift: number;
  rankSignal: V11RankSignalClass;
  brierUp: number;
  logLoss: number;
};

function entropy(probs: number[]): number {
  let e = 0;
  for (const p of probs) {
    if (p > 0) e -= p * Math.log2(p);
  }
  return e;
}

function decilesByScore(
  scores: number[],
  buyNets: number[],
  sellNets: number[]
): DecileEdgeRow[] {
  const idx = scores.map((_, i) => i).sort((a, b) => scores[a]! - scores[b]!);
  const rows: DecileEdgeRow[] = [];
  for (let d = 0; d < 10; d++) {
    const lo = Math.floor((d / 10) * idx.length);
    const hi = Math.floor(((d + 1) / 10) * idx.length);
    const slice = idx.slice(lo, hi);
    const buy = slice.map((i) => buyNets[i]!);
    const sell = slice.map((i) => sellNets[i]!);
    rows.push({
      decile: d + 1,
      count: slice.length,
      avgBuyNet: buy.length ? buy.reduce((a, b) => a + b, 0) / buy.length : 0,
      avgSellNet: sell.length ? sell.reduce((a, b) => a + b, 0) / sell.length : 0
    });
  }
  return rows;
}

function classifyRank(deciles: DecileEdgeRow[], side: "buy" | "sell"): {
  lift: number;
  klass: V11RankSignalClass;
} {
  if (deciles.length < 10 || deciles.every((d) => d.count === 0)) {
    return { lift: 0, klass: "NO_SIGNAL" };
  }
  const bottom = (deciles[0]![side === "buy" ? "avgBuyNet" : "avgSellNet"] +
    deciles[1]![side === "buy" ? "avgBuyNet" : "avgSellNet"]) /
    2;
  const top = (deciles[8]![side === "buy" ? "avgBuyNet" : "avgSellNet"] +
    deciles[9]![side === "buy" ? "avgBuyNet" : "avgSellNet"]) /
    2;
  const lift = top - bottom;
  // Monotonic-ish: top half better than bottom half
  const bottomHalf =
    deciles.slice(0, 5).reduce((s, d) => s + d[side === "buy" ? "avgBuyNet" : "avgSellNet"], 0) /
    5;
  const topHalf =
    deciles.slice(5).reduce((s, d) => s + d[side === "buy" ? "avgBuyNet" : "avgSellNet"], 0) / 5;
  if (top > 0 && lift >= 0.05 && topHalf > bottomHalf + 0.02) {
    return { lift, klass: "USABLE_RANK_SIGNAL" };
  }
  if (lift >= 0.02 && topHalf > bottomHalf) {
    return { lift, klass: "WEAK_RANK_SIGNAL" };
  }
  return { lift, klass: "NO_SIGNAL" };
}

export function diagnoseHorizonScores(args: {
  horizonSec: GhHorizonSec;
  pUp: number[];
  pDown: number[];
  pNoEdge: number[];
  labels: GhLabel[];
}): HorizonRankDiagnosis {
  const classFrequency: Record<string, number> = {};
  const buyNets: number[] = [];
  const sellNets: number[] = [];
  let brier = 0;
  let logLoss = 0;
  let n = 0;
  for (let i = 0; i < args.labels.length; i++) {
    const lab = args.labels[i]!;
    classFrequency[lab.classLabel] = (classFrequency[lab.classLabel] ?? 0) + 1;
    if (lab.netLong == null || lab.netShort == null) continue;
    buyNets.push(lab.netLong);
    sellNets.push(lab.netShort);
    const yUp = lab.classLabel === "UP_TRADEABLE" ? 1 : 0;
    const p = Math.min(1 - 1e-9, Math.max(1e-9, args.pUp[i]!));
    brier += (p - yUp) ** 2;
    logLoss += -(yUp * Math.log(p) + (1 - yUp) * Math.log(1 - p));
    n += 1;
  }
  const buyDeciles = decilesByScore(args.pUp, buyNets.length ? buyNets : args.pUp.map(() => 0), sellNets.length ? sellNets : args.pDown.map(() => 0));
  // Align lengths: rebuild with aligned arrays
  const alignedUp: number[] = [];
  const alignedDown: number[] = [];
  const alignedBuy: number[] = [];
  const alignedSell: number[] = [];
  for (let i = 0; i < args.labels.length; i++) {
    const lab = args.labels[i]!;
    if (lab.netLong == null || lab.netShort == null) continue;
    alignedUp.push(args.pUp[i]!);
    alignedDown.push(args.pDown[i]!);
    alignedBuy.push(lab.netLong);
    alignedSell.push(lab.netShort);
  }
  const buyD = decilesByScore(alignedUp, alignedBuy, alignedSell);
  const sellD = decilesByScore(alignedDown, alignedBuy, alignedSell);
  const buyRank = classifyRank(buyD, "buy");
  const sellRank = classifyRank(sellD, "sell");
  const rankSignal: V11RankSignalClass =
    buyRank.klass === "USABLE_RANK_SIGNAL" ||
    sellRank.klass === "USABLE_RANK_SIGNAL"
      ? "USABLE_RANK_SIGNAL"
      : buyRank.klass === "WEAK_RANK_SIGNAL" ||
          sellRank.klass === "WEAK_RANK_SIGNAL"
        ? "WEAK_RANK_SIGNAL"
        : "NO_SIGNAL";

  void buyDeciles;
  void entropy;

  return {
    horizonSec: args.horizonSec,
    pUp: quantiles(args.pUp),
    pDown: quantiles(args.pDown),
    pNoEdge: quantiles(args.pNoEdge),
    classFrequency,
    buyDeciles: buyD,
    sellDeciles: sellD,
    topVsBottomBuyLift: buyRank.lift,
    topVsBottomSellLift: sellRank.lift,
    rankSignal,
    brierUp: n ? brier / n : 0,
    logLoss: n ? logLoss / n : 0
  };
}

export type OpportunityEconomics = {
  horizonSec: GhHorizonSec;
  absMove: DistStats;
  spread: DistStats;
  moveOverSpreadP50: number;
  pctNetLongPos: number;
  pctNetShortPos: number;
  pctBestSidePos: number;
  pctBestSideGt005: number;
  pctBestSideGt010: number;
  pctBestSideGt020: number;
  pctBestSideGt050: number;
  n: number;
};

export function opportunityEconomics(
  quotes: Array<{ bid: number; ask: number; timestampMs: number }>,
  labels: GhLabel[],
  horizonSec: GhHorizonSec
): OpportunityEconomics {
  const moves: number[] = [];
  const spreads: number[] = [];
  let netLongPos = 0;
  let netShortPos = 0;
  let bestPos = 0;
  let gt005 = 0;
  let gt010 = 0;
  let gt020 = 0;
  let gt050 = 0;
  let n = 0;
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i]!;
    const q = quotes[i];
    if (!q || lab.netLong == null || lab.netShort == null || lab.midMove == null)
      continue;
    n += 1;
    moves.push(Math.abs(lab.midMove));
    spreads.push(q.ask - q.bid);
    if (lab.netLong > 0) netLongPos += 1;
    if (lab.netShort > 0) netShortPos += 1;
    const best = Math.max(lab.netLong, lab.netShort);
    if (best > 0) bestPos += 1;
    if (best > 0.05) gt005 += 1;
    if (best > 0.1) gt010 += 1;
    if (best > 0.2) gt020 += 1;
    if (best > 0.5) gt050 += 1;
  }
  const absMove = quantiles(moves);
  const spread = quantiles(spreads);
  return {
    horizonSec,
    absMove,
    spread,
    moveOverSpreadP50: absMove.p50 / Math.max(spread.p50, 1e-9),
    pctNetLongPos: n ? netLongPos / n : 0,
    pctNetShortPos: n ? netShortPos / n : 0,
    pctBestSidePos: n ? bestPos / n : 0,
    pctBestSideGt005: n ? gt005 / n : 0,
    pctBestSideGt010: n ? gt010 / n : 0,
    pctBestSideGt020: n ? gt020 / n : 0,
    pctBestSideGt050: n ? gt050 / n : 0,
    n
  };
}

export function allHorizonOpportunity(
  quotes: Array<{ bid: number; ask: number; timestampMs: number }>,
  labelRows: Array<Record<number, GhLabel>>
): Record<GhHorizonSec, OpportunityEconomics> {
  const out = {} as Record<GhHorizonSec, OpportunityEconomics>;
  for (const h of GH_HORIZONS_SEC) {
    out[h] = opportunityEconomics(
      quotes,
      labelRows.map((r) => r[h]!),
      h
    );
  }
  return out;
}
