/**
 * Alpaca Market Data provider (IEX feed) for GoldMeta Stock Intraday SHADOW pilot.
 * REST snapshots only — no permanent WebSocket in Cloud Functions.
 * Label: ALPACA IEX — SHADOW VALIDATION ONLY (not full US market coverage).
 */

import {
  ALPACA_IEX_DATA_LABEL,
  assertShadowFeedAllowed,
  type AlpacaMarketDataConfig
} from "./alpacaConfig";
import { AlpacaCircuitOpenError, AlpacaHttpClient, AlpacaHttpError } from "./alpacaHttpClient";
import {
  atr,
  ema,
  minutesToUsRegularClose,
  relativeVolume,
  rsi,
  trendFromEmas,
  usEquitySessionStatus,
  volatilityPct,
  vwap
} from "./indicators";
import type {
  CandleInterval,
  MarketDataCapabilities,
  MarketDataProvider,
  MarketDataProviderHealth,
  MarketIndicators,
  MarketQuote,
  OhlcvBar
} from "./marketDataProvider";
import { MarketDataUnavailableError } from "./marketDataProvider";

const TIMEFRAME: Record<CandleInterval, string> = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "1d": "1Day"
};

type LatestQuoteResponse = {
  quote?: {
    bp?: number;
    ap?: number;
    t?: string;
  };
  symbol?: string;
};

type LatestTradeResponse = {
  trade?: {
    p?: number;
    t?: string;
  };
};

type BarsResponse = {
  bars?: Array<{
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }>;
  next_page_token?: string | null;
};

type MultiLatestQuotes = {
  quotes?: Record<string, { bp?: number; ap?: number; t?: string }>;
};

export class AlpacaMarketDataProvider implements MarketDataProvider {
  readonly capabilities: MarketDataCapabilities;
  private readonly client: AlpacaHttpClient;
  private readonly quoteCache = new Map<string, { quote: MarketQuote; cachedAt: number }>();
  private readonly barCache = new Map<string, { bars: OhlcvBar[]; cachedAt: number }>();
  private readonly cacheTtlMs = 15_000;

  constructor(
    private readonly config: AlpacaMarketDataConfig,
    fetchImpl?: typeof fetch,
    nowFn?: () => number
  ) {
    assertShadowFeedAllowed(config.feed);
    this.client = new AlpacaHttpClient(config, fetchImpl, nowFn);
    this.capabilities = {
      providerId: "alpaca",
      supportsBidAsk: true,
      supportsOhlcv: true,
      supportedIntervals: ["1m", "5m", "15m", "1d"],
      supportsIndicators: true,
      supportsSessionStatus: true,
      isMock: false,
      feedId: config.feed,
      dataLabel: ALPACA_IEX_DATA_LABEL,
      notes: [
        ALPACA_IEX_DATA_LABEL,
        "IEX-only feed is for engineering and SHADOW validation — not full US market coverage.",
        "REST snapshots only (serverless-safe)."
      ]
    };
  }

  getFeedId(): string {
    return this.config.feed;
  }

  getDataLabel(): string {
    return ALPACA_IEX_DATA_LABEL;
  }

  getHttpClientForTests(): AlpacaHttpClient {
    return this.client;
  }

  async getHealth(): Promise<MarketDataProviderHealth> {
    const state = this.client.getState();
    return await Promise.resolve({
      healthy: !state.circuitOpenUntil || Date.now() >= state.circuitOpenUntil,
      feed: this.config.feed,
      dataLabel: ALPACA_IEX_DATA_LABEL,
      lastSuccessAt: state.lastSuccessAt,
      lastErrorAt: state.lastErrorAt,
      lastErrorCode: state.lastErrorCode,
      circuitOpen: Boolean(state.circuitOpenUntil && Date.now() < state.circuitOpenUntil),
      rateLimitedUntil: state.rateLimitedUntil
        ? new Date(state.rateLimitedUntil).toISOString()
        : null,
      requestCountWindow: state.requestCountWindow
    });
  }

  async validateCredentials(): Promise<boolean> {
    // Lightweight probe — latest SPY quote.
    await this.getQuote("SPY");
    return true;
  }

  async symbolAvailable(symbol: string): Promise<boolean> {
    try {
      const quote = await this.getQuote(symbol.toUpperCase());
      return Number.isFinite(quote.last) && quote.last > 0;
    } catch {
      return false;
    }
  }

  async getQuote(symbol: string): Promise<MarketQuote> {
    const key = symbol.toUpperCase();
    const cached = this.quoteCache.get(key);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.quote;
    }

