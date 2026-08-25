/**
 * Spot quote helpers — supports partial ProtoOASpotEvent updates.
 * Bid/Ask fields are optional on each event; maintain last-known sides.
 */
import type { MicroQuote } from "../types";
import { MICRO_QUOTE_MAX_AGE_MS } from "../config";
import { asFiniteNumber, spotPriceFromRelative } from "./microCTraderProtocol";
import { buildQuote } from "./quoteRepository";

export type MicroSpotBook = {
  symbolId: string;
  bid: number | null;
  ask: number | null;
  bidTimestampMs: number | null;
  askTimestampMs: number | null;
  lastEventAtMs: number | null;
};

export function createEmptySpotBook(symbolId: string): MicroSpotBook {
  return {
    symbolId,
    bid: null,
    ask: null,
    bidTimestampMs: null,
    askTimestampMs: null,
    lastEventAtMs: null
  };
}

/**
 * Apply a possibly partial spot event. Does not erase the other side.
 */
export function applySpotEvent(
  book: MicroSpotBook,
  payload: Record<string, unknown>,
  expectedSymbolId?: string
): MicroSpotBook {
  const symbolIdNum = asFiniteNumber(payload.symbolId);
  if (
    expectedSymbolId &&
    symbolIdNum != null &&
    String(symbolIdNum) !== String(expectedSymbolId)
  ) {
    return book;
  }
  const eventTs = asFiniteNumber(payload.timestamp) ?? Date.now();
  const bid = spotPriceFromRelative(payload.bid);
  const ask = spotPriceFromRelative(payload.ask);
  const next: MicroSpotBook = {
    ...book,
    lastEventAtMs: eventTs
  };
  if (bid != null && bid > 0) {
    next.bid = bid;
    next.bidTimestampMs = eventTs;
  }
  if (ask != null && ask > 0) {
    next.ask = ask;
    next.askTimestampMs = eventTs;
  }
  return next;
}

export type SpotBookPublish =
  | { ok: true; quote: MicroQuote; brokerTimestampMs: number }
  | { ok: false; error: "quote_missing" | "quote_invalid" | "quote_stale"; ageMs: number | null };

/**
 * Publish only when both sides exist, are valid, and each side is fresh.
 * Freshness is conservative: uses the older of bid/ask timestamps.
 */
export function publishQuoteFromBook(args: {
  book: MicroSpotBook;
  nowMs: number;
  maxSideAgeMs?: number;
}): SpotBookPublish {
  const maxAge = args.maxSideAgeMs ?? MICRO_QUOTE_MAX_AGE_MS;
  const { book, nowMs } = args;
  if (book.bid == null || book.ask == null) {
    return { ok: false, error: "quote_missing", ageMs: null };
  }
  if (!(book.bid > 0) || !(book.ask > 0) || !(book.ask >= book.bid)) {
    return { ok: false, error: "quote_invalid", ageMs: null };
  }
  const bidTs = book.bidTimestampMs ?? 0;
  const askTs = book.askTimestampMs ?? 0;
  const olderTs = Math.min(bidTs, askTs);
  const ageMs = nowMs - olderTs;
  if (!Number.isFinite(olderTs) || olderTs <= 0 || ageMs > maxAge) {
    return { ok: false, error: "quote_stale", ageMs: Number.isFinite(ageMs) ? ageMs : null };
  }
  const brokerTimestampMs = Math.max(bidTs, askTs);
  const quote = buildQuote({
    bid: book.bid,
    ask: book.ask,
    brokerTimestamp: new Date(brokerTimestampMs).toISOString(),
    nowMs,
    freshness: ageMs <= 5_000 ? "LIVE" : ageMs <= maxAge ? "DELAYED" : "STALE"
  });
  return { ok: true, quote, brokerTimestampMs };
}

/** Full two-sided payload validation (tests / rare complete events). */
export function validateSpotPayload(
  payload: Record<string, unknown>,
  expectedSymbolId?: string
):
  | {
      bid: number;
      ask: number;
      mid: number;
      spread: number;
      brokerTimestampMs: number;
      symbolId: string;
    }
  | { error: string } {
  const book = applySpotEvent(
    createEmptySpotBook(expectedSymbolId ?? ""),
    payload,
    expectedSymbolId
  );
  // Structural validation only — ignore wall-clock staleness for unit checks.
  if (book.bid == null || book.ask == null) {
    return { error: "quote_missing" };
  }
  if (!(book.bid > 0) || !(book.ask > 0) || !(book.ask >= book.bid)) {
    return { error: "quote_invalid" };
  }
  const brokerTimestampMs = Math.max(
    book.bidTimestampMs ?? 0,
    book.askTimestampMs ?? 0
  );
  const mid = (book.bid + book.ask) / 2;
  return {
    bid: book.bid,
    ask: book.ask,
    mid,
    spread: book.ask - book.bid,
    brokerTimestampMs,
    symbolId: book.symbolId || expectedSymbolId || ""
  };
}
