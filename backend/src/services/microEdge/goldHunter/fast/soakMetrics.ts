/**
 * Live-shadow soak metrics — by setup, session, exit reason.
 * Observation only; does not change strategy parameters.
 */
import { classifySession } from "../sessionRegime";
import type {
  GhFastClosedTrade,
  GhFastExitReason,
  GhFastSetupId,
  GhFastSide
} from "./types";

export type SoakSetupStats = {
  setup: GhFastSetupId | "ALL";
  detections: number;
  qualifiedEntries: number;
  completedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  grossWin: number;
  grossLoss: number;
  netMove: number;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  avgMfe: number | null;
  avgMae: number | null;
  avgCaptureRatio: number | null;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
  p90DurationMs: number | null;
  rapidAbortPct: number | null;
  hardProtectionPct: number | null;
  trailHitPct: number | null;
  harvestPct: number | null;
  runnerPct: number | null;
  buyCount: number;
  sellCount: number;
};

export type SoakActivityStats = {
  marketEvents: number;
  decisions: number;
  signals: number;
  entries: number;
  completedTrades: number;
  runtimeMs: number;
  eventsPerSec: number | null;
  decisionsPerSec: number | null;
  signalsPerHour: number | null;
  entriesPerHour: number | null;
  tradesPerHour: number | null;
  medianEntryIntervalSec: number | null;
  fastestReentrySec: number | null;
  p10EntryIntervalSec: number | null;
  p50EntryIntervalSec: number | null;
  p90EntryIntervalSec: number | null;
};

function pctile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
}

