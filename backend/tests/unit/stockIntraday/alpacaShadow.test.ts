/**
 * Alpaca Market Data provider — deterministic tests (no real network).
 */
import { describe, expect, it } from "vitest";
import {
  ALPACA_IEX_DATA_LABEL,
  assertShadowFeedAllowed,
  loadAlpacaMarketDataConfig
} from "../../../src/services/stockIntraday/marketData/alpacaConfig";
import { AlpacaHttpClient, AlpacaHttpError, AlpacaCircuitOpenError } from "../../../src/services/stockIntraday/marketData/alpacaHttpClient";
import { AlpacaMarketDataProvider } from "../../../src/services/stockIntraday/marketData/alpacaMarketDataProvider";
import { ema, rsi, atr, vwap, volatilityPct, minutesToUsRegularClose, usEquitySessionStatus } from "../../../src/services/stockIntraday/marketData/indicators";
import {
  calculatePriceDivergencePct,
  evaluateProviderDivergence
} from "../../../src/services/stockIntraday/crossProvider";
import {
  calculateShadowPerformance,
  type ShadowDecisionRecord
} from "../../../src/services/stockIntraday/shadowPerformance";
import {
  defaultShadowWatchlist,
  MAX_SHADOW_WATCHLIST,
  validateShadowWatchlist
} from "../../../src/services/stockIntraday/watchlist";
import { MockMarketDataProvider } from "../../../src/services/stockIntraday/marketData/mockMarketDataProvider";
import { FakeT212BrokerAdapter } from "../../../src/services/stockIntraday/broker/fakeT212BrokerAdapter";
import { DEFAULT_STOCK_UNIVERSE } from "../../../src/services/stockIntraday/types";
import { createStockIntradayMarketData } from "../../../src/services/stockIntraday/runtime";
import {
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../../../src/services/stockIntraday/featureFlags";
import { redactSecrets, assertNoSecretsInText } from "../../../src/services/stockIntraday/redact";
import type { AlpacaMarketDataConfig } from "../../../src/services/stockIntraday/marketData/alpacaConfig";

function testConfig(overrides: Partial<AlpacaMarketDataConfig> = {}): AlpacaMarketDataConfig {
  return {
    credentials: { apiKey: "PK_TEST_KEY", apiSecret: "SK_TEST_SECRET" },
    feed: "iex",
    baseUrl: "https://data.alpaca.markets",
    maxWatchlistSymbols: 10,
    requestTimeoutMs: 50,
    maxRetries: 1,
    circuitFailureThreshold: 3,
    circuitCooldownMs: 60_000,
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

describe("Alpaca config + IEX enforcement", () => {
  it("labels IEX as SHADOW validation only", () => {
    expect(ALPACA_IEX_DATA_LABEL).toContain("SHADOW VALIDATION ONLY");
    expect(ALPACA_IEX_DATA_LABEL).toContain("IEX");
  });

  it("rejects non-IEX feed for SHADOW pilot", () => {
    expect(() => assertShadowFeedAllowed("sip")).toThrow(/ALPACA_FEED_NOT_ALLOWED/);
    expect(() => assertShadowFeedAllowed("iex")).not.toThrow();
  });

  it("fails closed when credentials missing", () => {
    const prevKey = process.env.ALPACA_MARKET_DATA_API_KEY;
    const prevSecret = process.env.ALPACA_MARKET_DATA_API_SECRET;
    delete process.env.ALPACA_MARKET_DATA_API_KEY;
    delete process.env.ALPACA_MARKET_DATA_API_SECRET;
    expect(loadAlpacaMarketDataConfig()).toBeNull();
    process.env.ALPACA_MARKET_DATA_API_KEY = prevKey;
    process.env.ALPACA_MARKET_DATA_API_SECRET = prevSecret;
  });

  it("does not silently fall back to mock when Alpaca preferred without creds", () => {
    const prev = process.env.STOCK_INTRADAY_MARKET_DATA;
    const prevKey = process.env.ALPACA_MARKET_DATA_API_KEY;
    const prevSecret = process.env.ALPACA_MARKET_DATA_API_SECRET;
    process.env.STOCK_INTRADAY_MARKET_DATA = "alpaca";
    delete process.env.ALPACA_MARKET_DATA_API_KEY;
    delete process.env.ALPACA_MARKET_DATA_API_SECRET;
    expect(() => createStockIntradayMarketData()).toThrow(/ALPACA_CREDENTIALS_REQUIRED/);
    if (prev === undefined) delete process.env.STOCK_INTRADAY_MARKET_DATA;
    else process.env.STOCK_INTRADAY_MARKET_DATA = prev;
    if (prevKey === undefined) delete process.env.ALPACA_MARKET_DATA_API_KEY;
    else process.env.ALPACA_MARKET_DATA_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.ALPACA_MARKET_DATA_API_SECRET;
    else process.env.ALPACA_MARKET_DATA_API_SECRET = prevSecret;
  });
});

describe("Alpaca HTTP client", () => {
  it("sends auth headers and parses JSON", async () => {
    let seenAuth = false;
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenAuth = headers.get("APCA-API-KEY-ID") === "PK_TEST_KEY";
      expect(headers.get("APCA-API-SECRET-KEY")).toBe("SK_TEST_SECRET");
      expect(String(input)).toContain("data.alpaca.markets");
      return jsonResponse({ ok: true });
    };
    const client = new AlpacaHttpClient(testConfig(), fetchImpl as typeof fetch);
    const data = await client.getJson<{ ok: boolean }>("/v2/stocks/AAPL/quotes/latest");
    expect(data.ok).toBe(true);
    expect(seenAuth).toBe(true);
  });

  it("handles HTTP 429 with retry-after", async () => {
    const fetchImpl = async () => jsonResponse({ message: "rate" }, 429, { "retry-after": "2" });
    const client = new AlpacaHttpClient(testConfig({ maxRetries: 0 }), fetchImpl as typeof fetch);
    await expect(client.getJson("/v2/x")).rejects.toBeInstanceOf(AlpacaHttpError);
    try {
      await client.getJson("/v2/x");
    } catch (error) {
      expect((error as AlpacaHttpError).status).toBe(429);
      expect((error as AlpacaHttpError).retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("times out slow requests", async () => {
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
      return jsonResponse({});
    };
    const client = new AlpacaHttpClient(
      testConfig({ requestTimeoutMs: 20, maxRetries: 0 }),
      fetchImpl as typeof fetch
    );
    await expect(client.getJson("/v2/x")).rejects.toThrow();
  });

  it("opens circuit breaker after repeated failures", async () => {
    const fetchImpl = async () => jsonResponse({ error: true }, 500);
    const client = new AlpacaHttpClient(
      testConfig({ maxRetries: 0, circuitFailureThreshold: 2 }),
      fetchImpl as typeof fetch
    );
    await expect(client.getJson("/v2/a")).rejects.toThrow();
    await expect(client.getJson("/v2/b")).rejects.toThrow();
    await expect(client.getJson("/v2/c")).rejects.toBeInstanceOf(AlpacaCircuitOpenError);
  });
});

describe("AlpacaMarketDataProvider quotes/bars", () => {
  it("parses quote, bid/ask, spread, and enforces IEX label", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/snapshot")) {
        return jsonResponse({
          latestQuote: { bp: 179.9, ap: 180.1, t: "2026-07-22T14:00:00Z" },
          latestTrade: { p: 180, t: "2026-07-22T14:00:01Z" }
        });
      }
      return jsonResponse({}, 404);
    };
    const provider = new AlpacaMarketDataProvider(testConfig(), fetchImpl as typeof fetch);
    const quote = await provider.getQuote("aapl");
    expect(quote.last).toBe(180);
    expect(quote.bid).toBe(179.9);
    expect(quote.ask).toBe(180.1);
    expect(quote.spreadBps).toBeCloseTo(11.11, 1);
    expect(quote.feed).toBe("iex");
    expect(quote.dataLabel).toBe(ALPACA_IEX_DATA_LABEL);
    expect(provider.getFeedId()).toBe("iex");
  });

  it("rejects missing quote", async () => {
    const fetchImpl = async () => jsonResponse({ latestQuote: {}, latestTrade: {} });
    const provider = new AlpacaMarketDataProvider(testConfig(), fetchImpl as typeof fetch);
    await expect(provider.getQuote("AAPL")).rejects.toThrow(/ALPACA_QUOTE_MISSING|MARKET_DATA/);
  });

  it("rejects stale quotes via isFresh", async () => {
    const provider = new AlpacaMarketDataProvider(testConfig(), (async () =>
      jsonResponse({
        latestQuote: { bp: 1, ap: 2, t: "2020-01-01T00:00:00Z" },
        latestTrade: { p: 1.5, t: "2020-01-01T00:00:00Z" }
      })) as typeof fetch);
    // Direct freshness check
    expect(provider.isFresh(new Date(Date.now() - 120_000).toISOString(), 60_000)).toBe(false);
    expect(provider.isFresh(new Date().toISOString(), 60_000)).toBe(true);
  });

  it("parses bars", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        bars: [
          { t: "2026-07-22T13:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 1000 },
          { t: "2026-07-22T13:05:00Z", o: 1.5, h: 2.2, l: 1.4, c: 2, v: 1200 }
        ]
      });
    const provider = new AlpacaMarketDataProvider(testConfig(), fetchImpl as typeof fetch);
    const bars = await provider.getOhlcv("AAPL", "5m", 2);
    expect(bars).toHaveLength(2);
    expect(bars[1]?.close).toBe(2);
  });

  it("supports batch quote requests capped by max watchlist", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("symbols=");
      expect(url.split("symbols=")[1]?.split("&")[0]?.split(",").length).toBeLessThanOrEqual(10);
      return jsonResponse({
        snapshots: {
          AAPL: {
            latestQuote: { bp: 179, ap: 181, t: "2026-07-22T14:00:00Z" },
            latestTrade: { p: 180, t: "2026-07-22T14:00:00Z" }
          },
          MSFT: {
            latestQuote: { bp: 419, ap: 421, t: "2026-07-22T14:00:00Z" },
            latestTrade: { p: 420, t: "2026-07-22T14:00:00Z" }
          }
        }
      });
    };
    const provider = new AlpacaMarketDataProvider(testConfig(), fetchImpl as typeof fetch);
    const quotes = await provider.getQuotesBatch([
      "AAPL",
      "MSFT",
      "NVDA",
      "AMZN",
      "META",
      "GOOGL",
      "SPY",
      "QQQ",
      "TSLA",
      "AMD",
      "EXTRA"
    ]);
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((q) => q.dataLabel === ALPACA_IEX_DATA_LABEL)).toBe(true);
  });

  it("maps provider outage / auth failures", async () => {
    const fetchImpl = async () => jsonResponse({ message: "unauthorized" }, 401);
    const provider = new AlpacaMarketDataProvider(
      testConfig({ maxRetries: 0 }),
      fetchImpl as typeof fetch
    );
    await expect(provider.getQuote("AAPL")).rejects.toThrow(/ALPACA_AUTH_FAILED/);
  });
});

