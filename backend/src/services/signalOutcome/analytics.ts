/**
 * Hypothetical signal performance analytics.
 * WAIT and AMBIGUOUS outcomes are excluded from win-rate / trade counts.
 * Confidence uses GoldMeta 0–100 scale bands.
 */

import {
  TRADE_COUNTABLE_OUTCOMES,
  type SignalFinalOutcome,
  type SignalOutcomeRecord,
  type SignalPerformanceDailyAggregate
} from "./types";
import { confidenceOnHundredScale } from "./engine";

export interface SignalPerformanceSummary {
  label: "HYPOTHETICAL SIGNAL PERFORMANCE";
  disclaimer: string;
  totalConfirmedBuySell: number;
  pendingEntries: number;
  openSignals: number;
  closedSignals: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  cancelled: number;
  ambiguousIntrabar: number;
  dataUnavailable: number;
  waitOnly: number;
  winRate: number | null;
  netPoints: number;
  netR: number;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  maximumDrawdownR: number;
  maximumConsecutiveLosses: number;
  averageHoldingTimeMs: number | null;
  tp1HitRate: number | null;
  tp2HitRate: number | null;
  tp3HitRate: number | null;
  stopLossRate: number | null;
  byConfidenceRange: Record<string, { count: number; wins: number; losses: number }>;
  bySetupScoreRange: Record<string, { count: number; wins: number; losses: number }>;
  byStrategy: Record<string, number>;
  byTimeframe: Record<string, number>;
  byDirection: { BUY: number; SELL: number };
  bySession: Record<string, number>;
  byDataQuality: Record<string, number>;
  historyComplete: boolean;
  aggregateDays: number;
}

/** Confidence bands on the GoldMeta 0–100 scale. */
export const confidenceBand = (confidence: number): string => {
  const c = confidenceOnHundredScale(confidence);
  if (c >= 90) return "90-100";
  if (c >= 80) return "80-89";
  if (c >= 70) return "70-79";
  if (c >= 60) return "60-69";
  return "below-60";
};

const scoreBand = (score: number): string => {
  if (score >= 80) return "80+";
  if (score >= 60) return "60-79";
  if (score >= 40) return "40-59";
  return "below-40";
};

const isTrade = (o: SignalFinalOutcome): boolean =>
  o != null && (TRADE_COUNTABLE_OUTCOMES as string[]).includes(o);

