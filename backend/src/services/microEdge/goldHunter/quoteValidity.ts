import type { GhQuoteBook } from "./types";
import { GH_SIDE_FRESHNESS_MS } from "./config";

export function buildQuoteBook(args: {
  nowMs: number;
  brokerTimestampMs: number;
  bid: number | null;
  ask: number | null;
  bidUpdatedMs: number | null;
  askUpdatedMs: number | null;
  sideFreshnessMs?: number;
}): GhQuoteBook {
  const sideMax = args.sideFreshnessMs ?? GH_SIDE_FRESHNESS_MS;
  const bidAgeMs =
    args.bidUpdatedMs == null ? Number.POSITIVE_INFINITY : args.nowMs - args.bidUpdatedMs;
  const askAgeMs =
    args.askUpdatedMs == null ? Number.POSITIVE_INFINITY : args.nowMs - args.askUpdatedMs;
  const quoteAgeMs = args.nowMs - args.brokerTimestampMs;

  let invalidReason: string | null = null;
  if (args.bid == null || args.ask == null) invalidReason = "missing_side";
  else if (!Number.isFinite(args.bid) || !Number.isFinite(args.ask))
    invalidReason = "non_finite_price";
  else if (!(args.bid > 0) || !(args.ask > 0)) invalidReason = "price_non_positive";
  else if (args.ask < args.bid) invalidReason = "ask_lt_bid";
  else if (!Number.isFinite(args.brokerTimestampMs) || args.brokerTimestampMs <= 0)
    invalidReason = "invalid_timestamp";
  else if (bidAgeMs > sideMax) invalidReason = "bid_stale";
  else if (askAgeMs > sideMax) invalidReason = "ask_stale";

  const bid = args.bid ?? 0;
  const ask = args.ask ?? 0;
  const mid = invalidReason ? 0 : (bid + ask) / 2;
  const spread = invalidReason ? 0 : ask - bid;

  return {
    timestampMs: args.nowMs,
    brokerTimestampMs: args.brokerTimestampMs,
    bid,
    ask,
    mid,
    spread,
    bidAgeMs: Number.isFinite(bidAgeMs) ? bidAgeMs : -1,
    askAgeMs: Number.isFinite(askAgeMs) ? askAgeMs : -1,
    quoteAgeMs: Number.isFinite(quoteAgeMs) ? quoteAgeMs : -1,
    valid: invalidReason == null,
    invalidReason
  };
}