describe("Indicator calculations", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.2);
  const bars = closes.map((c, i) => ({
    time: new Date(Date.UTC(2026, 6, 1, 14, i)).toISOString(),
    open: c - 0.1,
    high: c + 0.3,
    low: c - 0.3,
    close: c,
    volume: 10_000 + i
  }));

  it("calculates EMA / RSI / ATR / VWAP / volatility", () => {
    expect(ema(closes, 9)).not.toBeNull();
    expect(ema(closes, 21)).not.toBeNull();
    expect(ema(closes, 50)).not.toBeNull();
    expect(rsi(closes, 14)).toBeGreaterThan(50);
    expect(atr(bars, 14)).toBeGreaterThan(0);
    expect(vwap(bars)).toBeGreaterThan(0);
    expect(volatilityPct(closes, 20)).toBeGreaterThan(0);
  });

  it("resolves US session status and minutes to close", () => {
    const open = new Date(Date.UTC(2026, 6, 22, 15, 0, 0)); // 11:00 ET
    expect(usEquitySessionStatus(open)).toBe("OPEN");
    expect(minutesToUsRegularClose(open)).toBeGreaterThan(0);
    const closed = new Date(Date.UTC(2026, 6, 23, 2, 0, 0)); // after 20:00 ET
    expect(usEquitySessionStatus(closed)).toBe("CLOSED");
  });
});

