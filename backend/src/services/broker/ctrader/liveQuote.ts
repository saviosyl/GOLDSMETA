/**
 * Authoritative Pepperstone XAUUSD quote model + freshness.
 * Dashboard display and AutoTrade execution share this record.
 * Thresholds are configurable — market tick frequency varies by session.
 */

import type { BrokerQuote } from "../domain";

export type QuoteFreshness =
  | "LIVE"
  | "DELAYED"
  | "STALE"
  | "MARKET_CLOSED"
  | "UNAVAILABLE";

export type AuthoritativeQuote = {
  symbolId: string;
  symbolName: string;
  digits: number | null;
  pipPosition: number | null;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  brokerTimestamp: string;
  receivedAt: string;
  quoteSequence: number;
  freshness: QuoteFreshness;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  source: "LIVE" | "CACHED";
  /** Broker account environment that produced the quote. */
  environment: "DEMO" | "LIVE";
  ageMs: number;
  /** True only when freshness is LIVE and market is OPEN. */
  executable: boolean;
};

export type LiveQuoteThresholds = {
  liveMaxAgeMs: number;
  delayedMaxAgeMs: number;
};

export const DEFAULT_LIVE_QUOTE_THRESHOLDS: LiveQuoteThresholds = {
  liveMaxAgeMs: 5_000,
  delayedMaxAgeMs: 30_000
};

export function loadLiveQuoteThresholds(
  source: NodeJS.ProcessEnv = process.env
): LiveQuoteThresholds {
  const live = Number(source.CTRADER_QUOTE_LIVE_MAX_AGE_MS ?? "");
  const delayed = Number(source.CTRADER_QUOTE_DELAYED_MAX_AGE_MS ?? "");
  return {
    liveMaxAgeMs:
      Number.isFinite(live) && live > 0
        ? live
        : DEFAULT_LIVE_QUOTE_THRESHOLDS.liveMaxAgeMs,
    delayedMaxAgeMs:
      Number.isFinite(delayed) && delayed > 0
        ? delayed
        : DEFAULT_LIVE_QUOTE_THRESHOLDS.delayedMaxAgeMs
  };
}

export function computeMid(bid: number, ask: number): number {
  return Number(((bid + ask) / 2).toFixed(6));
}

export function computeSpread(bid: number, ask: number): number {
  return Number((ask - bid).toFixed(6));
}

export function assertBidAskOrder(bid: number, ask: number): void {
  if (!(Number.isFinite(bid) && Number.isFinite(ask))) {
    throw Object.assign(new Error("CTRADER_QUOTE_UNAVAILABLE"), {
      code: "CTRADER_QUOTE_UNAVAILABLE"
    });
  }
  if (!(ask >= bid)) {
    throw Object.assign(new Error("CTRADER_QUOTE_BID_ASK_REVERSED"), {
      code: "CTRADER_QUOTE_BID_ASK_REVERSED"
    });
  }
}

/**
 * Resolve freshness from quote age + market status.
 * MARKET_CLOSED wins over age labels while the session is closed.
 */
export function resolveQuoteFreshness(args: {
  ageMs: number;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  hasQuote: boolean;
  nowMs?: number;
  thresholds?: LiveQuoteThresholds;
}): QuoteFreshness {
  if (!args.hasQuote) return "UNAVAILABLE";
  if (args.marketStatus === "CLOSED") return "MARKET_CLOSED";
  const t = args.thresholds ?? DEFAULT_LIVE_QUOTE_THRESHOLDS;
  if (args.ageMs <= t.liveMaxAgeMs) return "LIVE";
  if (args.ageMs <= t.delayedMaxAgeMs) return "DELAYED";
  return "STALE";
}

export function isQuoteExecutableForAutoTrade(
  freshness: QuoteFreshness,
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN"
): boolean {
  return freshness === "LIVE" && marketStatus === "OPEN";
}

/** Executable side for AutoTrade — never mid. */
export function executableEntryPrice(
  side: "BUY" | "SELL",
  quote: Pick<AuthoritativeQuote, "bid" | "ask">
): number {
  return side === "BUY" ? quote.ask : quote.bid;
}

