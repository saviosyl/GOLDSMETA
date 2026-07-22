/**
 * Market data provider abstraction.
 * No real provider selected yet — Auto modes that need live data stay disabled
 * until a provider is wired. Tests use MockMarketDataProvider only.
 */

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
  broadMarketTrend: "BULL" | "BEAR" | "NEUTRAL" | "UNKNOWN";
  sectorTrend: "BULL" | "BEAR" | "NEUTRAL" | "UNKNOWN";
  sessionStatus: "OPEN" | "CLOSED" | "PRE" | "POST" | "UNKNOWN";
  earningsOrNewsRisk: boolean | null;
  asOf: string;
}

export interface MarketDataCapabilities {
  providerId: string;
  supportsBidAsk: boolean;
  supportsOhlcv: boolean;
  supportedIntervals: CandleInterval[];
  supportsIndicators: boolean;
  supportsSessionStatus: boolean;
  isMock: boolean;
  notes: string[];
}

export interface MarketDataProvider {
  readonly capabilities: MarketDataCapabilities;
  getQuote(symbol: string): Promise<MarketQuote>;
  getOhlcv(symbol: string, interval: CandleInterval, limit: number): Promise<OhlcvBar[]>;
  getIndicators(symbol: string): Promise<MarketIndicators>;
  isFresh(asOf: string, maxAgeMs: number): boolean;
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
}
