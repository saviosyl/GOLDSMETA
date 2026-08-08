/**
 * Shared XAUUSD market intelligence for all approved GoldMeta users.
 *
 * Uses the pinned market-data connection server-side only.
 * Never returns owner UID, cTrader account IDs, tokens, or balances.
 * Never feeds AutoTrade / order / decision engines.
 */

import {
  classifyCandleFailure,
  getXauusdCandles,
  normalizeCandleTimeframe,
  type CandleErrorCode
} from "../broker/ctrader/candleService";
import type { TrendbarCandle, TrendbarPeriodKey } from "../broker/ctrader/openApiClient";
import { getLiveQuoteSnapshot } from "../broker/ctrader/quoteService";
import { resolveSharedFeedUserId } from "./sharedFeed";

export type SharedMarketErrorCode =
  | CandleErrorCode
  | "MARKET_FEED_UNAVAILABLE"
  | "MARKET_QUOTE_UNAVAILABLE"
  | "INVALID_TIMEFRAME";

export function resolvePinnedMarketOwnerUid(
  source: NodeJS.ProcessEnv = process.env
): string {
  return (
    source.CTRADER_QUOTE_OWNER_UID?.trim() ||
    source.GOLDMETA_PINNED_OWNER_UID?.trim() ||
    resolveSharedFeedUserId()
  );
}

function marketError(code: SharedMarketErrorCode, cause?: unknown): Error {
  return Object.assign(new Error(code), { code, cause });
}

export function classifySharedMarketFailure(err: unknown): SharedMarketErrorCode {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: string }).code)
      : err instanceof Error
        ? err.message
        : "";
  if (/MARKET_FEED_UNAVAILABLE|PINNED|SHARED_FEED/i.test(code)) {
    return "MARKET_FEED_UNAVAILABLE";
  }
  if (/QUOTE_UNAVAILABLE|UNAVAILABLE/i.test(code) && /QUOTE|PRICE/i.test(code)) {
    return "MARKET_QUOTE_UNAVAILABLE";
  }
  return classifyCandleFailure(err);
}

/** Safe public candle payload — no broker account metadata. */
export async function getSharedXauusdCandles(args: {
  timeframe: TrendbarPeriodKey;
  count?: number;
  nowMs?: number;
}): Promise<{
  symbol: "XAUUSD";
  timeframe: TrendbarPeriodKey;
  bars: TrendbarCandle[];
  source: "SHARED_CTRADER_TRENDBARS";
  cached: boolean;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  updatedAt: string;
  planIndependent: true;
}> {
  const feedUid = resolvePinnedMarketOwnerUid();
  if (!feedUid || feedUid === "shared-market-feed") {
    // Fail closed outside tests when no real pinned owner is configured.
    if (process.env.APP_ENV !== "test" && process.env.NODE_ENV !== "test") {
      throw marketError("MARKET_FEED_UNAVAILABLE");
    }
  }

  try {
    const payload = await getXauusdCandles({
      ownerUid: feedUid,
      timeframe: args.timeframe,
      count: args.count,
      nowMs: args.nowMs,
      cacheScope: "shared"
    });
    const updatedAt =
      payload.bars.length > 0
        ? new Date(payload.bars[payload.bars.length - 1]!.time * 1000).toISOString()
        : new Date(args.nowMs ?? Date.now()).toISOString();
    return {
      symbol: "XAUUSD",
      timeframe: payload.timeframe,
      bars: payload.bars,
      source: "SHARED_CTRADER_TRENDBARS",
      cached: payload.cached,
      marketStatus: payload.marketStatus,
      updatedAt,
      planIndependent: true
    };
  } catch (err) {
    throw marketError(classifySharedMarketFailure(err), err);
  }
}

/** Safe public quote payload — feed health, not viewer broker connection. */
export async function getSharedXauusdQuote(args?: {
  refreshIfNeeded?: boolean;
  nowMs?: number;
}): Promise<{
  available: boolean;
  symbol: "XAUUSD";
  quote: null | {
    symbolName: string;
    bid: number;
    ask: number;
    mid: number;
    spread: number;
    brokerTimestamp: string;
    receivedAt: string;
    freshness: string;
    marketStatus: string;
    ageMs: number;
  };
  mid: number | null;
  freshness: string;
  livePriceHealth: string;
  marketStatus: string;
  label: string;
  source: "SHARED_MARKET_QUOTE";
  updatedAt: string | null;
  planIndependent: true;
}> {
  const feedUid = resolvePinnedMarketOwnerUid();
  if (!feedUid || feedUid === "shared-market-feed") {
    if (process.env.APP_ENV !== "test" && process.env.NODE_ENV !== "test") {
      throw marketError("MARKET_FEED_UNAVAILABLE");
    }
  }

  try {
    // Prefer worker-fed store; allow one pinned refresh when empty/stale.
    const snap = await getLiveQuoteSnapshot({
      ownerUid: feedUid,
      refreshIfNeeded: args?.refreshIfNeeded !== false,
      nowMs: args?.nowMs
    });
    if (!snap.quote) {
      return {
        available: false,
        symbol: "XAUUSD",
        quote: null,
        mid: null,
        freshness: "UNAVAILABLE",
        livePriceHealth: "UNAVAILABLE",
        marketStatus: "UNKNOWN",
        label: "Shared XAUUSD market quote",
        source: "SHARED_MARKET_QUOTE",
        updatedAt: null,
        planIndependent: true
      };
    }
    const q = snap.quote;
    return {
      available: true,
      symbol: "XAUUSD",
      quote: {
        symbolName: q.symbolName || "XAUUSD",
        bid: q.bid,
        ask: q.ask,
        mid: q.mid,
        spread: q.spread,
        brokerTimestamp: q.brokerTimestamp,
        receivedAt: q.receivedAt,
        freshness: q.freshness,
        marketStatus: q.marketStatus,
        ageMs: q.ageMs
      },
      mid: q.mid,
      freshness: q.freshness,
      livePriceHealth: snap.livePriceHealth,
      marketStatus: q.marketStatus,
      label: "Shared XAUUSD market quote",
      source: "SHARED_MARKET_QUOTE",
      updatedAt: q.receivedAt ?? q.brokerTimestamp,
      planIndependent: true
    };
  } catch (err) {
    throw marketError(
      /QUOTE|PRICE|UNAVAILABLE/i.test(String((err as { code?: string })?.code ?? err))
        ? "MARKET_QUOTE_UNAVAILABLE"
        : classifySharedMarketFailure(err),
      err
    );
  }
}

export { normalizeCandleTimeframe };