export function computeSignalPerformance(
  records: SignalOutcomeRecord[],
  opts: { aggregates?: SignalPerformanceDailyAggregate[]; historyComplete?: boolean } = {}
): SignalPerformanceSummary {
  const confirmed = records.filter((r) => r.snapshot.direction !== "WAIT");
  const waitOnly = records.filter((r) => r.snapshot.direction === "WAIT").length;

  let pendingEntries = 0;
  let openSignals = 0;
  let closedSignals = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let expired = 0;
  let cancelled = 0;
  let ambiguousIntrabar = 0;
  let dataUnavailable = 0;
  let netPoints = 0;
  let netR = 0;
  const winPts: number[] = [];
  const lossPts: number[] = [];
  const holdings: number[] = [];
  let tp1Hits = 0;
  let tp2Hits = 0;
  let tp3Hits = 0;
  let stopHits = 0;
  let entered = 0;

  const byConfidenceRange: SignalPerformanceSummary["byConfidenceRange"] = {};
  const bySetupScoreRange: SignalPerformanceSummary["bySetupScoreRange"] = {};
  const byStrategy: Record<string, number> = {};
  const byTimeframe: Record<string, number> = {};
  const byDirection = { BUY: 0, SELL: 0 };
  const bySession: Record<string, number> = {};
  const byDataQuality: Record<string, number> = {};

  const closedTrades = confirmed
    .filter((r) => r.finalResult && isTrade(r.finalResult.outcome))
    .sort((a, b) =>
      String(a.finalResult!.exitTimestamp).localeCompare(String(b.finalResult!.exitTimestamp))
    );

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  let streak = 0;
  let maxStreak = 0;
  for (const r of closedTrades) {
    const nr = r.finalResult!.netR ?? 0;
    equity += nr;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
    if (r.finalResult!.outcome === "LOSS") {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }

  for (const r of confirmed) {
    const life = r.monitoring.lifecycle;
    if (life === "PENDING_ENTRY") pendingEntries += 1;
    if (life === "OPEN" || life === "TP1_HIT" || life === "TP2_HIT" || life === "BREAKEVEN") {
      openSignals += 1;
    }
    if (r.snapshot.direction === "BUY") byDirection.BUY += 1;
    if (r.snapshot.direction === "SELL") byDirection.SELL += 1;
    const tf = r.snapshot.timeframe ?? "unknown";
    byTimeframe[tf] = (byTimeframe[tf] ?? 0) + 1;
    const strat = r.snapshot.strategy ?? "unknown";
    byStrategy[strat] = (byStrategy[strat] ?? 0) + 1;
    const sess = r.snapshot.session ?? "unknown";
    bySession[sess] = (bySession[sess] ?? 0) + 1;
    byDataQuality[r.snapshot.dataQuality] = (byDataQuality[r.snapshot.dataQuality] ?? 0) + 1;

    const cb = confidenceBand(r.snapshot.confidence);
    byConfidenceRange[cb] ??= { count: 0, wins: 0, losses: 0 };
    byConfidenceRange[cb].count += 1;
    const sb = scoreBand(r.snapshot.setupScore);
    bySetupScoreRange[sb] ??= { count: 0, wins: 0, losses: 0 };
    bySetupScoreRange[sb].count += 1;

    if (r.entry.entryReached) entered += 1;
    if (r.monitoring.tp1Status === "HIT") tp1Hits += 1;
    if (r.monitoring.tp2Status === "HIT") tp2Hits += 1;
    if (r.monitoring.tp3Status === "HIT") tp3Hits += 1;

    const outcome = r.finalResult?.outcome ?? null;
    if (outcome === "WIN") {
      wins += 1;
      closedSignals += 1;
      byConfidenceRange[cb].wins += 1;
      bySetupScoreRange[sb].wins += 1;
      netPoints += r.finalResult?.netPoints ?? 0;
      netR += r.finalResult?.netR ?? 0;
      if (r.finalResult?.netPoints != null) winPts.push(r.finalResult.netPoints);
      if (r.finalResult?.holdingDurationMs != null) holdings.push(r.finalResult.holdingDurationMs);
    } else if (outcome === "LOSS") {
      losses += 1;
      closedSignals += 1;
      stopHits += 1;
      byConfidenceRange[cb].losses += 1;
      bySetupScoreRange[sb].losses += 1;
      netPoints += r.finalResult?.netPoints ?? 0;
      netR += r.finalResult?.netR ?? 0;
      if (r.finalResult?.netPoints != null) lossPts.push(r.finalResult.netPoints);
      if (r.finalResult?.holdingDurationMs != null) holdings.push(r.finalResult.holdingDurationMs);
    } else if (outcome === "BREAKEVEN") {
      breakeven += 1;
      closedSignals += 1;
    } else if (outcome === "EXPIRED" || life === "EXPIRED") {
      expired += 1;
    } else if (outcome === "CANCELLED" || life === "CANCELLED") {
      cancelled += 1;
    } else if (outcome === "AMBIGUOUS" || life === "AMBIGUOUS_INTRABAR" || life === "ENTRY_SEQUENCE_AMBIGUOUS") {
      ambiguousIntrabar += 1;
    } else if (outcome === "DATA_UNAVAILABLE" || life === "DATA_UNAVAILABLE") {
      dataUnavailable += 1;
    }
  }

  // When full record set is unavailable, fold persisted daily aggregates for closed totals.
  const aggregates = opts.aggregates ?? [];
  if (aggregates.length > 0 && opts.historyComplete === false) {
    for (const a of aggregates) {
      wins += a.wins;
      losses += a.losses;
      breakeven += a.breakeven;
      expired += a.expired;
      cancelled += a.cancelled;
      ambiguousIntrabar += a.ambiguousIntrabar;
      dataUnavailable += a.dataUnavailable;
      netPoints += a.netPoints;
      netR += a.netR;
      closedSignals += a.closedTradeCount;
    }
  }

  const tradeN = wins + losses + breakeven;
  const avg = (xs: number[]): number | null =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
  const grossWins = winPts.reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(lossPts.reduce((a, b) => a + b, 0));

  return {
    label: "HYPOTHETICAL SIGNAL PERFORMANCE",
    disclaimer: "Past hypothetical results do not guarantee future trading performance.",
    totalConfirmedBuySell: confirmed.length,
    pendingEntries,
    openSignals,
    closedSignals,
    wins,
    losses,
    breakeven,
    expired,
    cancelled,
    ambiguousIntrabar,
    dataUnavailable,
    waitOnly,
    winRate: tradeN > 0 ? Math.round((wins / tradeN) * 10000) / 100 : null,
    netPoints: Math.round(netPoints * 100) / 100,
    netR: Math.round(netR * 100) / 100,
    averageWin: avg(winPts),
    averageLoss: avg(lossPts),
    profitFactor: grossLossAbs > 0 ? Math.round((grossWins / grossLossAbs) * 100) / 100 : null,
    maximumDrawdownR: Math.round(maxDd * 100) / 100,
    maximumConsecutiveLosses: maxStreak,
    averageHoldingTimeMs: avg(holdings),
    tp1HitRate: entered > 0 ? Math.round((tp1Hits / entered) * 10000) / 100 : null,
    tp2HitRate: entered > 0 ? Math.round((tp2Hits / entered) * 10000) / 100 : null,
    tp3HitRate: entered > 0 ? Math.round((tp3Hits / entered) * 10000) / 100 : null,
    stopLossRate: entered > 0 ? Math.round((stopHits / entered) * 10000) / 100 : null,
    byConfidenceRange,
    bySetupScoreRange,
    byStrategy,
    byTimeframe,
    byDirection,
    bySession,
    byDataQuality,
    historyComplete: opts.historyComplete !== false,
    aggregateDays: aggregates.length
  };
}

/** Merge daily aggregates into a compact closed-trade summary (for >500 histories). */
export function summarizeFromDailyAggregates(
  aggregates: SignalPerformanceDailyAggregate[]
): Pick<
  SignalPerformanceSummary,
  | "wins"
  | "losses"
  | "breakeven"
  | "expired"
  | "cancelled"
  | "ambiguousIntrabar"
  | "dataUnavailable"
  | "netPoints"
  | "netR"
  | "closedSignals"
  | "winRate"
> {
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let expired = 0;
  let cancelled = 0;
  let ambiguousIntrabar = 0;
  let dataUnavailable = 0;
  let netPoints = 0;
  let netR = 0;
  let closedSignals = 0;
  for (const a of aggregates) {
    wins += a.wins;
    losses += a.losses;
    breakeven += a.breakeven;
    expired += a.expired;
    cancelled += a.cancelled;
    ambiguousIntrabar += a.ambiguousIntrabar;
    dataUnavailable += a.dataUnavailable;
    netPoints += a.netPoints;
    netR += a.netR;
    closedSignals += a.closedTradeCount;
  }
  const tradeN = wins + losses + breakeven;
  return {
    wins,
    losses,
    breakeven,
    expired,
    cancelled,
    ambiguousIntrabar,
    dataUnavailable,
    netPoints: Math.round(netPoints * 100) / 100,
    netR: Math.round(netR * 100) / 100,
    closedSignals,
    winRate: tradeN > 0 ? Math.round((wins / tradeN) * 10000) / 100 : null
  };
}
