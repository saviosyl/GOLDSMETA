/**
 * Model metrics + policy backtest aggregates.
 */
import type { GhClass, GhHorizonMetrics, GhLabel, GhPolicyBacktest, GhShadowTrade } from "./types";
import type { ProbTriple } from "./model";
import type { GhHorizonSec } from "./config";

export function computeHorizonMetrics(args: {
  horizonSec: GhHorizonSec;
  labels: GhLabel[];
  preds: ProbTriple[];
}): GhHorizonMetrics {
  const n = Math.min(args.labels.length, args.preds.length);
  const balance: Record<string, number> = {
    UP_TRADEABLE: 0,
    DOWN_TRADEABLE: 0,
    NO_EDGE: 0,
    UNSCORABLE_DATA_GAP: 0
  };
  let brier = 0;
  let scored = 0;
  let dirOk = 0;
  let dirN = 0;
  let tpUp = 0,
    fpUp = 0,
    fnUp = 0;
  let tpDown = 0,
    fpDown = 0,
    fnDown = 0;
  let tradeable = 0;
  let sumLong = 0;
  let sumShort = 0;
  let sumN = 0;

  for (let i = 0; i < n; i++) {
    const lab = args.labels[i]!;
    const p = args.preds[i]!;
    balance[lab.classLabel] = (balance[lab.classLabel] ?? 0) + 1;
    if (lab.classLabel === "UNSCORABLE_DATA_GAP") continue;
    scored += 1;
    if (lab.classLabel !== "NO_EDGE") tradeable += 1;
    if (lab.netLong != null && lab.netShort != null) {
      sumLong += lab.netLong;
      sumShort += lab.netShort;
      sumN += 1;
    }
    const yUp = lab.classLabel === "UP_TRADEABLE" ? 1 : 0;
    const yDown = lab.classLabel === "DOWN_TRADEABLE" ? 1 : 0;
    const yNo = lab.classLabel === "NO_EDGE" ? 1 : 0;
    brier +=
      (p.pUp - yUp) ** 2 + (p.pDown - yDown) ** 2 + (p.pNoEdge - yNo) ** 2;

    const predClass: GhClass =
      p.pUp >= p.pDown && p.pUp >= p.pNoEdge
        ? "UP_TRADEABLE"
        : p.pDown >= p.pNoEdge
          ? "DOWN_TRADEABLE"
          : "NO_EDGE";

    if (lab.classLabel !== "NO_EDGE" || predClass !== "NO_EDGE") {
      dirN += 1;
      if (
        (lab.classLabel === "UP_TRADEABLE" && predClass === "UP_TRADEABLE") ||
        (lab.classLabel === "DOWN_TRADEABLE" && predClass === "DOWN_TRADEABLE") ||
        (lab.classLabel === "NO_EDGE" && predClass === "NO_EDGE")
      ) {
        dirOk += 1;
      }
    }

    if (predClass === "UP_TRADEABLE" && lab.classLabel === "UP_TRADEABLE") tpUp++;
    if (predClass === "UP_TRADEABLE" && lab.classLabel !== "UP_TRADEABLE") fpUp++;
    if (predClass !== "UP_TRADEABLE" && lab.classLabel === "UP_TRADEABLE") fnUp++;
    if (predClass === "DOWN_TRADEABLE" && lab.classLabel === "DOWN_TRADEABLE")
      tpDown++;
    if (predClass === "DOWN_TRADEABLE" && lab.classLabel !== "DOWN_TRADEABLE")
      fpDown++;
    if (predClass !== "DOWN_TRADEABLE" && lab.classLabel === "DOWN_TRADEABLE")
      fnDown++;
  }

  return {
    horizonSec: args.horizonSec,
    sampleCount: n,
    classBalance: balance,
    directionAccuracy: dirN > 0 ? dirOk / dirN : 0,
    precisionUp: tpUp + fpUp > 0 ? tpUp / (tpUp + fpUp) : 0,
    recallUp: tpUp + fnUp > 0 ? tpUp / (tpUp + fnUp) : 0,
    precisionDown: tpDown + fpDown > 0 ? tpDown / (tpDown + fpDown) : 0,
    recallDown: tpDown + fnDown > 0 ? tpDown / (tpDown + fnDown) : 0,
    brierScore: scored > 0 ? brier / scored : 0,
    tradeableCoverage: scored > 0 ? tradeable / scored : 0,
    avgNetLong: sumN > 0 ? sumLong / sumN : 0,
    avgNetShort: sumN > 0 ? sumShort / sumN : 0
  };
}

export function computePolicyBacktest(trades: GhShadowTrade[]): GhPolicyBacktest {
  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");
  const breakevens = trades.filter((t) => t.result === "BREAKEVEN");
  const grossPnl = trades.reduce((s, t) => s + t.grossMove, 0);
  const friction = trades.reduce((s, t) => s + t.additionalFriction, 0);
  const netPnl = trades.reduce((s, t) => s + t.netMove, 0);
  const grossProfit = trades
    .filter((t) => t.netMove > 0)
    .reduce((s, t) => s + t.netMove, 0);
  const grossLossAbs = Math.abs(
    trades.filter((t) => t.netMove < 0).reduce((s, t) => s + t.netMove, 0)
  );
  const profitFactor =
    grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? Infinity : 0;

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.netMove;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const sessionPnl: Record<string, number> = {};
  const regimePnl: Record<string, number> = {};
  for (const t of trades) {
    sessionPnl[t.session] = (sessionPnl[t.session] ?? 0) + t.netMove;
    regimePnl[t.regime] = (regimePnl[t.regime] ?? 0) + t.netMove;
  }

  return {
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    grossPnl,
    friction,
    netPnl,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 999,
    expectancy: trades.length ? netPnl / trades.length : 0,
    maxDrawdown: maxDd,
    averageDuration: trades.length
      ? trades.reduce((s, t) => s + t.durationSeconds, 0) / trades.length
      : 0,
    buyPnl: trades
      .filter((t) => t.side === "BUY")
      .reduce((s, t) => s + t.netMove, 0),
    sellPnl: trades
      .filter((t) => t.side === "SELL")
      .reduce((s, t) => s + t.netMove, 0),
    sessionPnl,
    regimePnl
  };
}

export function maxDrawdownFromPnls(pnls: number[]): number {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return maxDd;
}