export function buildAuthoritativeQuote(args: {
  symbolId: string;
  symbolName: string;
  digits?: number | null;
  pipPosition?: number | null;
  bid: number;
  ask: number;
  brokerTimestamp: string;
  receivedAt?: string;
  quoteSequence: number;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  environment: "DEMO" | "LIVE";
  source?: "LIVE" | "CACHED";
  nowMs?: number;
  thresholds?: LiveQuoteThresholds;
}): AuthoritativeQuote {
  assertBidAskOrder(args.bid, args.ask);
  const receivedAt = args.receivedAt ?? new Date(args.nowMs ?? Date.now()).toISOString();
  const nowMs = args.nowMs ?? Date.now();
  const brokerMs = Date.parse(args.brokerTimestamp);
  const ageMs = Number.isFinite(brokerMs)
    ? Math.max(0, nowMs - brokerMs)
    : Math.max(0, nowMs - Date.parse(receivedAt));
  const mid = computeMid(args.bid, args.ask);
  const spread = computeSpread(args.bid, args.ask);
  const freshness = resolveQuoteFreshness({
    ageMs,
    marketStatus: args.marketStatus,
    hasQuote: true,
    thresholds: args.thresholds
  });
  return {
    symbolId: args.symbolId,
    symbolName: args.symbolName,
    digits: args.digits ?? null,
    pipPosition: args.pipPosition ?? null,
    bid: args.bid,
    ask: args.ask,
    mid,
    spread,
    brokerTimestamp: args.brokerTimestamp,
    receivedAt,
    quoteSequence: args.quoteSequence,
    freshness,
    marketStatus: args.marketStatus,
    source: args.source ?? "LIVE",
    environment: args.environment,
    ageMs,
    executable: isQuoteExecutableForAutoTrade(freshness, args.marketStatus)
  };
}

/** Recompute freshness for a stored quote at read time. */
export function refreshAuthoritativeFreshness(
  quote: AuthoritativeQuote,
  nowMs: number = Date.now(),
  thresholds?: LiveQuoteThresholds
): AuthoritativeQuote {
  const brokerMs = Date.parse(quote.brokerTimestamp);
  const ageMs = Number.isFinite(brokerMs)
    ? Math.max(0, nowMs - brokerMs)
    : Math.max(0, nowMs - Date.parse(quote.receivedAt));
  const freshness = resolveQuoteFreshness({
    ageMs,
    marketStatus: quote.marketStatus,
    hasQuote: true,
    thresholds
  });
  return {
    ...quote,
    ageMs,
    freshness,
    executable: isQuoteExecutableForAutoTrade(freshness, quote.marketStatus),
    source: "CACHED"
  };
}

export function toBrokerQuote(q: AuthoritativeQuote): BrokerQuote {
  return {
    symbolId: q.symbolId,
    symbolName: q.symbolName,
    bid: q.bid,
    ask: q.ask,
    spread: q.spread,
    timestamp: q.brokerTimestamp,
    marketStatus: q.marketStatus,
    stale: q.freshness === "STALE" || q.freshness === "DELAYED",
    source: q.source === "CACHED" ? "CACHED" : "LIVE"
  };
}

export function publicLiveQuotePayload(q: AuthoritativeQuote | null): {
  available: boolean;
  quote: null | {
    symbolId: string;
    symbolName: string;
    digits: number | null;
    pipPosition: number | null;
    bid: number;
    ask: number;
    mid: number;
    spread: number;
    brokerTimestamp: string;
    receivedAt: string;
    quoteSequence: number;
    freshness: QuoteFreshness;
    marketStatus: AuthoritativeQuote["marketStatus"];
    ageMs: number;
    executable: boolean;
    environment: "DEMO" | "LIVE";
  };
} {
  if (!q) {
    return { available: false, quote: null };
  }
  return {
    available: true,
    quote: {
      symbolId: q.symbolId,
      symbolName: q.symbolName,
      digits: q.digits,
      pipPosition: q.pipPosition,
      bid: q.bid,
      ask: q.ask,
      mid: q.mid,
      spread: q.spread,
      brokerTimestamp: q.brokerTimestamp,
      receivedAt: q.receivedAt,
      quoteSequence: q.quoteSequence,
      freshness: q.freshness,
      marketStatus: q.marketStatus,
      ageMs: q.ageMs,
      executable: q.executable,
      environment: q.environment
    }
  };
}
