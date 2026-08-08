/**
 * Display-only XAUUSD historical candles from Pepperstone cTrader trendbars.
 * Never imported by decision engine, AutoTrade, or order paths.
 */

import {
  assertBrokerUser,
  ensureFreshAccessToken
} from "./connectionService";
import { getConnection } from "./connectionStore";
import {
  createOpenApiClient,
  type CTraderOpenApiClient,
  type TrendbarCandle,
  type TrendbarPeriodKey
} from "./openApiClient";

const CACHE_TTL_MS = 45_000;

type CacheEntry = {
  expiresAt: number;
  bars: TrendbarCandle[];
  period: TrendbarPeriodKey;
  symbolId: string;
  environment: "DEMO" | "LIVE";
};

const cache = new Map<string, CacheEntry>();

function clientCreds(source = process.env) {
  return {
    clientId: (source.CTRADER_CLIENT_ID ?? "").trim(),
    clientSecret: (source.CTRADER_CLIENT_SECRET ?? "").trim()
  };
}

export function normalizeCandleTimeframe(raw: unknown): TrendbarPeriodKey | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/^TF_/, "");
  if (s === "5" || s === "M5" || s === "5M") return "M5";
  if (s === "15" || s === "M15" || s === "15M") return "M15";
  if (s === "60" || s === "H1" || s === "1H") return "H1";
  if (s === "240" || s === "H4" || s === "4H") return "H4";
  return null;
}

export async function getXauusdCandles(args: {
  ownerUid: string;
  timeframe: TrendbarPeriodKey;
  count?: number;
  api?: CTraderOpenApiClient;
  nowMs?: number;
}): Promise<{
  symbol: "XAUUSD";
  timeframe: TrendbarPeriodKey;
  bars: TrendbarCandle[];
  source: "CTRADER_TRENDBARS";
  environment: "DEMO" | "LIVE";
  cached: boolean;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
}> {
  assertBrokerUser(args.ownerUid);
  const connection = await getConnection(args.ownerUid);
  if (!connection?.selectedAccountId || !connection.symbolId) {
    throw Object.assign(new Error("CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"), {
      code: "CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"
    });
  }

  const count = Math.min(Math.max(args.count ?? 200, 20), 500);
  const cacheKey = `${args.ownerUid}:${args.timeframe}:${count}:${connection.symbolId}`;
  const nowMs = args.nowMs ?? Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > nowMs && hit.bars.length > 0) {
    return {
      symbol: "XAUUSD",
      timeframe: args.timeframe,
      bars: hit.bars,
      source: "CTRADER_TRENDBARS",
      environment: hit.environment,
      cached: true,
      marketStatus: "UNKNOWN"
    };
  }

  const { accessToken, connection: freshConn } =
    await ensureFreshAccessToken(connection);
  const { clientId, clientSecret } = clientCreds();
  const isLive = Boolean(freshConn.selectedAccountIsLive);
  const api = args.api ?? createOpenApiClient();
  const bars = await api.fetchTrendbars({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: freshConn.selectedAccountId!,
    symbolId: freshConn.symbolId!,
    period: args.timeframe,
    count,
    isLive
  });

  if (!bars.length) {
    throw Object.assign(new Error("CTRADER_CANDLES_UNAVAILABLE"), {
      code: "CTRADER_CANDLES_UNAVAILABLE"
    });
  }

  const environment: "DEMO" | "LIVE" = isLive ? "LIVE" : "DEMO";
  cache.set(cacheKey, {
    expiresAt: nowMs + CACHE_TTL_MS,
    bars,
    period: args.timeframe,
    symbolId: freshConn.symbolId!,
    environment
  });

  return {
    symbol: "XAUUSD",
    timeframe: args.timeframe,
    bars,
    source: "CTRADER_TRENDBARS",
    environment,
    cached: false,
    marketStatus: "UNKNOWN"
  };
}

/** Test helper — clear process-local candle cache. */
export function clearCandleCacheForTests(): void {
  cache.clear();
}