    try {
      const [quoteRes, tradeRes] = await Promise.all([
        this.client.getJson<LatestQuoteResponse>(`/v2/stocks/${encodeURIComponent(key)}/quotes/latest`, {
          feed: this.config.feed
        }),
        this.client.getJson<LatestTradeResponse>(`/v2/stocks/${encodeURIComponent(key)}/trades/latest`, {
          feed: this.config.feed
        })
      ]);

      const bid = num(quoteRes.quote?.bp);
      const ask = num(quoteRes.quote?.ap);
      const last = num(tradeRes.trade?.p) ?? ((bid != null && ask != null ? (bid + ask) / 2 : null));
      if (last == null || last <= 0) {
        throw new MarketDataUnavailableError("ALPACA_QUOTE_MISSING");
      }
      const asOf = tradeRes.trade?.t ?? quoteRes.quote?.t ?? new Date().toISOString();
      let spreadBps: number | null = null;
      if (bid != null && ask != null && last > 0) {
        spreadBps = Number((((ask - bid) / last) * 10_000).toFixed(2));
      }
      const quote: MarketQuote = {
        symbol: key,
        bid,
        ask,
        last,
        spreadBps,
        asOf,
        feed: this.config.feed,
        providerId: "alpaca",
        dataLabel: ALPACA_IEX_DATA_LABEL
      };
      this.quoteCache.set(key, { quote, cachedAt: Date.now() });
      return quote;
    } catch (error) {
      throw mapAlpacaError(error);
    }
  }

  async getQuotesBatch(symbols: string[]): Promise<MarketQuote[]> {
    const capped = symbols.map((s) => s.toUpperCase()).slice(0, this.config.maxWatchlistSymbols);
    if (!capped.length) return [];
    try {
      const res = await this.client.getJson<MultiLatestQuotes>("/v2/stocks/quotes/latest", {
        symbols: capped.join(","),
        feed: this.config.feed
      });
      const out: MarketQuote[] = [];
      for (const symbol of capped) {
        const q = res.quotes?.[symbol];
        if (!q) continue;
        const bid = num(q.bp);
        const ask = num(q.ap);
        const last = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask;
        if (last == null || last <= 0) continue;
        let spreadBps: number | null = null;
        if (bid != null && ask != null && last > 0) {
          spreadBps = Number((((ask - bid) / last) * 10_000).toFixed(2));
        }
        out.push({
          symbol,
          bid,
          ask,
          last,
          spreadBps,
          asOf: q.t ?? new Date().toISOString(),
          feed: this.config.feed,
          providerId: "alpaca",
          dataLabel: ALPACA_IEX_DATA_LABEL
        });
      }
      return out;
    } catch (error) {
      throw mapAlpacaError(error);
    }
  }

  async getOhlcv(symbol: string, interval: CandleInterval, limit: number): Promise<OhlcvBar[]> {
    const key = `${symbol.toUpperCase()}:${interval}:${limit}`;
    const cached = this.barCache.get(key);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.bars;
    }
    try {
      const res = await this.client.getJson<BarsResponse>(
        `/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars`,
        {
          timeframe: TIMEFRAME[interval],
          limit: String(Math.min(1000, Math.max(1, limit))),
          feed: this.config.feed,
          adjustment: "raw",
          sort: "asc"
        }
      );
      const bars = (res.bars ?? []).map((b) => ({
        time: b.t,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v
      }));
      this.barCache.set(key, { bars, cachedAt: Date.now() });
      return bars;
    } catch (error) {
      throw mapAlpacaError(error);
    }
  }

  async getIndicators(symbol: string): Promise<MarketIndicators> {
    const [bars5m, bars1d] = await Promise.all([
      this.getOhlcv(symbol, "5m", 250),
      this.getOhlcv(symbol, "1d", 60)
    ]);
    if (!bars5m.length) {
      throw new MarketDataUnavailableError("ALPACA_BARS_MISSING");
    }
    const closes = bars5m.map((b) => b.close);
    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const currentVolume = bars5m[bars5m.length - 1]?.volume ?? null;
    const averageDailyVolume =
      bars1d.length > 0
        ? bars1d.reduce((s, b) => s + b.volume, 0) / bars1d.length
        : null;
    const now = new Date();
    return {
      symbol: symbol.toUpperCase(),
      vwap: vwap(bars5m.slice(-78)),
      ema9,
      ema21,
      ema50,
      ema200,
      rsi: rsi(closes, 14),
      atr: atr(bars5m, 14),
      relativeVolume:
        currentVolume != null && averageDailyVolume != null
          ? relativeVolume(currentVolume, averageDailyVolume)
          : null,
      averageDailyVolume,
      currentVolume,
      volatilityPct: volatilityPct(closes, 20),
      relativeStrength: null,
      broadMarketTrend: trendFromEmas(ema50, ema200),
      sectorTrend: "UNKNOWN",
      sessionStatus: usEquitySessionStatus(now),
      minutesToClose: minutesToUsRegularClose(now),
      earningsOrNewsRisk: null,
      asOf: bars5m[bars5m.length - 1]?.time ?? now.toISOString(),
      feed: this.config.feed,
      providerId: "alpaca",
      dataLabel: ALPACA_IEX_DATA_LABEL
    };
  }

  isFresh(asOf: string, maxAgeMs: number): boolean {
    const age = Date.now() - Date.parse(asOf);
    return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
  }
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapAlpacaError(error: unknown): Error {
  if (error instanceof MarketDataUnavailableError) return error;
  if (error instanceof AlpacaCircuitOpenError) {
    return new MarketDataUnavailableError("ALPACA_CIRCUIT_OPEN");
  }
  if (error instanceof AlpacaHttpError) {
    if (error.status === 429) return new MarketDataUnavailableError("ALPACA_RATE_LIMITED");
    if (error.status === 408) return new MarketDataUnavailableError("ALPACA_TIMEOUT");
    if (error.status === 401 || error.status === 403) {
      return new MarketDataUnavailableError("ALPACA_AUTH_FAILED");
    }
    return new MarketDataUnavailableError(`ALPACA_HTTP_${error.status}`);
  }
  return new MarketDataUnavailableError("ALPACA_UNAVAILABLE");
}
