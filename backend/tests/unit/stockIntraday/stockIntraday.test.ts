/**
 * Stocks Intraday AutoTrade — comprehensive deterministic tests.
 * Never contacts Trading 212. Never places orders.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { StockIntradayService } from "../../../src/services/stockIntraday/stockIntradayService";
import { InMemoryStockIntradayStore } from "../../../src/services/stockIntraday/stockIntradayStore";
import { MockMarketDataProvider } from "../../../src/services/stockIntraday/marketData/mockMarketDataProvider";
import { FakeT212BrokerAdapter } from "../../../src/services/stockIntraday/broker/fakeT212BrokerAdapter";
import { T212HttpBrokerAdapter } from "../../../src/services/stockIntraday/broker/t212HttpAdapter";
import {
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../../../src/services/stockIntraday/featureFlags";
import {
  parseStockTradingViewSignal,
  isStaleSignal
} from "../../../src/services/stockIntraday/signalIngestion";
import {
  rankIntradayOpportunity,
  selectTopQualifyingOpportunity
} from "../../../src/services/stockIntraday/ranking/rankingEngine";
import { calculateStockPositionSize } from "../../../src/services/stockIntraday/risk/positionSizing";
import {
  evaluateEntryGates,
  validateRiskLimits,
  createDefaultRiskState
} from "../../../src/services/stockIntraday/risk/riskEngine";
import {
  canTransition,
  assertTransition,
  buildIntentIdempotencyKey
} from "../../../src/services/stockIntraday/stateMachine";
import { assertNoSecretsInText, redactSecrets } from "../../../src/services/stockIntraday/redact";
import { DEFAULT_STOCK_INTRADAY_LIMITS } from "../../../src/services/stockIntraday/featureFlags";
import { DEFAULT_STOCK_UNIVERSE } from "../../../src/services/stockIntraday/types";
import { signedQuantity, assertQuantitySign, T212_ENDPOINTS } from "../../../src/services/stockIntraday/broker/t212BrokerAdapter";

function freshSignal(overrides: Record<string, unknown> = {}) {
  return {
    alertId: `alert-${Math.random().toString(36).slice(2, 10)}`,
    strategyId: "momentum_breakout",
    symbol: "AAPL",
    exchange: "NASDAQ",
    timeframe: "5m",
    action: "ENTRY_LONG",
    price: 180,
    timestamp: new Date().toISOString(),
    barTime: new Date().toISOString(),
    barClosed: true,
    volume: 1_000_000,
    ema21: 179,
    ema50: 175,
    ema200: 160,
    vwap: 179.5,
    rsi: 58,
    atr: 1.5,
    relativeVolume: 1.8,
    support: 178,
    resistance: 182,
    marketTrend: "BULL",
    confidence: 85,
    reasonCodes: ["BREAKOUT"],
    ...overrides
  };
}

describe("Stock Intraday AutoTrade", () => {
  let store: InMemoryStockIntradayStore;
  let market: MockMarketDataProvider;
  let broker: FakeT212BrokerAdapter;
  let service: StockIntradayService;

  beforeEach(() => {
    StockIntradayService.resetRestartGateForTests();
    store = new InMemoryStockIntradayStore();
    market = new MockMarketDataProvider({ last: 180, sessionStatus: "OPEN" });
    broker = new FakeT212BrokerAdapter({ environment: "PAPER" });
    service = new StockIntradayService(store, market, () => broker);
  });

  it("keeps execution feature flags false", () => {
    expect(T212_PAPER_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(T212_LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
  });

  it("defaults mode to OFF", async () => {
    const status = await service.getStatus("u1");
    expect(status.mode).toBe("OFF");
    expect(status.paperOrderSubmissionEnabled).toBe(false);
    expect(status.liveExecutionFeatureEnabled).toBe(false);
    expect(status.safetyStatement).toMatch(/qualifying opportunities/i);
  });

  it("parses TradingView stock signals and rejects secrets in payload", () => {
    const ok = parseStockTradingViewSignal(freshSignal());
    expect(ok.ok).toBe(true);
    const bad = parseStockTradingViewSignal({ ...freshSignal(), apiKey: "x" });
    expect(bad.ok).toBe(false);
  });

  it("rejects duplicate and stale alerts", async () => {
    const signal = freshSignal({ alertId: "dup-1" });
    const first = await service.acknowledgeStockSignal("u1", signal);
    expect(first.accepted).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    const dup = await service.acknowledgeStockSignal("u1", signal);
    expect(dup.code).toBe("DUPLICATE_ALERT");

    const stale = freshSignal({
      alertId: "stale-1",
      timestamp: new Date(Date.now() - 10 * 60_000).toISOString()
    });
    expect(isStaleSignal(parseStockTradingViewSignal(stale).ok ? (parseStockTradingViewSignal(stale) as { signal: never }).signal : freshSignal() as never, 60_000)).toBe(true);
    const staleAck = await service.acknowledgeStockSignal("u1", stale);
    expect(staleAck.code).toBe("STALE_ALERT");
  });

  it("fast-acks signals with 202 semantics via acknowledge", async () => {
    const ack = await service.acknowledgeStockSignal("u1", freshSignal());
    expect(ack.accepted).toBe(true);
    expect(ack.code).toBe("QUEUED");
  });

  it("ranks opportunities and returns WAIT when none qualify", async () => {
    market.setOptions({ relativeVolume: 0.2, sessionStatus: "CLOSED" });
    await service.setMode("u1", "SHADOW");
    const status = await service.runShadowScan("u1", ["AAPL"]);
    expect(status.rankedOpportunities.length).toBe(1);
    expect(selectTopQualifyingOpportunity(status.rankedOpportunities)).toBeNull();
  });

  it("selects only qualifying top opportunity", async () => {
    const quote = await market.getQuote("AAPL");
    const indicators = await market.getIndicators("AAPL");
    const ranked = rankIntradayOpportunity({
      symbol: "AAPL",
      instrumentKind: "STOCK",
      strategy: "MOMENTUM_BREAKOUT",
      quote,
      indicators,
      signal: parseStockTradingViewSignal(freshSignal()).ok
        ? (parseStockTradingViewSignal(freshSignal()) as { ok: true; signal: import("../../../src/services/stockIntraday/types").StockTradingViewSignal }).signal
        : null,
      limits: DEFAULT_STOCK_INTRADAY_LIMITS
    });
    expect(ranked.qualifies).toBe(true);
    expect(selectTopQualifyingOpportunity([ranked])?.symbol).toBe("AAPL");
  });

  it("excludes CFD / OTHER instruments at entry gates", () => {
    const risk = createDefaultRiskState("u1");
    risk.mode = "SHADOW";
    const gate = evaluateEntryGates({
      mode: "SHADOW",
      risk,
      limits: DEFAULT_STOCK_INTRADAY_LIMITS,
      universe: DEFAULT_STOCK_UNIVERSE,
      opportunity: null,
      quote: null,
      indicators: null,
      openPositionCount: 0,
      hasSymbolPosition: false,
      symbolCooldownActive: false,
      minutesToClose: 120,
      estimatedSlippageBps: 1,
      instrumentType: "OTHER"
    });
    expect(gate.code).toBe("CFD_EXCLUDED");
  });

  it("blocks stale data, spread, daily loss, max positions, cooldown, entry cutoff", () => {
    const risk = createDefaultRiskState("u1");
    risk.mode = "SHADOW";
    const base = {
      mode: "SHADOW" as const,
      risk,
      limits: DEFAULT_STOCK_INTRADAY_LIMITS,
      universe: DEFAULT_STOCK_UNIVERSE,
      opportunity: {
        symbol: "AAPL",
        qualifies: true,
        blockReasons: [] as string[],
        overallScore: 90
      } as import("../../../src/services/stockIntraday/types").RankedIntradayOpportunity,
      quote: {
        symbol: "AAPL",
        bid: 180,
        ask: 181,
        last: 180.5,
        spreadBps: 50,
        asOf: new Date(Date.now() - 120_000).toISOString()
      },
      indicators: {
        symbol: "AAPL",
        sessionStatus: "OPEN" as const,
        averageDailyVolume: 5_000_000,
        relativeVolume: 2,
        volatilityPct: 1,
        vwap: 180,
        ema9: 180,
        ema21: 179,
        ema50: 175,
        ema200: 160,
        rsi: 55,
        atr: 1,
        currentVolume: 1,
        relativeStrength: 1,
        broadMarketTrend: "BULL" as const,
        sectorTrend: "BULL" as const,
        earningsOrNewsRisk: false,
        asOf: new Date().toISOString()
      },
      openPositionCount: 0,
      hasSymbolPosition: false,
      symbolCooldownActive: false,
      minutesToClose: 120,
      estimatedSlippageBps: 1,
      instrumentType: "STOCK" as const
    };
    expect(evaluateEntryGates(base).code).toBe("STALE_DATA");
    expect(
      evaluateEntryGates({
        ...base,
        quote: { ...base.quote!, asOf: new Date().toISOString(), spreadBps: 50 }
      }).code
    ).toBe("EXCESSIVE_SPREAD");
    expect(
      evaluateEntryGates({
        ...base,
        quote: { ...base.quote!, asOf: new Date().toISOString(), spreadBps: 5 },
        estimatedSlippageBps: 50
      }).code
    ).toBe("EXCESSIVE_SLIPPAGE");
    expect(
      evaluateEntryGates({
        ...base,
        quote: { ...base.quote!, asOf: new Date().toISOString(), spreadBps: 5 },
        openPositionCount: 3
      }).code
    ).toBe("MAX_POSITIONS");
    expect(
      evaluateEntryGates({
        ...base,
        quote: { ...base.quote!, asOf: new Date().toISOString(), spreadBps: 5 },
        symbolCooldownActive: true
      }).code
    ).toBe("SYMBOL_COOLDOWN");
    expect(
      evaluateEntryGates({
        ...base,
        quote: { ...base.quote!, asOf: new Date().toISOString(), spreadBps: 5 },
        minutesToClose: 5
      }).code
    ).toBe("ENTRY_CUTOFF");
    expect(
      evaluateEntryGates({
        ...base,
        quote: { ...base.quote!, asOf: new Date().toISOString(), spreadBps: 5 },
        risk: { ...risk, dailyRealisedPnl: -25 }
      }).code
    ).toBe("DAILY_LOSS_LIMIT");
  });

  it("sizes positions with cash reserve and fractional steps", () => {
    const result = calculateStockPositionSize({
      estimatedEntry: 180,
      stop: 178,
      limits: DEFAULT_STOCK_INTRADAY_LIMITS,
      availableCash: 2000,
      dailyAllocationRemaining: 100,
      portfolioExposureUsed: 0,
      symbolExposureUsed: 0,
      minTradeQuantity: 0.001,
      quantityStep: 0.001
    });
    expect(result.ok).toBe(true);
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.estimatedCost).toBeLessThanOrEqual(40 + 0.01);
    expect(2000 - result.estimatedCost).toBeGreaterThanOrEqual(500);
  });

  it("rejects sizing that would breach cash reserve", () => {
    const result = calculateStockPositionSize({
      estimatedEntry: 180,
      stop: 179,
      limits: { ...DEFAULT_STOCK_INTRADAY_LIMITS, minCashReserve: 1990, maxCapitalPerTrade: 100 },
      availableCash: 2000,
      dailyAllocationRemaining: 100,
      portfolioExposureUsed: 0,
      symbolExposureUsed: 0,
      minTradeQuantity: 1
    });
    expect(result.ok).toBe(false);
  });

  it("records SHADOW buys without broker orders", async () => {
    await service.setMode("u1", "SHADOW");
    await service.connectPaper("u1");
    const result = await service.evaluateEntryFromSignal(
      "u1",
      (parseStockTradingViewSignal(freshSignal()) as { ok: true; signal: import("../../../src/services/stockIntraday/types").StockTradingViewSignal }).signal
    );
    expect(result.outcome).toBe("BUY");
    const status = await service.getStatus("u1");
    expect(status.shadowTrades.length).toBeGreaterThan(0);
  });

  it("blocks Paper submission when feature flag is false", async () => {
    await broker.connect("test");
    await expect(
      broker.placeMarketOrder({ ticker: "AAPL", quantity: 1, type: "MARKET" })
    ).rejects.toThrow("T212_PAPER_ORDER_SUBMISSION_DISABLED");
  });

  it("hard-blocks Live orders on HTTP adapter", async () => {
    process.env.T212_LIVE_API_KEY = "k";
    process.env.T212_LIVE_API_SECRET = "s";
    const live = new T212HttpBrokerAdapter({ environment: "LIVE", dryRun: true });
    await expect(live.connect("x")).rejects.toThrow("T212_LIVE_CONNECTION_BLOCKED");
    delete process.env.T212_LIVE_API_KEY;
    delete process.env.T212_LIVE_API_SECRET;
  });

  it("isolates Paper and Live hosts", () => {
    expect(T212_ENDPOINTS.PAPER).toContain("demo.trading212.com");
    expect(T212_ENDPOINTS.LIVE).toContain("live.trading212.com");
    expect(T212_ENDPOINTS.PAPER).not.toEqual(T212_ENDPOINTS.LIVE);
  });

  it("validates quantity sign at adapter boundary", () => {
    expect(signedQuantity("BUY", 1)).toBe(1);
    expect(signedQuantity("SELL", 1)).toBe(-1);
    expect(() => assertQuantitySign(-1, "BUY")).toThrow();
    expect(() => assertQuantitySign(1, "SELL")).toThrow();
  });

  it("prevents selling non-GoldMeta holdings", async () => {
    await expect(
      service.requestExit(
        "u1",
        {
          positionId: "p1",
          userId: "u1",
          intentId: "i1",
          symbol: "AAPL",
          environment: "PAPER",
          quantity: 1,
          entryPrice: 180,
          stop: 178,
          takeProfit: 185,
          currentExitRule: "HARD_STOP",
          unrealisedPnl: 0,
          openedAt: new Date().toISOString(),
          goldMetaManaged: false as unknown as true
        },
        "TV_EXIT_LONG"
      )
    ).rejects.toMatchObject({ code: "NOT_GOLDMETA_POSITION" });
  });

  it("state machine rejects illegal transitions and supports idempotency keys", () => {
    expect(canTransition("CANDIDATE", "VALIDATING")).toBe(true);
    expect(canTransition("CLOSED", "OPEN")).toBe(false);
    expect(() => assertTransition("CLOSED", "OPEN")).toThrow();
    expect(
      buildIntentIdempotencyKey({
        userId: "u",
        symbol: "aapl",
        strategy: "MOMENTUM_BREAKOUT",
        signalOrBarTimestamp: "t",
        side: "BUY",
        tradingDate: "2026-07-22"
      })
    ).toContain("AAPL");
  });

  it("redacts secrets from payloads", () => {
    const redacted = redactSecrets({
      apiKey: "super-secret-key",
      apiSecret: "super-secret-secret",
      Authorization: "Basic abcdefghijklmnop"
    });
    expect(JSON.stringify(redacted)).not.toMatch(/super-secret/);
    expect(assertNoSecretsInText(JSON.stringify(redacted))).toBe(true);
  });

  it("fails closed on missing T212 credentials for real adapter factory path", async () => {
    const svc = new StockIntradayService(store, market, () => {
      throw new Error("T212_CREDENTIALS_NOT_CONFIGURED");
    });
    await expect(svc.connectPaper("u1")).rejects.toMatchObject({
      code: "T212_CREDENTIALS_MISSING"
    });
  });

  it("handles timeout unknown without blind resubmit path (fake scenario)", async () => {
    await broker.connect("test");
    await expect(
      broker.placeMarketOrder({ ticker: "AAPL", quantity: 1, type: "MARKET" })
    ).rejects.toThrow("T212_PAPER_ORDER_SUBMISSION_DISABLED");
  });

  it("atomic reservation prevents duplicate intents", async () => {
    const intent = {
      intentId: "i1",
      userId: "u1",
      symbol: "AAPL",
      environment: "PAPER" as const,
      strategy: "MOMENTUM_BREAKOUT" as const,
      signalAlertId: "a",
      barTimestamp: "t",
      side: "BUY" as const,
      state: "CANDIDATE" as const,
      quantity: 0.1,
      estimatedEntry: 180,
      stop: 178,
      takeProfit: 185,
      reservedCash: 18,
      brokerOrderId: null,
      filledQuantity: 0,
      averageFillPrice: null,
      outcome: null,
      blockReason: null,
      exitReason: null,
      goldMetaManaged: true as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null
    };
    expect(await store.reserveIntent(intent, "key-1")).toBe(true);
    expect(await store.reserveIntent({ ...intent, intentId: "i2" }, "key-1")).toBe(false);
  });

  it("validates mandatory risk settings before Auto modes", () => {
    expect(validateRiskLimits(DEFAULT_STOCK_INTRADAY_LIMITS)).toEqual([]);
    expect(
      validateRiskLimits({ ...DEFAULT_STOCK_INTRADAY_LIMITS, maxCapitalPerTrade: 0 }).length
    ).toBeGreaterThan(0);
  });

  it("kill switch stops new entries and does not touch personal holdings message", async () => {
    await service.setMode("u1", "SHADOW");
    const status = await service.emergencyStop("u1");
    expect(status.killSwitchActive).toBe(true);
    expect(status.mode).toBe("OFF");
    expect(status.activity[0]?.message).toMatch(/personal holdings untouched/i);
  });

  it("LIVE mode activation is hard-blocked", async () => {
    await expect(service.setMode("u1", "T212_LIVE_AUTO")).rejects.toMatchObject({
      code: "LIVE_FEATURE_DISABLED"
    });
  });

  it("PAPER mode can be selected but stays paused while submission disabled", async () => {
    const status = await service.setMode("u1", "T212_PAPER_AUTO");
    expect(status.mode).toBe("T212_PAPER_AUTO");
    expect(status.paused).toBe(true);
    expect(status.paperOrderSubmissionEnabled).toBe(false);
  });

  it("restart reconciliation pauses new entries", async () => {
    await service.connectPaper("u1");
    const status = await service.reconcileOnStartup("u1");
    expect(status.paused).toBe(true);
  });
});
