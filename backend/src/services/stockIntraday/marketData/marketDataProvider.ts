/**
 * Market data provider abstraction.
 * SHADOW pilot uses Alpaca IEX via AlpacaMarketDataProvider.
 * Tests use MockMarketDataProvider. Never silently invent quotes for real modes.
 */

/* eslint-disable @typescript-eslint/require-await -- fail-closed stubs */

export type CandleInterval = "1m" | "5m" | "15m" | "1d";

export interface OhlcvBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketQuote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number;
  spreadBps: number | null;
  asOf: string;
  feed?: string;
  providerId?: string;
  dataLabel?: string;
}

export interface MarketIndicators {
  symbol: string;
  vwap: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  atr: number | null;
  relativeVolume: number | null;
  averageDailyVolume: number | null;
  currentVolume: number | null;
  volatilityPct: number | null;
  relativeStrength: number | null;
  /** Trend of the candidate symbol itself (EMA50/200). */
  symbolTrend: "BULL" | "BEAR" | "NEUTRAL" | "UNKNOWN";
  /** Independent benchmark trend (SPY) — never copied from symbolTrend. */
  broadMarketTrend: "BULL" | "BEAR" | "NEUTRAL" | "UNKNOWN";
  /** Optional sector/tech benchmark (QQQ) when relevant. */
  sectorTrend: "BULL" | "BEAR" | "NEUTRAL" | "UNKNOWN";
  sessionStatus: "OPEN" | "CLOSED" | "PRE" | "POST" | "UNKNOWN";
  /** Minutes until regular-session close when known from exchange calendar/provider. */
  minutesToClose?: number | null;
  marketDate?: string | null;
  indicatorsAsOf?: string | null;
  indicatorsFresh?: boolean;
  earningsOrNewsRisk: boolean | null;
  asOf: string;
  feed?: string;
  providerId?: string;
  dataLabel?: string;
}

export interface MarketDataCapabilities {
  providerId: string;
  supportsBidAsk: boolean;
  supportsOhlcv: boolean;
  supportedIntervals: CandleInterval[];
  supportsIndicators: boolean;
  supportsSessionStatus: boolean;
  isMock: boolean;
  feedId?: string;
  dataLabel?: string;
  notes: string[];
}

export interface MarketDataProviderHealth {
  healthy: boolean;
  feed: string;
  dataLabel: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  circuitOpen: boolean;
  rateLimitedUntil: string | null;
  requestCountWindow: number;
}

export interface MarketDataProvider {
  readonly capabilities: MarketDataCapabilities;
  getQuote(symbol: string): Promise<MarketQuote>;
  getOhlcv(symbol: string, interval: CandleInterval, limit: number): Promise<OhlcvBar[]>;
  getIndicators(symbol: string): Promise<MarketIndicators>;
  isFresh(asOf: string, maxAgeMs: number): boolean;
  getHealth?(): Promise<MarketDataProviderHealth>;
  getFeedId?(): string;
  getDataLabel?(): string;
  symbolAvailable?(symbol: string): Promise<boolean>;
  validateCredentials?(): Promise<boolean>;
  getQuotesBatch?(symbols: string[]): Promise<MarketQuote[]>;
}

export class MarketDataUnavailableError extends Error {
  constructor(message = "MARKET_DATA_UNAVAILABLE") {
    super(message);
    this.name = "MarketDataUnavailableError";
  }
}

export class StaleMarketDataError extends Error {
  constructor(message = "STALE_MARKET_DATA") {
    super(message);
    this.name = "StaleMarketDataError";
  }
}

/** Real Auto modes must not silently invent quotes outside tests. */
export class UnconfiguredMarketDataProvider implements MarketDataProvider {
  readonly capabilities: MarketDataCapabilities = {
    providerId: "unconfigured",
    supportsBidAsk: false,
    supportsOhlcv: false,
    supportedIntervals: [],
    supportsIndicators: false,
    supportsSessionStatus: false,
    isMock: false,
    notes: [
      "No market-data provider selected yet.",
      "Real Auto modes remain disabled until a provider is configured."
    ]
  };

  async getQuote(): Promise<MarketQuote> {
    throw new MarketDataUnavailableError();
  }

  async getOhlcv(): Promise<OhlcvBar[]> {
    throw new MarketDataUnavailableError();
  }

  async getIndicators(): Promise<MarketIndicators> {
    throw new MarketDataUnavailableError();
  }

  isFresh(): boolean {
    return false;
  }

  async getHealth(): Promise<MarketDataProviderHealth> {
    return {
      healthy: false,
      feed: "none",
      dataLabel: "UNCONFIGURED",
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorCode: "UNCONFIGURED",
      circuitOpen: false,
      rateLimitedUntil: null,
      requestCountWindow: 0
    };
  }
}
