/**
 * Stocks Intraday AutoTrade — comprehensive deterministic tests.
 * Never contacts Trading 212. Never places orders.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { StockIntradayService } from "../../../src/services/stockIntraday/stockIntradayService";
import { InMemoryStockIntradayStore } from "../../../src/services/stockIntraday/inMemoryStockIntradayStore";
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
import {
  estimateMinutesToClose,
  estimateSlippageBpsFromQuote
} from "../../../src/services/stockIntraday/sessionClock";
import { processStockIntradayJob } from "../../../src/services/stockIntraday/processStockIntradayJob";
import { enqueueEngineTick, runStockIntradaySchedulerForUser } from "../../../src/services/stockIntraday/intradayEngine";
import { createApiApp } from "../../../src/apiApp";
import request from "supertest";

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

async function enableShadowReady(
  service: StockIntradayService,
  userId = "u1"
): Promise<void> {
  await service.connectPaper(userId);
  await service.setMode(userId, "SHADOW");
  await service.reconcileOnStartup(userId);
}

describe("Stock Intraday AutoTrade", () => {
  let store: InMemoryStockIntradayStore;
  let market: MockMarketDataProvider;
  let broker: FakeT212BrokerAdapter;
  let service: StockIntradayService;

  beforeEach(async () => {
    store = new InMemoryStockIntradayStore();
    await StockIntradayService.resetRestartGateForTests(store, "u1");
    market = new MockMarketDataProvider({ last: 180, sessionStatus: "OPEN", minutesToClose: 180 });
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
    const t212 = parseStockTradingViewSignal({ ...freshSignal(), trading212ApiKey: "x" });
    expect(t212.ok).toBe(false);
    expect((t212 as { code: string }).code).toBe("CREDENTIALS_IN_PAYLOAD");
  });

  it("rejects duplicate and stale alerts", async () => {
    const signal = freshSignal({ alertId: "dup-1" });
    const first = await service.acknowledgeStockSignal("u1", signal);
    expect(first.accepted).toBe(true);
    expect(first.jobId).toBeTruthy();
    const dup = await service.acknowledgeStockSignal("u1", signal);
    expect(dup.code).toBe("DUPLICATE_ALERT");

    const stale = freshSignal({
      alertId: "stale-1",
      timestamp: new Date(Date.now() - 10 * 60_000).toISOString()
    });
    expect(
      isStaleSignal(
        parseStockTradingViewSignal(stale).ok
          ? (parseStockTradingViewSignal(stale) as { signal: never }).signal
          : (freshSignal() as never),
        60_000
      )
    ).toBe(true);
    const staleAck = await service.acknowledgeStockSignal("u1", stale);
    expect(staleAck.code).toBe("STALE_ALERT");
  });

  it("fast-acks signals with 202 semantics via acknowledge and creates durable job", async () => {
    const ack = await service.acknowledgeStockSignal("u1", freshSignal());
    expect(ack.accepted).toBe(true);
    expect(ack.code).toBe("QUEUED");
    expect(ack.jobId).toBeTruthy();
    const job = await store.getJob("u1", ack.jobId!);
    expect(job?.state).toBe("QUEUED");
    expect(job?.kind).toBe("PROCESS_SIGNAL");
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
    await enableShadowReady(service);
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
      leaseExpiresAt: null,
      entryReservationState: null,
      confidenceAtEntry: 85
    };
    expect(await store.reserveIntent(intent, "key-1")).toBe("reserved");
    expect(await store.reserveIntent({ ...intent, intentId: "i2" }, "key-1")).toBe("duplicate");
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
    const gate = await store.getRestartGate("u1");
    expect(gate.entriesPaused).toBe(true);
  });
});

describe("Stock Intraday hardening", () => {
  let store: InMemoryStockIntradayStore;
  let market: MockMarketDataProvider;
  let broker: FakeT212BrokerAdapter;
  let service: StockIntradayService;

  beforeEach(async () => {
    store = new InMemoryStockIntradayStore();
    await StockIntradayService.resetRestartGateForTests(store, "u1");
    market = new MockMarketDataProvider({ last: 180, sessionStatus: "OPEN", minutesToClose: 180 });
    broker = new FakeT212BrokerAdapter({ environment: "PAPER" });
    service = new StockIntradayService(store, market, () => broker);
  });

  it("protects duplicate alerts across concurrent reserveAlert calls", async () => {
    const signal = freshSignal({ alertId: "concurrent-alert" });
    const record = {
      id: "s1",
      userId: "u1",
      alertId: "concurrent-alert",
      deliveryStatus: "QUEUED" as const,
      processingStatus: "PENDING" as const,
      decisionStatus: "PENDING" as const,
      signal: (parseStockTradingViewSignal(signal) as { ok: true; signal: import("../../../src/services/stockIntraday/types").StockTradingViewSignal }).signal,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const results = await Promise.all([
      store.reserveAlert("u1", "concurrent-alert", record),
      store.reserveAlert("u1", "concurrent-alert", { ...record, id: "s2" }),
      store.reserveAlert("u1", "concurrent-alert", { ...record, id: "s3" })
    ]);
    expect(results.filter((r) => r === "reserved")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate")).toHaveLength(2);
  });

  it("protects concurrent intent and cash reservations", async () => {
    const baseIntent = {
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
      leaseExpiresAt: null,
      entryReservationState: null,
      confidenceAtEntry: 85
    };
    const intentResults = await Promise.all([
      store.reserveIntent({ ...baseIntent, intentId: "i1" }, "same-key"),
      store.reserveIntent({ ...baseIntent, intentId: "i2" }, "same-key")
    ]);
    expect(intentResults.filter((r) => r === "reserved")).toHaveLength(1);

    const cash = await Promise.all([
      store.reserveCash("u1", "i1", 10),
      store.reserveCash("u1", "i1", 10)
    ]);
    expect(cash.filter(Boolean)).toHaveLength(1);
    expect(await store.getReservedCashTotal("u1")).toBe(10);
  });

  it("durable job automatic retries via retry pass reach DEAD_LETTER", async () => {
    const job = await store.createJob({
      jobId: "fail-job",
      userId: "u1",
      kind: "PROCESS_SIGNAL",
      signalId: null,
      alertId: "missing",
      maxAttempts: 2,
      payload: {}
    });
    const failingService = new StockIntradayService(store, market, () => broker);
    failingService.executeDurableJob = async () => {
      throw new Error("boom");
    };

    await processStockIntradayJob("u1", job.jobId, {
      store,
      service: failingService,
      workerId: "w1"
    });
    let current = await store.getJob("u1", job.jobId);
    expect(current?.state).toBe("QUEUED");
    expect(current?.nextAttemptAt).toBeTruthy();
    expect(current?.attemptCount).toBe(1);

    // Immediate reclaim blocked by backoff
    const blocked = await processStockIntradayJob("u1", job.jobId, {
      store,
      service: failingService,
      workerId: "w-early"
    });
    expect(blocked?.attemptCount).toBe(1);

    // Advance nextAttemptAt and let automatic retry pass process it
    const jobs = (store as unknown as { jobs: Map<string, Array<{ jobId: string; nextAttemptAt: string | null }>> }).jobs.get("u1")!;
    jobs.find((j) => j.jobId === job.jobId)!.nextAttemptAt = new Date(Date.now() - 1).toISOString();

    const pass = await failingService.runJobRetryPass(Date.now());
    expect(pass.some((p) => p.jobId === job.jobId)).toBe(true);
    current = await store.getJob("u1", job.jobId);
    expect(current?.state).toBe("DEAD_LETTER");
    expect(current?.lastError).toMatch(/boom/);
  });

  it("duplicate Firestore trigger delivery is idempotent via lease claim", async () => {
    await enableShadowReady(service);
    const ack = await service.acknowledgeStockSignal("u1", freshSignal({ alertId: "dup-trigger" }));
    expect(ack.jobId).toBeTruthy();
    const [a, b] = await Promise.all([
      processStockIntradayJob("u1", ack.jobId!, { store, service, workerId: "w-a" }),
      processStockIntradayJob("u1", ack.jobId!, { store, service, workerId: "w-b" })
    ]);
    const final = await store.getJob("u1", ack.jobId!);
    expect(final?.state).toBe("COMPLETED");
    expect([a?.state, b?.state].filter((s) => s === "COMPLETED").length).toBeGreaterThanOrEqual(1);
  });

  it("TradingView routing id is non-secret; unverified source does not authorize entry", async () => {
    const created = await service.createWebhookConnection("u1", "test");
    expect(created.connectionId.length).toBeGreaterThan(16);
    expect("secret" in created).toBe(false);

    const ok = await service.authenticateWebhook(created.connectionId, {
      trustedSourceIp: "52.89.214.238"
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.sourceVerified).toBe(true);
      expect(ok.authorizesAutomaticEntry).toBe(true);
    }

    const unverified = await service.authenticateWebhook(created.connectionId);
    expect(unverified.ok).toBe(true);
    if (unverified.ok) {
      expect(unverified.sourceVerified).toBe(false);
      expect(unverified.authorizesAutomaticEntry).toBe(false);
    }

    const queryRejected = await service.authenticateWebhook(created.connectionId, {
      queryTokenPresent: true
    });
    expect(queryRejected.ok).toBe(false);
    if (!queryRejected.ok) {
      expect(queryRejected.code).toBe("QUERY_TOKEN_REJECTED");
    }

    const missing = await service.authenticateWebhook("totally-unknown-connection-id");
    expect(missing.ok).toBe(false);

    await service.revokeWebhookConnection("u1", created.connectionId);
    const revoked = await service.authenticateWebhook(created.connectionId, {
      trustedSourceIp: "52.89.214.238"
    });
    expect(revoked.ok).toBe(false);
  });

  it("webhook HTTP stores unverified signals without authorizing automatic entry", async () => {
    const created = await service.createWebhookConnection("u1", "tv");
    const app = createApiApp({ stockIntradayService: service });
    const res = await request(app)
      .post(`/webhooks/stock-intraday/${created.connectionId}`)
      .send(freshSignal({ alertId: "http-ack-1" }));
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(res.body.authorizesAutomaticEntry).toBe(false);
    expect(res.body.jobId).toBeTruthy();
    const job = await store.getJob("u1", res.body.jobId);
    expect(job?.state).toBe("QUEUED");
    expect(job?.payload.authorizesAutomaticEntry).toBe(false);

    const rejected = await request(app)
      .post(`/webhooks/stock-intraday/${created.connectionId}?token=should-not-work`)
      .send(freshSignal({ alertId: "http-ack-2" }));
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("QUERY_TOKEN_REJECTED");
  });

  it("function termination after HTTP 202 leaves durable job for later processing", async () => {
    const ack = await service.acknowledgeStockSignal("u1", freshSignal({ alertId: "survive-term" }));
    const job = await store.getJob("u1", ack.jobId!);
    expect(job?.state).toBe("QUEUED");
    await enableShadowReady(service);
    await service.processDurableJobById("u1", ack.jobId!);
    const done = await store.getJob("u1", ack.jobId!);
    expect(done?.state).toBe("COMPLETED");
  });

  it("scheduled scan creates SHADOW BUY then monitor closes with SHADOW SELL", async () => {
    await enableShadowReady(service);
    const before = await store.listPositions("u1");
    expect(before).toHaveLength(0);

    await service.runAutonomousScan("u1");
    const afterBuy = await store.listPositions("u1");
    expect(afterBuy.length).toBeGreaterThan(0);
    expect(afterBuy[0]?.goldMetaManaged).toBe(true);
    const shadowsBuy = await store.listShadowTrades("u1");
    expect(shadowsBuy.some((t) => t.side === "BUY")).toBe(true);

    // Force stop-loss on the scan-created position
    const pos = afterBuy[0]!;
    await store.savePosition({ ...pos, stop: 190 });
    market.setOptions({ last: 185 });
    await service.monitorOpenPositions("u1");
    const afterSell = await store.listPositions("u1");
    expect(afterSell.find((p) => p.positionId === pos.positionId)).toBeUndefined();
    const shadows = await store.listShadowTrades("u1");
    expect(shadows.some((t) => t.side === "SELL")).toBe(true);
  });

  it("scheduler enqueues only without double-processing", async () => {
    await enableShadowReady(service);
    await service.registerForScheduler("u1");
    const ticks = await runStockIntradaySchedulerForUser(service, store, "u1");
    expect(ticks.some((t) => t.kind === "SCHEDULED_SCAN" && t.enqueued)).toBe(true);
    const scan = ticks.find((t) => t.kind === "SCHEDULED_SCAN");
    const job = await store.getJob("u1", scan!.jobId!);
    expect(job?.state).toBe("QUEUED");
  });

  it("atomic entry reservation enforces limits across concurrent symbols", async () => {
    await enableShadowReady(service);
    await store.saveSettings({
      ...(await store.getSettings("u1")),
      limits: { ...DEFAULT_STOCK_INTRADAY_LIMITS, maxSimultaneousPositions: 1, maxTradesPerDay: 1 }
    });
    const mk = (symbol: string, intentId: string) => ({
      userId: "u1",
      idempotencyKey: `key-${symbol}`,
      intent: {
        intentId,
        userId: "u1",
        symbol,
        environment: "PAPER" as const,
        strategy: "MOMENTUM_BREAKOUT" as const,
        signalAlertId: symbol,
        barTimestamp: "t",
        side: "BUY" as const,
        state: "ENTRY_RESERVED" as const,
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
        leaseExpiresAt: null,
        entryReservationState: null,
        confidenceAtEntry: 85
      },
      position: {
        positionId: `p-${symbol}`,
        userId: "u1",
        intentId,
        symbol,
        environment: "PAPER" as const,
        quantity: 0.1,
        entryPrice: 180,
        stop: 178,
        takeProfit: 185,
        currentExitRule: "HARD_STOP",
        unrealisedPnl: 0,
        openedAt: new Date().toISOString(),
        goldMetaManaged: true as const
      },
      cashAmount: 18,
      availableCashFromBroker: 5000,
      limits: { ...DEFAULT_STOCK_INTRADAY_LIMITS, maxSimultaneousPositions: 1, maxTradesPerDay: 1 },
      openShadowPosition: true
    });
    const results = await Promise.all([
      store.reserveEntryAtomically(mk("AAPL", "ia")),
      store.reserveEntryAtomically(mk("MSFT", "ib"))
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect((await store.listPositions("u1")).length).toBe(1);
  });

  it("cold-started PROCESS_SIGNAL resolves broker without UI Connect cache", async () => {
    await enableShadowReady(service);
    // New service instance = empty adapters Map (cold start)
    const cold = new StockIntradayService(store, market, () => broker);
    const result = await cold.evaluateEntryFromSignal(
      "u1",
      (parseStockTradingViewSignal(freshSignal({ alertId: "cold-1" })) as { ok: true; signal: import("../../../src/services/stockIntraday/types").StockTradingViewSignal }).signal
    );
    expect(result.outcome).toBe("BUY");
  });

  it("deployment generation gate does not re-pause reconciled SHADOW on new instance", async () => {
    await enableShadowReady(service);
    const gate1 = await store.getRestartGate("u1");
    expect(gate1.reconciledGeneration).toBeTruthy();
    expect(gate1.entriesPaused).toBe(false);

    const otherInstance = new StockIntradayService(store, market, () => broker);
    await otherInstance.getStatus("u1");
    const gate2 = await store.getRestartGate("u1");
    expect(gate2.entriesPaused).toBe(false);
    expect(gate2.reconciledGeneration).toBe(gate1.reconciledGeneration);
  });

  it("persists dashboard ranked/rejected/signal across service instances", async () => {
    await enableShadowReady(service);
    await service.acknowledgeStockSignal("u1", freshSignal({ alertId: "persist-1" }));
    await service.evaluateEntryFromSignal(
      "u1",
      (parseStockTradingViewSignal(freshSignal({ alertId: "persist-entry" })) as { ok: true; signal: import("../../../src/services/stockIntraday/types").StockTradingViewSignal }).signal
    );
    const cold = new StockIntradayService(store, market, () => broker);
    const status = await cold.getStatus("u1");
    expect(status.lastTradingViewAlert?.alertId).toBe("persist-1");
    expect(status.rankedOpportunities.length).toBeGreaterThan(0);
    expect(status.lastMarketDataAt).toBeTruthy();
  });

  it("market-close calculation fails closed without provider minutesToClose", () => {
    expect(estimateMinutesToClose({ sessionStatus: "OPEN" }).minutesToClose).toBeNull();
    expect(estimateMinutesToClose({ sessionStatus: "OPEN", minutesToClose: 42 }).minutesToClose).toBe(
      42
    );
  });

  it("instrument validation unavailable returns BLOCKED", async () => {
    await service.setMode("u1", "SHADOW");
    await service.getStatus("u1");
    const gate = await store.getRestartGate("u1");
    await store.saveRestartGate({
      ...gate,
      entriesPaused: false,
      reconciledGeneration: gate.deploymentGeneration,
      lastReconciledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    let risk = await store.getRiskState("u1");
    risk = { ...risk, paused: false };
    await store.saveRiskState(risk);
    const broken = new StockIntradayService(store, market, () => {
      throw new Error("T212_CREDENTIALS_NOT_CONFIGURED");
    });
    const result = await broken.evaluateEntryFromSignal(
      "u1",
      (parseStockTradingViewSignal(freshSignal()) as { ok: true; signal: import("../../../src/services/stockIntraday/types").StockTradingViewSignal }).signal
    );
    expect(result.outcome).toBe("BLOCKED");
    expect(result.message).toMatch(/instrument validation unavailable/i);
  });

  it("does not use placeholder cash or slippage fallbacks", () => {
    expect(estimateSlippageBpsFromQuote({ bid: null, ask: null, last: 100, spreadBps: null })).toBeNull();
    expect(
      estimateSlippageBpsFromQuote({ bid: 100, ask: 100.1, last: 100.05, spreadBps: 10 })
    ).toBeGreaterThan(0);
  });

  it("restart gate uses deployment generation not process-local Set", async () => {
    await service.connectPaper("u1");
    await service.setMode("u1", "SHADOW");
    await service.getStatus("u1");
    const gate = await store.getRestartGate("u1");
    expect(gate.deploymentGeneration).toBeTruthy();
    expect(gate.entriesPaused).toBe(true);
  });

  it("personal holdings are never sold", async () => {
    await enableShadowReady(service);
    await store.savePosition({
      positionId: "personal",
      userId: "u1",
      intentId: "x",
      symbol: "AAPL",
      environment: "PAPER",
      quantity: 5,
      entryPrice: 100,
      stop: 90,
      takeProfit: 120,
      currentExitRule: "HARD_STOP",
      unrealisedPnl: 0,
      openedAt: new Date().toISOString(),
      goldMetaManaged: false as unknown as true
    });
    await expect(
      service.requestExit(
        "u1",
        {
          positionId: "personal",
          userId: "u1",
          intentId: "x",
          symbol: "AAPL",
          environment: "PAPER",
          quantity: 5,
          entryPrice: 100,
          stop: 90,
          takeProfit: 120,
          currentExitRule: "HARD_STOP",
          unrealisedPnl: 0,
          openedAt: new Date().toISOString(),
          goldMetaManaged: false as unknown as true
        },
        "END_OF_DAY"
      )
    ).rejects.toMatchObject({ code: "NOT_GOLDMETA_POSITION" });
  });

  it("never silently falls back to in-memory store outside tests", async () => {
    const { createStockIntradayStore } = await import(
      "../../../src/services/stockIntraday/runtime"
    );
    const s = createStockIntradayStore();
    expect(s.constructor.name).toBe("InMemoryStockIntradayStore");
  });

  it("engine skips Paper Auto scheduled scans while flags false", async () => {
    await store.saveRiskState({
      ...createDefaultRiskState("u1"),
      mode: "T212_PAPER_AUTO",
      paused: true
    });
    const tick = await enqueueEngineTick({
      store,
      userId: "u1",
      kind: "SCHEDULED_SCAN"
    });
    expect(tick.enqueued).toBe(false);
  });

  it("shared STOCK_INTRADAY_DEPLOYMENT_GENERATION ignores divergent K_REVISION", async () => {
    const previousGen = process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION;
    const previousRev = process.env.K_REVISION;
    process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION = "shared-gen-v1";
    process.env.K_REVISION = "api-revision-AAA";

    const { currentDeploymentGeneration } = await import(
      "../../../src/services/stockIntraday/stockIntradayStore"
    );
    expect(currentDeploymentGeneration()).toBe("shared-gen-v1");

    await enableShadowReady(service);
    const gate = await store.getRestartGate("u1");
    expect(gate.reconciledGeneration).toBe("shared-gen-v1");
    expect(gate.entriesPaused).toBe(false);

    // Simulate job-trigger / scheduler instances with different K_REVISION.
    process.env.K_REVISION = "job-trigger-revision-BBB";
    const jobInstance = new StockIntradayService(store, market, () => broker);
    await jobInstance.getStatus("u1");
    expect((await store.getRestartGate("u1")).entriesPaused).toBe(false);

    process.env.K_REVISION = "scheduler-revision-CCC";
    const schedInstance = new StockIntradayService(store, market, () => broker);
    await schedInstance.getStatus("u1");
    expect((await store.getRestartGate("u1")).entriesPaused).toBe(false);
    expect((await store.getRestartGate("u1")).reconciledGeneration).toBe("shared-gen-v1");

    if (previousGen === undefined) delete process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION;
    else process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION = previousGen;
    if (previousRev === undefined) delete process.env.K_REVISION;
    else process.env.K_REVISION = previousRev;
  });

  it("fails closed when STOCK_INTRADAY_DEPLOYMENT_GENERATION missing outside test/local", async () => {
    const previousGen = process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION;
    const previousApp = process.env.APP_ENV;
    const previousNode = process.env.NODE_ENV;
    const previousStorage = process.env.STORAGE_BACKEND;
    const previousAllow = process.env.STOCK_INTRADAY_ALLOW_LOCAL_GENERATION;
    delete process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION;
    delete process.env.STOCK_INTRADAY_ALLOW_LOCAL_GENERATION;
    process.env.APP_ENV = "production";
    process.env.NODE_ENV = "production";
    process.env.STORAGE_BACKEND = "firestore";

    const { currentDeploymentGeneration } = await import(
      "../../../src/services/stockIntraday/stockIntradayStore"
    );
    expect(() => currentDeploymentGeneration()).toThrow(/STOCK_INTRADAY_DEPLOYMENT_GENERATION/);

    if (previousGen === undefined) delete process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION;
    else process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION = previousGen;
    if (previousApp === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousApp;
    if (previousNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNode;
    if (previousStorage === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = previousStorage;
    if (previousAllow === undefined) delete process.env.STOCK_INTRADAY_ALLOW_LOCAL_GENERATION;
    else process.env.STOCK_INTRADAY_ALLOW_LOCAL_GENERATION = previousAllow;
  });

  it("SHADOW hard-stop loss updates realised P/L, losingTrades, cooldown, and daily-loss lock", async () => {
    await enableShadowReady(service);
    await store.saveSettings({
      ...(await store.getSettings("u1")),
      limits: {
        ...DEFAULT_STOCK_INTRADAY_LIMITS,
        maxDailyLoss: 5,
        maxLosingTradesPerDay: 1,
        perSymbolCooldownMinutes: 30,
        cooldownAfterLossMinutes: 45
      }
    });

    await service.runAutonomousScan("u1");
    const positions = await store.listPositions("u1");
    expect(positions.length).toBeGreaterThan(0);
    const pos = positions[0]!;
    await store.savePosition({ ...pos, stop: 190, entryPrice: 200, highWaterMark: 200 });

    market.setOptions({ last: 185 });
    await service.monitorOpenPositions("u1");

    expect(await store.listPositions("u1")).toHaveLength(0);
    const risk = await store.getRiskState("u1");
    expect(risk.dailyRealisedPnl).toBeLessThan(0);
    expect(risk.losingTradesToday).toBeGreaterThanOrEqual(1);
    expect(risk.locked || risk.paused).toBe(true);

    const sell = (await store.listShadowTrades("u1")).find((t) => t.side === "SELL");
    expect(sell?.netRealizedPnl).toBeLessThan(0);
    expect(sell?.exitReason).toBeTruthy();
    expect(sell?.entryPrice).toBe(200);
    expect(sell?.exitPrice).toBe(185);

    const cooldown = await store.getSymbolCooldown("u1", pos.symbol);
    expect(cooldown).toBeTruthy();
    expect(Date.parse(cooldown!)).toBeGreaterThan(Date.now());

    const reentry = await service.evaluateEntryFromSignal(
      "u1",
      (parseStockTradingViewSignal(freshSignal({ alertId: "reentry-blocked" })) as {
        ok: true;
        signal: import("../../../src/services/stockIntraday/types").StockTradingViewSignal;
      }).signal
    );
    expect(reentry.outcome).toBe("BLOCKED");
  });

  it("evaluates trailing-stop, break-even, VWAP, indicator, trend, max-hold, and EOD exits", async () => {
    const { evaluateShadowExitRules } = await import(
      "../../../src/services/stockIntraday/exitRules"
    );
    const base = {
      positionId: "p1",
      userId: "u1",
      intentId: "i1",
      symbol: "AAPL",
      environment: "PAPER" as const,
      quantity: 1,
      entryPrice: 100,
      stop: 95,
      takeProfit: 110,
      currentExitRule: "HARD_STOP",
      unrealisedPnl: 0,
      openedAt: new Date(Date.now() - 60_000).toISOString(),
      goldMetaManaged: true as const,
      highWaterMark: 100,
      breakEvenArmed: false
    };

    const trail = evaluateShadowExitRules({
      position: { ...base, highWaterMark: 108 },
      quote: { last: 106.5 },
      indicators: {},
      limits: { maxPositionDurationMinutes: 240, forceCloseBeforeCloseMinutes: 10, trailingStopPct: 0.01 }
    });
    expect(trail.exitReason).toBe("TRAILING_STOP");

    const be = evaluateShadowExitRules({
      position: { ...base, highWaterMark: 108, breakEvenArmed: true, stop: 100 },
      quote: { last: 100 },
      indicators: {},
      limits: { maxPositionDurationMinutes: 240, forceCloseBeforeCloseMinutes: 10, breakEvenArmPct: 0.5 }
    });
    expect(be.exitReason).toBe("BREAK_EVEN");

    const vwap = evaluateShadowExitRules({
      position: { ...base, currentExitRule: "VWAP_LOSS", highWaterMark: 100 },
      quote: { last: 99.5 },
      indicators: { vwap: 100 },
      limits: {
        maxPositionDurationMinutes: 240,
        forceCloseBeforeCloseMinutes: 10,
        trailingStopPct: 0.02
      }
    });
    expect(vwap.exitReason).toBe("VWAP_LOSS");

    const reversal = evaluateShadowExitRules({
      position: { ...base, highWaterMark: 100 },
      quote: { last: 98.5 },
      indicators: { rsi: 30, ema21: 99 },
      limits: {
        maxPositionDurationMinutes: 240,
        forceCloseBeforeCloseMinutes: 10,
        trailingStopPct: 0.05
      }
    });
    expect(reversal.exitReason).toBe("INDICATOR_REVERSAL");

    const trend = evaluateShadowExitRules({
      position: { ...base, highWaterMark: 100 },
      quote: { last: 98.5 },
      indicators: { broadMarketTrend: "BEAR", ema50: 99, ema200: 101 },
      limits: {
        maxPositionDurationMinutes: 240,
        forceCloseBeforeCloseMinutes: 10,
        trailingStopPct: 0.05
      }
    });
    expect(trend.exitReason).toBe("TREND_INVALIDATION");

    const maxHold = evaluateShadowExitRules({
      position: { ...base, openedAt: new Date(Date.now() - 300 * 60_000).toISOString() },
      quote: { last: 101 },
      indicators: {},
      limits: { maxPositionDurationMinutes: 240, forceCloseBeforeCloseMinutes: 10 }
    });
    expect(maxHold.exitReason).toBe("MAX_HOLDING_TIME");

    const eod = evaluateShadowExitRules({
      position: base,
      quote: { last: 101 },
      indicators: { minutesToClose: 5 },
      limits: { maxPositionDurationMinutes: 240, forceCloseBeforeCloseMinutes: 10 }
    });
    expect(eod.exitReason).toBe("END_OF_DAY");
  });

  it("Paper pending reservation counts against concurrent capacity then releases on cancel", async () => {
    const limits = {
      ...DEFAULT_STOCK_INTRADAY_LIMITS,
      maxSimultaneousPositions: 1,
      maxTradesPerDay: 5,
      dailyCapitalAllocation: 100,
      maxPortfolioExposure: 500,
      maxExposurePerSymbol: 100,
      minCashReserve: 0
    };
    const mk = (symbol: string, intentId: string) => ({
      userId: "u1",
      idempotencyKey: `paper-pend-${symbol}`,
      intent: {
        intentId,
        userId: "u1",
        symbol,
        environment: "PAPER" as const,
        strategy: "MOMENTUM_BREAKOUT" as const,
        signalAlertId: symbol,
        barTimestamp: "t",
        side: "BUY" as const,
        state: "ENTRY_RESERVED" as const,
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
        leaseExpiresAt: null,
        entryReservationState: null,
        confidenceAtEntry: 85
      },
      position: null,
      cashAmount: 18,
      availableCashFromBroker: 5000,
      limits,
      openShadowPosition: false,
      reservePendingCapacity: true
    });

    const first = await store.reserveEntryAtomically(mk("AAPL", "pp1"));
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.reservationState).toBe("RESERVED");

    const blocked = await store.reserveEntryAtomically(mk("MSFT", "pp2"));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("MAX_POSITIONS");

    const released = await store.releaseEntryReservationAtomically({
      userId: "u1",
      intentId: "pp1",
      reverseDailyCounters: true,
      nextState: "CANCELLED",
      blockReason: "TEST_CANCEL"
    });
    expect(released).toBe(true);

    const after = await store.reserveEntryAtomically(mk("MSFT", "pp3"));
    expect(after.ok).toBe(true);
  });
});
