/**
 * Micro market-data collector abstraction.
 *
 * Prefer a separate persistent worker (not Core persistentQuoteWorker).
 * V1 default: polled completed M1/M5/M15 + Bid/Ask spot (when connected).
 * Continuous DOM/tick streaming is feature-gated until dedicated deployment exists.
 *
 * Health is fail-closed — never hard-code healthy=true.
 */
import {
  MICRO_M1_MAX_AGE_MS,
  MICRO_QUOTE_MAX_AGE_MS
} from "../config";
import type { MicroCTraderReadOnlyClient } from "../marketData/microCTraderClient";
import type { MicroMarketDataConnectionState } from "../marketData/types";
import type { MicroBar, MicroQuote } from "../types";

export type MicroCollectorStatus = {
  mode: "POLLED_BARS" | "STREAMING_FEATURE_GATED";
  connectionState: MicroMarketDataConnectionState;
  marketFeedConnected: boolean;
  marketFeedStatus: string;
  lastQuoteTs: string | null;
  lastM1CloseTs: string | null;
  domAvailable: boolean;
  tickStreamAvailable: boolean;
  healthy: boolean;
  reasons: string[];
  /** Forced Micro decision when unhealthy. */
  degradedDecision: "WAIT" | null;
  dataUnavailable: boolean;
};

function parseTs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateCollectorHealth(args: {
  quote: MicroQuote | null;
  lastM1: MicroBar | null;
  nowMs?: number;
  quoteMaxAgeMs?: number;
  m1MaxAgeMs?: number;
  marketFeedConnected: boolean;
}): { healthy: boolean; reasons: string[] } {
  const nowMs = args.nowMs ?? Date.now();
  const quoteMax = args.quoteMaxAgeMs ?? MICRO_QUOTE_MAX_AGE_MS;
  const m1Max = args.m1MaxAgeMs ?? MICRO_M1_MAX_AGE_MS;
  const reasons: string[] = [];

  if (!args.marketFeedConnected) {
    reasons.push("market_feed_not_connected");
  }

  if (!args.quote) {
    reasons.push("missing_bid_ask_quote");
  } else {
    if (!(args.quote.bid > 0) || !(args.quote.ask > 0) || !(args.quote.ask >= args.quote.bid)) {
      reasons.push("invalid_bid_ask");
    }
    const qTs = parseTs(args.quote.brokerTimestamp);
    if (qTs == null) {
      reasons.push("quote_timestamp_unparseable");
    } else if (nowMs - qTs > quoteMax) {
      reasons.push("quote_stale");
    }
    if (
      args.quote.freshness === "STALE" ||
      args.quote.freshness === "UNAVAILABLE" ||
      args.quote.freshness === "MARKET_CLOSED"
    ) {
      reasons.push(`quote_freshness_${args.quote.freshness.toLowerCase()}`);
    }
  }

  if (!args.lastM1) {
    reasons.push("missing_completed_m1");
  } else {
    if (!Number.isFinite(args.lastM1.closeTimeMs) || args.lastM1.closeTimeMs <= 0) {
      reasons.push("m1_timestamp_invalid");
    } else if (nowMs - args.lastM1.closeTimeMs > m1Max) {
      reasons.push("m1_stale");
    }
  }

  return { healthy: reasons.length === 0, reasons };
}

export function getCollectorStatus(
  client: MicroCTraderReadOnlyClient,
  meta: {
    lastQuoteTs: string | null;
    lastM1CloseTs: string | null;
    quote?: MicroQuote | null;
    lastM1?: MicroBar | null;
    nowMs?: number;
  }
): MicroCollectorStatus {
  const marketFeedConnected = client.isLiveMarketFeedConnected();
  const health = evaluateCollectorHealth({
    quote: meta.quote ?? null,
    lastM1: meta.lastM1 ?? null,
    nowMs: meta.nowMs,
    marketFeedConnected
  });

  return {
    mode: client.mode,
    connectionState: client.connectionState(),
    marketFeedConnected,
    marketFeedStatus: client.marketFeedStatusMessage(),
    lastQuoteTs: meta.lastQuoteTs,
    lastM1CloseTs: meta.lastM1CloseTs,
    domAvailable: false, // never claim live DOM until wired
    tickStreamAvailable: false,
    healthy: health.healthy,
    reasons: health.reasons,
    degradedDecision: health.healthy ? null : "WAIT",
    dataUnavailable: !health.healthy
  };
}
