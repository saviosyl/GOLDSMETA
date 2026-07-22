/**
 * Exchange-session helpers. Fail closed when session timing cannot be derived.
 */

import type { MarketIndicators } from "./marketData/marketDataProvider";

export interface SessionCloseEstimate {
  minutesToClose: number | null;
  source: "provider" | "unavailable";
  reason?: string;
}

/**
 * Prefer provider-supplied minutes-to-close when available.
 * Without an explicit value from market data / exchange calendar, return null (fail closed).
 */
export function estimateMinutesToClose(
  indicators: Pick<MarketIndicators, "sessionStatus"> & {
    minutesToClose?: number | null;
  },
  now = new Date()
): SessionCloseEstimate {
  void now;
  if (typeof indicators.minutesToClose === "number" && Number.isFinite(indicators.minutesToClose)) {
    return { minutesToClose: indicators.minutesToClose, source: "provider" };
  }
  return {
    minutesToClose: null,
    source: "unavailable",
    reason: "MINUTES_TO_CLOSE_UNAVAILABLE"
  };
}

/**
 * Estimate slippage from quote spread when bid/ask present.
 * Never invent a default bps value.
 */
export function estimateSlippageBpsFromQuote(quote: {
  bid: number | null;
  ask: number | null;
  last: number;
  spreadBps: number | null;
}): number | null {
  if (quote.spreadBps != null && Number.isFinite(quote.spreadBps)) {
    // Conservative: treat half-spread as expected slippage floor.
    return Math.max(0, quote.spreadBps / 2);
  }
  if (
    quote.bid != null &&
    quote.ask != null &&
    quote.bid > 0 &&
    quote.ask > quote.bid &&
    quote.last > 0
  ) {
    const mid = (quote.bid + quote.ask) / 2;
    return ((quote.ask - quote.bid) / mid) * 10_000 / 2;
  }
  return null;
}

export function isRegularSessionOpen(
  sessionStatus: MarketIndicators["sessionStatus"]
): boolean {
  return sessionStatus === "OPEN";
}
