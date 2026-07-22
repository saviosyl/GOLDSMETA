/**
 * Alpaca Market Data configuration (server-side secrets only).
 * Feed is IEX for SHADOW validation — not full US market coverage.
 */

export const ALPACA_IEX_DATA_LABEL = "ALPACA IEX — SHADOW VALIDATION ONLY";

export const DEFAULT_ALPACA_SHADOW_WATCHLIST = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "GOOGL",
  "SPY",
  "QQQ"
] as const;

export type AlpacaFeed = "iex" | "sip";

export interface AlpacaMarketDataCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface AlpacaMarketDataConfig {
  credentials: AlpacaMarketDataCredentials;
  feed: AlpacaFeed;
  baseUrl: string;
  maxWatchlistSymbols: number;
  requestTimeoutMs: number;
  maxRetries: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
}

export function loadAlpacaMarketDataCredentialsFromServerEnv(): AlpacaMarketDataCredentials | null {
  const apiKey = process.env.ALPACA_MARKET_DATA_API_KEY?.trim();
  const apiSecret = process.env.ALPACA_MARKET_DATA_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export function loadAlpacaMarketDataConfig(): AlpacaMarketDataConfig | null {
  const credentials = loadAlpacaMarketDataCredentialsFromServerEnv();
  if (!credentials) return null;

  const feedRaw = (process.env.ALPACA_MARKET_DATA_FEED ?? "iex").trim().toLowerCase();
  const feed: AlpacaFeed = feedRaw === "sip" ? "sip" : "iex";
  const baseUrl = (
    process.env.ALPACA_MARKET_DATA_BASE_URL?.trim() || "https://data.alpaca.markets"
  ).replace(/\/$/, "");
  const maxWatchlistSymbols = Math.min(
    10,
    Math.max(1, Number(process.env.ALPACA_MAX_WATCHLIST_SYMBOLS ?? "10") || 10)
  );

  return {
    credentials,
    feed,
    baseUrl,
    maxWatchlistSymbols,
    requestTimeoutMs: 8_000,
    maxRetries: 2,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 60_000
  };
}

/** Enforce IEX for the SHADOW pilot — SIP requires explicit future approval. */
export function assertShadowFeedAllowed(feed: AlpacaFeed): void {
  if (feed !== "iex") {
    throw new Error("ALPACA_FEED_NOT_ALLOWED_FOR_SHADOW_PILOT");
  }
}