function maxDrawdown(pnls: number[]): number {
  let peak = 0;
  let equity = 0;
  let dd = 0;
  for (const x of pnls) {
    equity += x;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return dd;
}

export function analyseClosedTrade(t: GhFastClosedTrade): {
  captureRatio: number | null;
  peakGiveback: number | null;
  lossCategory: string;
  winCategory: string;
} {
  const capture =
    t.mfe > 1e-9 ? Math.max(0, Math.min(2, t.netMove / t.mfe)) : null;
  const peakGiveback =
    t.mfe > 0 ? Math.max(0, t.mfe - Math.max(0, t.netMove)) : null;

  let lossCategory = "other";
  let winCategory = "other";
  if (t.result === "LOSS" || t.result === "BREAKEVEN") {
    if (t.exitReason === "RAPID_ABORT") lossCategory = "immediate_reversal";
    else if (t.exitReason === "HARD_PROTECTION") lossCategory = "hard_stop";
    else if (t.exitReason === "DATA_STALE" || t.exitReason === "SPREAD_UNSAFE") {
      lossCategory = "stale_data_protection";
    } else if (t.mfe <= 0 && t.mae < 0) lossCategory = "immediate_reversal";
    else if (t.setup === "A_MOMENTUM_IGNITION") lossCategory = "false_momentum_ignition";
    else if (t.setup === "B_FAST_BREAKOUT") lossCategory = "failed_breakout";
    else if (t.setup === "C_PULLBACK_REACCEL") {
      lossCategory = "failed_pullback_continuation";
    } else if (Math.abs(t.netMove) < 0.08) lossCategory = "spread_friction_loss";
  } else {
    if (t.durationMs <= 3000) winCategory = "quick_scalp";
    else if (t.exitReason === "TRAIL_HIT" || t.exitReason === "HARVEST_FADE") {
      winCategory = t.harvestRunner ? "trailing_harvest" : "edge_fade_exit";
    } else if (t.setup === "B_FAST_BREAKOUT") winCategory = "breakout_runner";
    else if (t.setup === "C_PULLBACK_REACCEL") {
      winCategory = "pullback_continuation";
    } else if (t.harvestRunner) winCategory = "trend_continuation";
    else winCategory = "quick_scalp";
  }
  return { captureRatio: capture, peakGiveback, lossCategory, winCategory };
}

export function computeSetupStats(
  setup: GhFastSetupId | "ALL",
  trades: GhFastClosedTrade[],
  detections: number,
  entries: number
): SoakSetupStats {
  const subset =
    setup === "ALL" ? trades : trades.filter((t) => t.setup === setup);
  const wins = subset.filter((t) => t.result === "WIN");
  const losses = subset.filter((t) => t.result === "LOSS");
  const be = subset.filter((t) => t.result === "BREAKEVEN");
  const grossWin = wins.reduce((s, t) => s + t.netMove, 0);
  const grossLossAbs = Math.abs(losses.reduce((s, t) => s + t.netMove, 0));
  const nets = subset.map((t) => t.netMove);
  const durations = subset.map((t) => t.durationMs).sort((a, b) => a - b);
  const captures = subset
    .map((t) => analyseClosedTrade(t).captureRatio)
    .filter((x): x is number => x != null);
  const exitPct = (reason: GhFastExitReason) =>
    subset.length
      ? subset.filter((t) => t.exitReason === reason).length / subset.length
      : null;
  const runners = subset.filter((t) => t.harvestRunner).length;

  return {
    setup,
    detections,
    qualifiedEntries: entries,
    completedTrades: subset.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: be.length,
    winRate: subset.length ? wins.length / subset.length : null,
    grossWin,
    grossLoss: -grossLossAbs,
    netMove: nets.reduce((a, b) => a + b, 0),
    expectancy: subset.length
      ? nets.reduce((a, b) => a + b, 0) / subset.length
      : null,
    profitFactor:
      grossLossAbs > 0 ? grossWin / grossLossAbs : grossWin > 0 ? Infinity : null,
    maxDrawdown: maxDrawdown(nets),
    avgMfe: subset.length
      ? subset.reduce((s, t) => s + t.mfe, 0) / subset.length
      : null,
    avgMae: subset.length
      ? subset.reduce((s, t) => s + t.mae, 0) / subset.length
      : null,
    avgCaptureRatio: captures.length
      ? captures.reduce((a, b) => a + b, 0) / captures.length
      : null,
    avgDurationMs: subset.length
      ? durations.reduce((a, b) => a + b, 0) / subset.length
      : null,
    medianDurationMs: pctile(durations, 0.5),
    p90DurationMs: pctile(durations, 0.9),
    rapidAbortPct: exitPct("RAPID_ABORT"),
    hardProtectionPct: exitPct("HARD_PROTECTION"),
    trailHitPct: exitPct("TRAIL_HIT"),
    harvestPct: exitPct("HARVEST_FADE"),
    runnerPct: subset.length ? runners / subset.length : null,
    buyCount: subset.filter((t) => t.side === "BUY").length,
    sellCount: subset.filter((t) => t.side === "SELL").length
  };
}

export function computeActivityStats(args: {
  marketEvents: number;
  decisions: number;
  signals: number;
  entryTimestampsMs: number[];
  completedTrades: number;
  runtimeMs: number;
}): SoakActivityStats {
  const hours = Math.max(1e-9, args.runtimeMs / 3_600_000);
  const secs = Math.max(1e-9, args.runtimeMs / 1000);
  const intervals: number[] = [];
  const sorted = [...args.entryTimestampsMs].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i]! - sorted[i - 1]!) / 1000);
  }
  intervals.sort((a, b) => a - b);
  return {
    marketEvents: args.marketEvents,
    decisions: args.decisions,
    signals: args.signals,
    entries: sorted.length,
    completedTrades: args.completedTrades,
    runtimeMs: args.runtimeMs,
    eventsPerSec: args.marketEvents / secs,
    decisionsPerSec: args.decisions / secs,
    signalsPerHour: args.signals / hours,
    entriesPerHour: sorted.length / hours,
    tradesPerHour: args.completedTrades / hours,
    medianEntryIntervalSec: pctile(intervals, 0.5),
    fastestReentrySec: intervals[0] ?? null,
    p10EntryIntervalSec: pctile(intervals, 0.1),
    p50EntryIntervalSec: pctile(intervals, 0.5),
    p90EntryIntervalSec: pctile(intervals, 0.9)
  };
}

export function groupTradesBySession(
  trades: GhFastClosedTrade[]
): Record<string, GhFastClosedTrade[]> {
  const out: Record<string, GhFastClosedTrade[]> = {
    ASIA: [],
    LONDON: [],
    NEW_YORK: [],
    OVERLAP: [],
    OFF_HOURS: []
  };
  for (const t of trades) {
    const s = classifySession(t.entryTs);
    out[s] = out[s] ?? [];
    out[s]!.push(t);
  }
  return out;
}

export type LossWinBreakdown = {
  losses: Record<string, number>;
  wins: Record<string, number>;
};

export function categorizeTrades(trades: GhFastClosedTrade[]): LossWinBreakdown {
  const losses: Record<string, number> = {};
  const wins: Record<string, number> = {};
  for (const t of trades) {
    const a = analyseClosedTrade(t);
    if (t.result === "WIN") {
      wins[a.winCategory] = (wins[a.winCategory] ?? 0) + 1;
    } else {
      losses[a.lossCategory] = (losses[a.lossCategory] ?? 0) + 1;
    }
  }
  return { losses, wins };
}

export type SideSplit = { BUY: number; SELL: number };

export function sideSplit(trades: GhFastClosedTrade[]): SideSplit {
  return {
    BUY: trades.filter((t) => t.side === "BUY").length,
    SELL: trades.filter((t) => t.side === "SELL").length
  };
}
