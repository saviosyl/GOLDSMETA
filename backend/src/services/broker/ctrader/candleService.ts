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

const CACHE_TTL_MS = 90_000;
/** Function timeout is 120s — leave headroom for auth + one retry. */
const FETCH_TIMEOUT_MS = 40_000;
const FETCH_ATTEMPTS = 2;

export type CandleErrorCode =
  | "CANDLE_AUTH_REQUIRED"
  | "CANDLE_ACCOUNT_NOT_FOUND"
  | "CANDLE_SYMBOL_NOT_FOUND"
  | "CANDLE_CTRADER_TIMEOUT"
  | "CANDLE_EMPTY_RESPONSE"
  | "CANDLE_UPSTREAM_ERROR"
  | "CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"
  | "CTRADER_CANDLES_UNAVAILABLE";

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

function candleError(code: CandleErrorCode, cause?: unknown): Error {
  return Object.assign(new Error(code), { code, cause });
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

export function classifyCandleFailure(err: unknown): CandleErrorCode {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: string }).code)
      : err instanceof Error
        ? err.message
        : "";
  if (/UNAUTHENTICATED|AUTH_REQUIRED|INVALID_TOKEN/i.test(code)) {
    return "CANDLE_AUTH_REQUIRED";
  }
  if (/ACCOUNT_OR_SYMBOL|ACCOUNT_NOT|NOT_SELECTED/i.test(code)) {
    return "CANDLE_ACCOUNT_NOT_FOUND";
  }
  if (/SYMBOL/i.test(code)) return "CANDLE_SYMBOL_NOT_FOUND";
  if (/TIMEOUT|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(code)) {
    return "CANDLE_CTRADER_TIMEOUT";
  }
  if (/EMPTY|UNAVAILABLE/i.test(code)) return "CANDLE_EMPTY_RESPONSE";
  if (/^CANDLE_/.test(code)) return code as CandleErrorCode;
  return "CANDLE_UPSTREAM_ERROR";
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(candleError("CANDLE_CTRADER_TIMEOUT")),
          ms
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getXauusdCandles(args: {
  ownerUid: string;
  timeframe: TrendbarPeriodKey;
  count?: number;
  api?: CTraderOpenApiClient;
  nowMs?: number;
  /**
   * `shared` → process cache key XAUUSD:{tf}:{count} for multi-user market feed.
   * `user` (default) → per-UID broker cache (personal diagnostics only).
   */
  cacheScope?: "shared" | "user";
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
  if (!connection?.selectedAccountId) {
    throw candleError("CANDLE_ACCOUNT_NOT_FOUND");
  }
  if (!connection.symbolId) {
    throw candleError("CANDLE_SYMBOL_NOT_FOUND");
  }

  const count = Math.min(Math.max(args.count ?? 120, 20), 300);
  const cacheScope = args.cacheScope ?? "user";
  const cacheKey =
    cacheScope === "shared"
      ? `XAUUSD:${args.timeframe}:${count}`
      : `${args.ownerUid}:${args.timeframe}:${count}:${connection.symbolId}`;
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

  try {
    const { accessToken, connection: freshConn } =
      await ensureFreshAccessToken(connection);
    const { clientId, clientSecret } = clientCreds();
    if (!clientId || !clientSecret) {
      throw candleError("CANDLE_UPSTREAM_ERROR");
    }
    const isLive = Boolean(freshConn.selectedAccountIsLive);
    const api = args.api ?? createOpenApiClient();

    let bars: TrendbarCandle[] = [];
    let lastErr: unknown;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      try {
        bars = await withTimeout(
          api.fetchTrendbars({
            accessToken,
            clientId,
            clientSecret,
            ctidTraderAccountId: freshConn.selectedAccountId!,
            symbolId: freshConn.symbolId!,
            period: args.timeframe,
            count,
            isLive
          }),
          FETCH_TIMEOUT_MS
        );
        if (bars.length) break;
        lastErr = candleError("CANDLE_EMPTY_RESPONSE");
      } catch (err) {
        lastErr = err;
        // Retry once on flaky cTrader WS hangs; do not retry auth/account misses.
        const code = classifyCandleFailure(err);
        if (
          attempt >= FETCH_ATTEMPTS ||
          (code !== "CANDLE_CTRADER_TIMEOUT" &&
            code !== "CANDLE_EMPTY_RESPONSE" &&
            code !== "CANDLE_UPSTREAM_ERROR")
        ) {
          throw err;
        }
      }
    }

    if (!bars.length) {
      // Prefer stale cache over empty when market is closed / upstream blank.
      if (hit?.bars?.length) {
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
      throw candleError(
        classifyCandleFailure(lastErr ?? candleError("CANDLE_EMPTY_RESPONSE")),
        lastErr
      );
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
  } catch (err) {
    if (hit?.bars?.length) {
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
    throw candleError(classifyCandleFailure(err), err);
  }
}

/** Test helper — clear process-local candle cache. */
export function clearCandleCacheForTests(): void {
  cache.clear();
}
