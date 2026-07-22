/**
 * SHADOW session decision records and performance metrics.
 * Results are hypothetical — not guaranteed future performance.
 */

import type { StockExitReason, StockStrategyProfile } from "./featureFlags";

export type ShadowDecisionOutcome = "BUY" | "WAIT" | "BLOCKED";

export interface ShadowDecisionRecord {
  id: string;
  userId: string;
  scanTimestamp: string;
  symbol: string;
  alpacaFeed: string;
  dataLabel: string;
  quoteTimestamp: string;
  entryPrice: number | null;
  bid: number | null;
  ask: number | null;
  spreadBps: number | null;
  strategy: StockStrategyProfile | null;
  indicators: Record<string, number | string | null>;
  overallScore: number | null;
  confidence: number | null;
  supportReasons: string[];
  blockReasons: string[];
  outcome: ShadowDecisionOutcome;
  quantity: number | null;
  stop: number | null;
  takeProfit: number | null;
  hypotheticalEntry: number | null;
  hypotheticalExit: number | null;
  exitReason: StockExitReason | null;
  grossPnl: number | null;
  estimatedSlippage: number | null;
  netPnl: number | null;
  holdingDurationMinutes: number | null;
  highestFavourableMovement: number | null;
  maximumAdverseMovement: number | null;
  createdAt: string;
}

export interface ShadowPerformanceMetrics {
  disclaimer: string;
  marketSessionsObserved: number;
  opportunitiesEvaluated: number;
  tradesOpened: number;
  tradesClosed: number;
  winRate: number | null;
  lossRate: number | null;
  grossPnl: number;
  netPnl: number;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  maximumDrawdown: number;
  maximumConsecutiveLosses: number;
  averageHoldingTimeMinutes: number | null;
  stopLossExits: number;
  takeProfitExits: number;
  trailingStopExits: number;
  strategyInvalidationExits: number;
  endOfDayExits: number;
  blockedOpportunities: number;
  waitOpportunities: number;
  dataOutages: number;
  staleDataBlocks: number;
  providerDivergenceBlocks: number;
}

export const SHADOW_PERFORMANCE_DISCLAIMER =
  "SHADOW results are hypothetical validation only and do not guarantee future performance.";

export function emptyShadowPerformance(): ShadowPerformanceMetrics {
  return {
    disclaimer: SHADOW_PERFORMANCE_DISCLAIMER,
    marketSessionsObserved: 0,
    opportunitiesEvaluated: 0,
    tradesOpened: 0,
    tradesClosed: 0,
    winRate: null,
    lossRate: null,
    grossPnl: 0,
    netPnl: 0,
    averageWin: null,
    averageLoss: null,
    profitFactor: null,
    maximumDrawdown: 0,
    maximumConsecutiveLosses: 0,
    averageHoldingTimeMinutes: null,
    stopLossExits: 0,
    takeProfitExits: 0,
    trailingStopExits: 0,
    strategyInvalidationExits: 0,
    endOfDayExits: 0,
    blockedOpportunities: 0,
    waitOpportunities: 0,
    dataOutages: 0,
    staleDataBlocks: 0,
    providerDivergenceBlocks: 0
  };
}

export function calculateShadowPerformance(
  decisions: ShadowDecisionRecord[],
  options?: { useMarketSessionDate?: boolean }
): ShadowPerformanceMetrics {
  const metrics = emptyShadowPerformance();
  metrics.opportunitiesEvaluated = decisions.length;
  metrics.blockedOpportunities = decisions.filter((d) => d.outcome === "BLOCKED").length;
  metrics.waitOpportunities = decisions.filter((d) => d.outcome === "WAIT").length;
  metrics.tradesOpened = decisions.filter((d) => d.outcome === "BUY").length;

  const sessionKey = (iso: string): string => {
    if (!options?.useMarketSessionDate) return iso.slice(0, 10);
    // America/New_York calendar date
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    return y && m && day ? `${y}-${m}-${day}` : iso.slice(0, 10);
  };

  const sessions = new Set(
    decisions.map((d) => sessionKey(d.scanTimestamp)).filter((d) => d.length === 10)
  );
  metrics.marketSessionsObserved = sessions.size;

  metrics.dataOutages = decisions.filter((d) =>
    d.blockReasons.some((r) => /OUTAGE|UNAVAILABLE|ALPACA_/i.test(r))
  ).length;
  metrics.staleDataBlocks = decisions.filter((d) =>
    d.blockReasons.some((r) => /STALE/i.test(r))
  ).length;
  metrics.providerDivergenceBlocks = decisions.filter((d) =>
    d.blockReasons.some((r) => /DIVERGENCE/i.test(r))
  ).length;

  const closed = decisions
    .filter((d) => d.hypotheticalExit != null && d.netPnl != null && d.outcome === "BUY")
    .slice()
    .sort((a, b) => Date.parse(a.scanTimestamp) - Date.parse(b.scanTimestamp));
  metrics.tradesClosed = closed.length;
  metrics.grossPnl = closed.reduce((s, d) => s + (d.grossPnl ?? 0), 0);
  metrics.netPnl = closed.reduce((s, d) => s + (d.netPnl ?? 0), 0);

  const wins = closed.filter((d) => (d.netPnl ?? 0) > 0);
  const losses = closed.filter((d) => (d.netPnl ?? 0) < 0);
  if (closed.length) {
    metrics.winRate = wins.length / closed.length;
    metrics.lossRate = losses.length / closed.length;
  }
  if (wins.length) {
    metrics.averageWin = wins.reduce((s, d) => s + (d.netPnl ?? 0), 0) / wins.length;
  }
  if (losses.length) {
    metrics.averageLoss = losses.reduce((s, d) => s + (d.netPnl ?? 0), 0) / losses.length;
  }
  const grossWins = wins.reduce((s, d) => s + Math.abs(d.netPnl ?? 0), 0);
  const grossLosses = losses.reduce((s, d) => s + Math.abs(d.netPnl ?? 0), 0);
  if (grossLosses > 0) metrics.profitFactor = grossWins / grossLosses;
  else if (grossWins > 0) metrics.profitFactor = null;

  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  let consec = 0;
  let maxConsec = 0;
  for (const d of closed) {
    equity += d.netPnl ?? 0;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if ((d.netPnl ?? 0) < 0) {
      consec += 1;
      maxConsec = Math.max(maxConsec, consec);
    } else {
      consec = 0;
    }
  }
  metrics.maximumDrawdown = maxDd;
  metrics.maximumConsecutiveLosses = maxConsec;

  const holds = closed
    .map((d) => d.holdingDurationMinutes)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (holds.length) {
    metrics.averageHoldingTimeMinutes = holds.reduce((a, b) => a + b, 0) / holds.length;
  }

  for (const d of closed) {
    const reason = String(d.exitReason ?? "");
    if (reason === "HARD_STOP") metrics.stopLossExits += 1;
    else if (reason === "TAKE_PROFIT") metrics.takeProfitExits += 1;
    else if (reason === "TRAILING_STOP") metrics.trailingStopExits += 1;
    else if (
      reason === "TREND_INVALIDATION" ||
      reason === "INDICATOR_REVERSAL" ||
      reason === "VWAP_LOSS"
    ) {
      metrics.strategyInvalidationExits += 1;
    } else if (reason === "END_OF_DAY") metrics.endOfDayExits += 1;
  }

  return metrics;
}
