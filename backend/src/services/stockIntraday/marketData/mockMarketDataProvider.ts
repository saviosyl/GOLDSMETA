/**
 * Deterministic mock market-data provider for automated tests only.
 * Never used as a silent fallback when a real Auto mode expects live data.
 */

/* eslint-disable @typescript-eslint/require-await -- sync mock fixtures */

import type {
  CandleInterval,
  MarketDataCapabilities,
  MarketDataProvider,
  MarketDataProviderHealth,
  MarketIndicators,
  MarketQuote,
  OhlcvBar
} from "./marketDataProvider";

export interface MockMarketDataOptions {
  last?: number;
  bid?: number;
  ask?: number;
  sessionStatus?: MarketIndicators["sessionStatus"];
  minutesToClose?: number | null;
  relativeVolume?: number;
  averageDailyVolume?: number;
  volatilityPct?: number;
  rsi?: number;
  atr?: number;
  vwap?: number;
  ema21?: number;
  ema50?: number;
  ema200?: number;
  broadMarketTrend?: MarketIndicators["broadMarketTrend"];
  stale?: boolean;
  outage?: boolean;
}

export class MockMarketDataProvider implements MarketDataProvider {
  readonly capabilities: MarketDataCapabilities = {
    providerId: "mock",
    supportsBidAsk: true,
    supportsOhlcv: true,
    supportedIntervals: ["1m", "5m", "15m", "1d"],
    supportsIndicators: true,
    supportsSessionStatus: true,
    isMock: true,
    feedId: "mock",
    dataLabel: "MOCK — TESTS ONLY",
    notes: ["Deterministic fixtures for automated tests only."]
  };

  private opts: {
    last: number;
    bid: number;
    ask: number;
    sessionStatus: MarketIndicators["sessionStatus"];
    minutesToClose: number | null;
    relativeVolume: number;
    averageDailyVolume: number;
    volatilityPct: number;
    rsi: number;
    atr: number;
    vwap: number;
    ema21: number | null;
    ema50: number | null;
    ema200: number | null;
    broadMarketTrend: MarketIndicators["broadMarketTrend"];
    stale: boolean;
    outage: boolean;
  };

  constructor(opts: MockMarketDataOptions = {}) {
    const last = opts.last ?? 180;
    this.opts = {
      last,
      bid: opts.bid ?? last - 0.05,
      ask: opts.ask ?? last + 0.05,
      sessionStatus: opts.sessionStatus ?? "OPEN",
      minutesToClose: opts.minutesToClose ?? 180,
      relativeVolume: opts.relativeVolume ?? 1.8,
      averageDailyVolume: opts.averageDailyVolume ?? 5_000_000,
      volatilityPct: opts.volatilityPct ?? 1.2,
      rsi: opts.rsi ?? 58,
      atr: opts.atr ?? 1.5,
      vwap: opts.vwap ?? last - 0.2,
      ema21: opts.ema21 ?? last - 0.3,
      ema50: opts.ema50 ?? last - 0.8,
      ema200: opts.ema200 ?? last - 2,
      broadMarketTrend: opts.broadMarketTrend ?? "BULL",
      stale: opts.stale ?? false,
      outage: opts.outage ?? false
    };
  }

  setOptions(patch: MockMarketDataOptions): void {
    Object.assign(this.opts, patch);
  }

  async getQuote(symbol: string): Promise<MarketQuote> {
    this.assertAvailable();
    const spread =
      this.opts.bid > 0
        ? Number((((this.opts.ask - this.opts.bid) / this.opts.last) * 10_000).toFixed(2))
        : null;
    return {
      symbol,
      bid: this.opts.bid,
      ask: this.opts.ask,
      last: this.opts.last,
      spreadBps: spread,
      asOf: this.asOf()
    };
  }

  async getOhlcv(symbol: string, interval: CandleInterval, limit: number): Promise<OhlcvBar[]> {
    this.assertAvailable();
    const bars: OhlcvBar[] = [];
    const now = Date.now();
    const stepMs =
      interval === "1m" ? 60_000 : interval === "5m" ? 300_000 : interval === "15m" ? 900_000 : 86_400_000;
    for (let i = limit - 1; i >= 0; i -= 1) {
      const base = this.opts.last - i * 0.1;
      bars.push({
        time: new Date(now - i * stepMs).toISOString(),
        open: base,
        high: base + 0.4,
        low: base - 0.4,
        close: base + 0.1,
        volume: 100_000 + i * 1000
      });
    }
    void symbol;
    return bars;
  }

  async getIndicators(symbol: string): Promise<MarketIndicators> {
    this.assertAvailable();
    return {
      symbol,
      vwap: this.opts.vwap,
      ema9: this.opts.last - 0.1,
      ema21: this.opts.ema21,
      ema50: this.opts.ema50,
      ema200: this.opts.ema200,
      rsi: this.opts.rsi,
      atr: this.opts.atr,
      relativeVolume: this.opts.relativeVolume,
      averageDailyVolume: this.opts.averageDailyVolume,
      currentVolume: this.opts.averageDailyVolume * this.opts.relativeVolume,
      volatilityPct: this.opts.volatilityPct,
      relativeStrength: 1.05,
      broadMarketTrend: this.opts.broadMarketTrend,
      sectorTrend: "BULL",
      sessionStatus: this.opts.sessionStatus,
      minutesToClose: this.opts.minutesToClose,
      earningsOrNewsRisk: false,
      asOf: this.asOf()
    };
  }

  isFresh(asOf: string, maxAgeMs: number): boolean {
    if (this.opts.stale) return false;
    const age = Date.now() - new Date(asOf).getTime();
    return Number.isFinite(age) && age <= maxAgeMs;
  }

  getFeedId(): string {
    return "mock";
  }

  getDataLabel(): string {
    return "MOCK — TESTS ONLY";
  }

  async getHealth(): Promise<MarketDataProviderHealth> {
    return {
      healthy: !this.opts.outage,
      feed: "mock",
      dataLabel: "MOCK — TESTS ONLY",
      lastSuccessAt: this.opts.outage ? null : new Date().toISOString(),
      lastErrorAt: this.opts.outage ? new Date().toISOString() : null,
      lastErrorCode: this.opts.outage ? "MARKET_DATA_OUTAGE" : null,
      circuitOpen: false,
      rateLimitedUntil: null,
      requestCountWindow: 0
    };
  }

  async symbolAvailable(symbol: string): Promise<boolean> {
    void symbol;
    if (this.opts.outage) return false;
    return true;
  }

  async validateCredentials(): Promise<boolean> {
    return !this.opts.outage;
  }

  async getQuotesBatch(symbols: string[]): Promise<MarketQuote[]> {
    return Promise.all(symbols.map((s) => this.getQuote(s)));
  }

  private asOf(): string {
    if (this.opts.stale) return new Date(Date.now() - 15 * 60_000).toISOString();
    return new Date().toISOString();
  }

  private assertAvailable(): void {
    if (this.opts.outage) {
      throw new Error("MARKET_DATA_OUTAGE");
    }
  }
}
