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
  etMinutesOfDay,
  filterRegularSessionBars,
  isIndicatorBarsFresh,
  relativeVolumeSameTimeOfDay,
  rsi,
  sessionVwap,
  trendFromEmas,
  volatilityPct
} from "./indicators";
import {
  AlpacaMarketSessionProvider,
  type MarketSessionProvider,
  type MarketSessionSnapshot
} from "./marketSessionProvider";
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

type SnapshotResponse = {
  symbol?: string;
  latestTrade?: { p?: number; t?: string };
  latestQuote?: { bp?: number; ap?: number; t?: string };
  minuteBar?: { t?: string; o?: number; h?: number; l?: number; c?: number; v?: number };
  dailyBar?: { t?: string; o?: number; h?: number; l?: number; c?: number; v?: number };
  prevDailyBar?: { t?: string; o?: number; h?: number; l?: number; c?: number; v?: number };
};

type MultiSnapshotResponse = {
  snapshots?: Record<string, SnapshotResponse>;
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

const TECH_SYMBOLS = new Set([
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "GOOGL",
  "GOOG",
  "TSLA",
  "AMD",
  "AVGO",
  "QQQ"
]);

export class AlpacaMarketDataProvider implements MarketDataProvider {
  readonly capabilities: MarketDataCapabilities;
  private readonly client: AlpacaHttpClient;
  private readonly sessionProvider: MarketSessionProvider;
  private readonly quoteCache = new Map<string, { quote: MarketQuote; cachedAt: number }>();
  private readonly barCache = new Map<string, { bars: OhlcvBar[]; cachedAt: number }>();
  private benchmarkCache: {
    at: number;
    spyTrend: MarketIndicators["broadMarketTrend"];
    qqqTrend: MarketIndicators["sectorTrend"];
  } | null = null;
  private readonly cacheTtlMs = 15_000;
  private readonly benchmarkTtlMs = 60_000;

  constructor(
    private readonly config: AlpacaMarketDataConfig,
    fetchImpl?: typeof fetch,
    nowFn?: () => number,
    sessionProvider?: MarketSessionProvider
  ) {
    assertShadowFeedAllowed(config.feed);
    this.client = new AlpacaHttpClient(config, fetchImpl, nowFn);
    this.sessionProvider =
      sessionProvider ?? new AlpacaMarketSessionProvider(this.client, nowFn);
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

  getSessionProvider(): MarketSessionProvider {
    return this.sessionProvider;
  }

  async getMarketSession(now?: Date): Promise<MarketSessionSnapshot> {
    return this.sessionProvider.getSession(now);
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
      const snap = await this.client.getJson<SnapshotResponse>(
        `/v2/stocks/${encodeURIComponent(key)}/snapshot`,
        { feed: this.config.feed }
      );
      const quote = this.quoteFromSnapshot(key, snap);
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
      const res = await this.client.getJson<MultiSnapshotResponse>("/v2/stocks/snapshots", {
        symbols: capped.join(","),
        feed: this.config.feed
      });
      const out: MarketQuote[] = [];
      for (const symbol of capped) {
        const snap = res.snapshots?.[symbol];
        if (!snap) continue;
        try {
          out.push(this.quoteFromSnapshot(symbol, snap));
        } catch {
          // skip missing
        }
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
      const bars = await this.fetchBarsPaginated(symbol.toUpperCase(), interval, limit);
      this.barCache.set(key, { bars, cachedAt: Date.now() });
      return bars;
    } catch (error) {
      throw mapAlpacaError(error);
    }
  }

  async getIndicators(symbol: string): Promise<MarketIndicators> {
    const upper = symbol.toUpperCase();
    const session = await this.sessionProvider.getSession();
    const [bars5m, bars1d] = await Promise.all([
      this.getOhlcv(upper, "5m", 2_000),
      this.getOhlcv(upper, "1d", 60)
    ]);
    if (!bars5m.length) {
      throw new MarketDataUnavailableError("ALPACA_BARS_MISSING");
    }

    const openMins = session.regularOpenAt
      ? etMinutesOfDay(session.regularOpenAt) ?? 9 * 60 + 30
      : 9 * 60 + 30;
    const closeMins = session.regularCloseAt
      ? etMinutesOfDay(session.regularCloseAt) ?? 16 * 60
      : 16 * 60;

    const sessionBars = session.marketDate
      ? filterRegularSessionBars(bars5m, {
          marketDate: session.marketDate,
          sessionOpenMinutes: openMins,
          sessionCloseMinutes: closeMins
        })
      : [];

    const closes = bars5m.map((b) => b.close);
    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const symbolTrend = trendFromEmas(ema50, ema200);

    const benchmarks = await this.loadBenchmarkTrends();
    const sectorTrend = TECH_SYMBOLS.has(upper) ? benchmarks.qqqTrend : "UNKNOWN";

    const nowMins =
      session.minutesToClose != null && session.regularCloseAt
        ? closeMins - session.minutesToClose
        : etMinutesOfDay(new Date().toISOString()) ?? openMins;

    const relativeVolume =
      session.marketDate && session.source !== "unavailable"
        ? relativeVolumeSameTimeOfDay({
            bars1mOr5m: bars5m,
            marketDate: session.marketDate,
            nowMinutesEt: nowMins,
            sessionOpenMinutes: openMins,
            sessionCloseMinutes: closeMins,
            lookbackSessions: 20
          })
        : null;

    const averageDailyVolume =
      bars1d.length > 0
        ? bars1d.reduce((s, b) => s + b.volume, 0) / bars1d.length
        : null;
    const currentVolume = sessionBars.reduce((s, b) => s + b.volume, 0) || null;

    const indicatorsAsOf = bars5m[bars5m.length - 1]?.time ?? new Date().toISOString();
    const indicatorsFresh = isIndicatorBarsFresh(bars5m, 5 * 60_000);

    let sessionStatus: MarketIndicators["sessionStatus"] = "UNKNOWN";
    if (session.source === "unavailable") sessionStatus = "UNKNOWN";
    else if (session.isOpen) sessionStatus = "OPEN";
    else if (!session.regularOpenAt) sessionStatus = "CLOSED";
    else {
      const now = Date.now();
      const open = Date.parse(session.regularOpenAt);
      const close = session.regularCloseAt ? Date.parse(session.regularCloseAt) : NaN;
      if (Number.isFinite(open) && now < open) sessionStatus = "PRE";
      else if (Number.isFinite(close) && now >= close) sessionStatus = "POST";
      else sessionStatus = "CLOSED";
    }

    return {
      symbol: upper,
      vwap:
        session.marketDate && sessionBars.length
          ? sessionVwap(bars5m, {
              marketDate: session.marketDate,
              sessionOpenMinutes: openMins,
              sessionCloseMinutes: closeMins
            })
          : null,
      ema9,
      ema21,
      ema50,
      ema200,
      rsi: rsi(closes, 14),
      atr: atr(bars5m, 14),
      relativeVolume,
      averageDailyVolume,
      currentVolume,
      volatilityPct: volatilityPct(closes, 20),
      relativeStrength: null,
      symbolTrend,
      broadMarketTrend: benchmarks.spyTrend,
      sectorTrend,
      sessionStatus,
      minutesToClose: session.minutesToClose,
      marketDate: session.marketDate,
      indicatorsAsOf,
      indicatorsFresh,
      earningsOrNewsRisk: null,
      asOf: indicatorsAsOf,
      feed: this.config.feed,
      providerId: "alpaca",
      dataLabel: ALPACA_IEX_DATA_LABEL
    };
  }

  isFresh(asOf: string, maxAgeMs: number): boolean {
    const age = Date.now() - Date.parse(asOf);
    return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
  }

  private quoteFromSnapshot(symbol: string, snap: SnapshotResponse): MarketQuote {
    const bid = num(snap.latestQuote?.bp);
    const ask = num(snap.latestQuote?.ap);
    const last =
      num(snap.latestTrade?.p) ??
      (bid != null && ask != null ? (bid + ask) / 2 : null);
    if (last == null || last <= 0) {
      throw new MarketDataUnavailableError("ALPACA_QUOTE_MISSING");
    }
    const asOf =
      snap.latestTrade?.t ?? snap.latestQuote?.t ?? new Date().toISOString();
    let spreadBps: number | null = null;
    if (bid != null && ask != null && last > 0) {
      spreadBps = Number((((ask - bid) / last) * 10_000).toFixed(2));
    }
    return {
      symbol,
      bid,
      ask,
      last,
      spreadBps,
      asOf,
      feed: this.config.feed,
      providerId: "alpaca",
      dataLabel: ALPACA_IEX_DATA_LABEL
    };
  }

  private async fetchBarsPaginated(
    symbol: string,
    interval: CandleInterval,
    limit: number
  ): Promise<OhlcvBar[]> {
    const want = Math.min(10_000, Math.max(1, limit));
    const bars: OhlcvBar[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    while (bars.length < want && pages < 10) {
      pages += 1;
      const res = await this.client.getJson<BarsResponse>(
        `/v2/stocks/${encodeURIComponent(symbol)}/bars`,
        {
          timeframe: TIMEFRAME[interval],
          limit: String(Math.min(10_000, want - bars.length)),
          feed: this.config.feed,
          adjustment: "raw",
          sort: "asc",
          page_token: pageToken
        }
      );
      for (const b of res.bars ?? []) {
        bars.push({
          time: b.t,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v
        });
      }
      if (!res.next_page_token) break;
      pageToken = res.next_page_token;
    }
    return bars.slice(-want);
  }

  private async loadBenchmarkTrends(): Promise<{
    spyTrend: MarketIndicators["broadMarketTrend"];
    qqqTrend: MarketIndicators["sectorTrend"];
  }> {
    if (this.benchmarkCache && Date.now() - this.benchmarkCache.at < this.benchmarkTtlMs) {
      return {
        spyTrend: this.benchmarkCache.spyTrend,
        qqqTrend: this.benchmarkCache.qqqTrend
      };
    }
    const [spyBars, qqqBars] = await Promise.all([
      this.getOhlcv("SPY", "5m", 250),
      this.getOhlcv("QQQ", "5m", 250)
    ]);
    const spyTrend = trendFromEmas(
      ema(
        spyBars.map((b) => b.close),
        50
      ),
      ema(
        spyBars.map((b) => b.close),
        200
      )
    );
    const qqqTrend = trendFromEmas(
      ema(
        qqqBars.map((b) => b.close),
        50
      ),
      ema(
        qqqBars.map((b) => b.close),
        200
      )
    );
    this.benchmarkCache = { at: Date.now(), spyTrend, qqqTrend };
    return { spyTrend, qqqTrend };
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