describe("Cross-provider divergence + watchlist", () => {
  it("calculates divergence and blocks over threshold", () => {
    expect(calculatePriceDivergencePct(100, 101)).toBeCloseTo(1, 2);
    const blocked = evaluateProviderDivergence({
      mode: "SHADOW",
      snapshot: {
        alpacaSymbol: "AAPL",
        alpacaLast: 100,
        alpacaAsOf: new Date().toISOString(),
        alpacaFeed: "iex",
        alpacaBid: 99.9,
        alpacaAsk: 100.1,
        t212Symbol: "AAPL",
        t212Last: 103,
        t212AsOf: new Date().toISOString(),
        t212Currency: "USD",
        t212Exchange: "NASDAQ",
        t212InstrumentStatus: "TRADABLE"
      },
      maxDivergencePct: 1.5
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("PROVIDER_PRICE_DIVERGENCE");
  });

  it("skips divergence validation in SHADOW when T212 price missing", () => {
    const result = evaluateProviderDivergence({
      mode: "SHADOW",
      snapshot: {
        alpacaSymbol: "AAPL",
        alpacaLast: 100,
        alpacaAsOf: new Date().toISOString(),
        alpacaFeed: "iex",
        alpacaBid: 99,
        alpacaAsk: 101,
        t212Symbol: "AAPL",
        t212Last: null,
        t212AsOf: null,
        t212Currency: "USD",
        t212Exchange: "NASDAQ",
        t212InstrumentStatus: "UNKNOWN"
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.divergenceValidated).toBe(false);
  });

  it("caps watchlist at 10 and dual-validates symbols", async () => {
    expect(defaultShadowWatchlist().length).toBeLessThanOrEqual(MAX_SHADOW_WATCHLIST);
    const marketData = new MockMarketDataProvider({ last: 180 });
    const broker = new FakeT212BrokerAdapter();
    await broker.connect("test");
    const validated = await validateShadowWatchlist({
      symbols: [...defaultShadowWatchlist(), "EXTRA1", "EXTRA2"],
      marketData,
      broker,
      universe: DEFAULT_STOCK_UNIVERSE
    });
    expect(validated.results.length).toBeLessThanOrEqual(10);
    expect(validated.accepted).toContain("AAPL");
  });
});

describe("Shadow performance metrics", () => {
  it("aggregates wins, losses, blocks, and drawdown", () => {
    const base = {
      id: "1",
      userId: "u",
      scanTimestamp: "2026-07-22T14:00:00Z",
      symbol: "AAPL",
      alpacaFeed: "iex",
      dataLabel: ALPACA_IEX_DATA_LABEL,
      quoteTimestamp: "2026-07-22T14:00:00Z",
      entryPrice: 100,
      bid: 99.9,
      ask: 100.1,
      spreadBps: 10,
      strategy: "MOMENTUM_BREAKOUT",
      indicators: {},
      overallScore: 80,
      confidence: 85,
      supportReasons: [],
      blockReasons: [],
      quantity: 1,
      stop: 98,
      takeProfit: 104,
      hypotheticalEntry: 100,
      highestFavourableMovement: null,
      maximumAdverseMovement: null,
      createdAt: "2026-07-22T14:00:00Z"
    } as const;

    const decisions: ShadowDecisionRecord[] = [
      {
        ...base,
        id: "b1",
        outcome: "BLOCKED",
        blockReasons: ["STALE_QUOTE"],
        hypotheticalEntry: null,
        hypotheticalExit: null,
        exitReason: null,
        grossPnl: null,
        estimatedSlippage: null,
        netPnl: null,
        holdingDurationMinutes: null
      },
      {
        ...base,
        id: "d1",
        outcome: "BUY",
        hypotheticalExit: 102,
        exitReason: "TAKE_PROFIT",
        grossPnl: 2,
        estimatedSlippage: -0.1,
        netPnl: 1.9,
        holdingDurationMinutes: 30
      },
      {
        ...base,
        id: "d2",
        outcome: "BUY",
        hypotheticalExit: 99,
        exitReason: "HARD_STOP",
        grossPnl: -1,
        estimatedSlippage: -0.1,
        netPnl: -1.1,
        holdingDurationMinutes: 12
      },
      {
        ...base,
        id: "d3",
        outcome: "BLOCKED",
        blockReasons: ["PROVIDER_PRICE_DIVERGENCE"],
        hypotheticalEntry: null,
        hypotheticalExit: null,
        exitReason: null,
        grossPnl: null,
        estimatedSlippage: null,
        netPnl: null,
        holdingDurationMinutes: null
      }
    ];
    const metrics = calculateShadowPerformance(decisions);
    expect(metrics.tradesOpened).toBe(2);
    expect(metrics.tradesClosed).toBe(2);
    expect(metrics.staleDataBlocks).toBe(1);
    expect(metrics.providerDivergenceBlocks).toBe(1);
    expect(metrics.takeProfitExits).toBe(1);
    expect(metrics.stopLossExits).toBe(1);
    expect(metrics.disclaimer).toContain("do not guarantee");
  });
});

describe("Secret redaction + execution flags", () => {
  it("redacts Alpaca-looking secrets", () => {
    const redacted = redactSecrets({
      ALPACA_MARKET_DATA_API_KEY: "PK_SECRET",
      ALPACA_MARKET_DATA_API_SECRET: "SK_SECRET",
      note: "ok"
    });
    expect(JSON.stringify(redacted)).not.toContain("PK_SECRET");
    expect(JSON.stringify(redacted)).not.toContain("SK_SECRET");
    assertNoSecretsInText(JSON.stringify(redacted));
  });

  it("keeps both execution flags false", () => {
    expect(T212_PAPER_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(T212_LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
  });
});
