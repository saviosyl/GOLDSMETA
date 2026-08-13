/**
 * Daily SHADOW performance — version-separated, Dublin day grouping for UI.
 */
import { GOLD_HUNTER_MODEL_VERSION, GOLD_HUNTER_STRATEGY_VERSION, GH_UI_TIMEZONE } from "./config";
import { maxDrawdownFromPnls } from "./metrics";
import type { GhDailySummary, GhShadowTrade } from "./types";

/** Format UTC ms as YYYY-MM-DD in Europe/Dublin (or override). */
export function dublinDateKey(
  timestampMs: number,
  timeZone = GH_UI_TIMEZONE
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestampMs));
}

export function filterTradesForDate(
  trades: GhShadowTrade[],
  date: string,
  strategyVersion = GOLD_HUNTER_STRATEGY_VERSION
): GhShadowTrade[] {
  return trades.filter(
    (t) =>
      t.strategyVersion === strategyVersion &&
      dublinDateKey(t.entryTimestampMs) === date
  );
}

export function buildDailySummary(
  trades: GhShadowTrade[],
  opts?: {
    date?: string;
    strategyVersion?: string;
    modelVersion?: string;
    startingEquity?: number;
  }
): GhDailySummary {
  const strategyVersion = opts?.strategyVersion ?? GOLD_HUNTER_STRATEGY_VERSION;
  const modelVersion = opts?.modelVersion ?? GOLD_HUNTER_MODEL_VERSION;
  const date =
    opts?.date ??
    (trades[0] ? dublinDateKey(trades[0].entryTimestampMs) : dublinDateKey(Date.now()));
  const dayTrades = trades.filter(
    (t) =>
      t.strategyVersion === strategyVersion &&
      dublinDateKey(t.entryTimestampMs) === date
  );

  const startingEquity = opts?.startingEquity ?? 0;
  const wins = dayTrades.filter((t) => t.result === "WIN");
  const losses = dayTrades.filter((t) => t.result === "LOSS");
  const breakevens = dayTrades.filter((t) => t.result === "BREAKEVEN");
  const netPnl = dayTrades.reduce((s, t) => s + t.netMove, 0);
  const grossProfit = dayTrades
    .filter((t) => t.netMove > 0)
    .reduce((s, t) => s + t.netMove, 0);
  const grossLoss = Math.abs(
    dayTrades.filter((t) => t.netMove < 0).reduce((s, t) => s + t.netMove, 0)
  );
  const friction = dayTrades.reduce((s, t) => s + t.additionalFriction, 0);
  const avgWin = wins.length
    ? wins.reduce((s, t) => s + t.netMove, 0) / wins.length
    : 0;
  const avgLoss = losses.length
    ? losses.reduce((s, t) => s + t.netMove, 0) / losses.length
    : 0;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;
  for (const t of dayTrades) {
    if (t.result === "LOSS") {
      losingStreak += 1;
      maxLosingStreak = Math.max(maxLosingStreak, losingStreak);
    } else {
      losingStreak = 0;
    }
  }

  const sessionBreakdown: Record<string, number> = {};
  const regimeBreakdown: Record<string, number> = {};
  for (const t of dayTrades) {
    sessionBreakdown[t.session] =
      (sessionBreakdown[t.session] ?? 0) + t.netMove;
    regimeBreakdown[t.regime] = (regimeBreakdown[t.regime] ?? 0) + t.netMove;
  }

  const nets = dayTrades.map((t) => t.netMove);
  const endingEquity = startingEquity + netPnl;

  return {
    date,
    strategyVersion,
    modelVersion,
    startingEquity,
    endingEquity,
    grossProfit,
    grossLoss,
    estimatedFriction: friction,
    netPnl,
    returnPct: startingEquity !== 0 ? (netPnl / Math.abs(startingEquity)) * 100 : 0,
    tradeCount: dayTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: dayTrades.length ? wins.length / dayTrades.length : 0,
    averageWin: avgWin,
    averageLoss: avgLoss,
    profitFactor,
    expectancy: dayTrades.length ? netPnl / dayTrades.length : 0,
    bestTrade: nets.length ? Math.max(...nets) : 0,
    worstTrade: nets.length ? Math.min(...nets) : 0,
    maxDrawdown: maxDrawdownFromPnls(nets),
    maxLosingStreak,
    averageDuration: dayTrades.length
      ? dayTrades.reduce((s, t) => s + t.durationSeconds, 0) / dayTrades.length
      : 0,
    buyPnl: dayTrades
      .filter((t) => t.side === "BUY")
      .reduce((s, t) => s + t.netMove, 0),
    sellPnl: dayTrades
      .filter((t) => t.side === "SELL")
      .reduce((s, t) => s + t.netMove, 0),
    sessionBreakdown,
    regimeBreakdown
  };
}

/** Data-derived commentary only when enough samples. */
export function buildDayExplanations(
  summary: GhDailySummary,
  minSamples = 3
): string[] {
  const lines: string[] = [];
  if (summary.tradeCount < minSamples) return lines;

  const sessions = Object.entries(summary.sessionBreakdown);
  if (sessions.length) {
    sessions.sort((a, b) => b[1] - a[1]);
    lines.push(`Best-performing session: ${sessions[0]![0]} (${sessions[0]![1].toFixed(3)})`);
    const worst = sessions[sessions.length - 1]!;
    lines.push(`Worst-performing session: ${worst[0]} (${worst[1].toFixed(3)})`);
  }
  lines.push(`BUY contribution: ${summary.buyPnl.toFixed(3)}`);
  lines.push(`SELL contribution: ${summary.sellPnl.toFixed(3)}`);
  const regimes = Object.entries(summary.regimeBreakdown);
  if (regimes.length) {
    regimes.sort((a, b) => b[1] - a[1]);
    lines.push(`Best regime: ${regimes[0]![0]} (${regimes[0]![1].toFixed(3)})`);
    const worst = regimes[regimes.length - 1]!;
    lines.push(`Worst regime: ${worst[0]} (${worst[1].toFixed(3)})`);
  }
  return lines;
}
