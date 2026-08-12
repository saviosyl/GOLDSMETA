/**
 * Micro market-data collector health — fail-closed.
 */
import {
  MICRO_M1_MAX_AGE_MS,
  MICRO_QUOTE_MAX_AGE_MS
} from "../config";
import type { MicroCTraderReadOnlyClient } from "../marketData/microCTraderClient";
import type { MicroMarketDataConnectionState } from "../marketData/types";
import type { MicroBar, MicroQuote } from "../types";

export type MicroCollectorStatus = {
  mode: string;
  connectionState: MicroMarketDataConnectionState;
  marketFeedConnected: boolean;
  marketFeedStatus: string;
  lastQuoteTs: string | null;
  lastM1CloseTs: string | null;
  domAvailable: boolean;
  tickStreamAvailable: boolean;
  healthy: boolean;
  reasons: string[];
  degradedDecision: "WAIT" | null;
  dataUnavailable: boolean;
  lastConnectedAt?: string | null;
  lastDisconnectedAt?: string | null;
  reconnectAttempts?: number;
  lastErrorCode?: string | null;
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
  transportConnected?: boolean;
  symbolResolved?: boolean;
  credentialsConfigured?: boolean;
  heartbeatAt?: string | null;
  heartbeatMaxAgeMs?: number;
  extraReasons?: string[];
}): { healthy: boolean; reasons: string[] } {
  const nowMs = args.nowMs ?? Date.now();
  const quoteMax = args.quoteMaxAgeMs ?? MICRO_QUOTE_MAX_AGE_MS;
  const m1Max = args.m1MaxAgeMs ?? MICRO_M1_MAX_AGE_MS;
  const reasons: string[] = [...(args.extraReasons ?? [])];

  if (args.credentialsConfigured === false) reasons.push("oauth_missing");
  if (!args.marketFeedConnected) reasons.push("market_feed_not_connected");
  if (args.transportConnected === false) reasons.push("transport_disconnected");
  if (args.symbolResolved === false) reasons.push("xauusd_not_found");

  if (!args.quote) {
    reasons.push("quote_missing");
  } else {
    if (!(args.quote.bid > 0) || !(args.quote.ask > 0) || !(args.quote.ask >= args.quote.bid)) {
      reasons.push("quote_invalid");
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
    reasons.push("m1_missing");
  } else {
    if (!Number.isFinite(args.lastM1.closeTimeMs) || args.lastM1.closeTimeMs <= 0) {
      reasons.push("m1_timestamp_invalid");
    } else if (nowMs - args.lastM1.closeTimeMs > m1Max) {
      reasons.push("m1_stale");
    }
  }

  if (args.heartbeatAt != null) {
    const hb = parseTs(args.heartbeatAt);
    const maxHb = args.heartbeatMaxAgeMs ?? 60_000;
    if (hb == null || nowMs - hb > maxHb) reasons.push("collector_heartbeat_stale");
  }

  // Deduplicate
  const unique = [...new Set(reasons)];
  return { healthy: unique.length === 0, reasons: unique };
}

export function getCollectorStatus(
  client: MicroCTraderReadOnlyClient,
  meta: {
    lastQuoteTs: string | null;
    lastM1CloseTs: string | null;
    quote?: MicroQuote | null;
    lastM1?: MicroBar | null;
    nowMs?: number;
    transportConnected?: boolean;
    symbolResolved?: boolean;
    credentialsConfigured?: boolean;
    heartbeatAt?: string | null;
    lastConnectedAt?: string | null;
    lastDisconnectedAt?: string | null;
    reconnectAttempts?: number;
    lastErrorCode?: string | null;
    extraReasons?: string[];
  }
): MicroCollectorStatus {
  const marketFeedConnected = client.isLiveMarketFeedConnected();
  const health = evaluateCollectorHealth({
    quote: meta.quote ?? null,
    lastM1: meta.lastM1 ?? null,
    nowMs: meta.nowMs,
    marketFeedConnected,
    transportConnected: meta.transportConnected,
    symbolResolved: meta.symbolResolved,
    credentialsConfigured: meta.credentialsConfigured,
    heartbeatAt: meta.heartbeatAt,
    extraReasons: meta.extraReasons
  });

  return {
    mode: client.mode,
    connectionState: client.connectionState(),
    marketFeedConnected,
    marketFeedStatus: client.marketFeedStatusMessage(),
    lastQuoteTs: meta.lastQuoteTs,
    lastM1CloseTs: meta.lastM1CloseTs,
    domAvailable: false,
    tickStreamAvailable: false,
    healthy: health.healthy,
    reasons: health.reasons,
    degradedDecision: health.healthy ? null : "WAIT",
    dataUnavailable: !health.healthy,
    lastConnectedAt: meta.lastConnectedAt,
    lastDisconnectedAt: meta.lastDisconnectedAt,
    reconnectAttempts: meta.reconnectAttempts,
    lastErrorCode: meta.lastErrorCode
  };
}
