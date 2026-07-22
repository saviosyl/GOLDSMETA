/**
 * Firestore Emulator integration tests for Stocks Intraday multi-instance safety.
 * Requires FIRESTORE_EMULATOR_HOST (started by npm run test:emulator or CI).
 * These tests must NOT be replaced by InMemory-only assertions for concurrency claims.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { FirestoreStockIntradayStore } from "../../src/services/stockIntraday/firestoreStockIntradayStore";
import { DEFAULT_STOCK_INTRADAY_LIMITS } from "../../src/services/stockIntraday/featureFlags";
import { hashRoutingId } from "../../src/services/stockIntraday/stockIntradayStore";
import type { StockTradeIntent } from "../../src/services/stockIntraday/types";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulatorHost ? describe : describe.skip;

function baseIntent(overrides: Partial<StockTradeIntent> = {}): StockTradeIntent {
  const now = new Date().toISOString();
  return {
    intentId: overrides.intentId ?? `i-${Math.random().toString(36).slice(2, 8)}`,
    userId: "emu-user",
    symbol: overrides.symbol ?? "AAPL",
    environment: "PAPER",
    strategy: "MOMENTUM_BREAKOUT",
    signalAlertId: "a",
    barTimestamp: now,
    side: "BUY",
    state: "ENTRY_RESERVED",
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
    goldMetaManaged: true,
    createdAt: now,
    updatedAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    entryReservationState: null,
    confidenceAtEntry: 85,
    ...overrides
  };
}

describeEmulator("Stock Intraday Firestore emulator", () => {
  let app: App;
  let store: FirestoreStockIntradayStore;
  let userId: string;

  beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST = emulatorHost!;
    app =
      getApps()[0] ??
      initializeApp({ projectId: "goldmeta-stock-intraday-emu" }, "stock-intraday-emu");
    store = new FirestoreStockIntradayStore(getFirestore(app));
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  beforeEach(async () => {
    userId = `emu-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await store.saveRiskState({
      userId,
      mode: "SHADOW",
      locked: false,
      lockReason: null,
      paused: false,
      emergencyStopActive: false,
      killSwitchActive: false,
      dailyRealisedPnl: 0,
      dailyUnrealisedPnl: 0,
      tradesUsedToday: 0,
      losingTradesToday: 0,
      dailyAllocationUsed: 0,
      dayKey: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      updatedAt: new Date().toISOString()
    });
    await store.saveSettings({
      userId,
      limits: { ...DEFAULT_STOCK_INTRADAY_LIMITS, maxSimultaneousPositions: 2, maxTradesPerDay: 5 },
      universe: {
        allowlist: ["AAPL", "MSFT"],
        exclusionList: [],
        exchanges: ["NASDAQ"],
        currencies: ["USD"],
        sectors: [],
        minPrice: 1,
        maxPrice: null,
        minAverageVolume: 1,
        minRelativeVolume: 1,
        maxSpreadBps: 50,
        maxVolatilityPct: 10,
        maxScannedCandidates: 10
      },
      allowedStrategyIds: [],
      updatedAt: new Date().toISOString()
    });
  });

  function intentFor(overrides: Partial<StockTradeIntent> = {}): StockTradeIntent {
    return baseIntent({ userId, ...overrides });
  }

  it("reserveAlert concurrent deduplication", async () => {
    const alertId = `alert-${Date.now()}`;
    const signal = {
      id: "s1",
      userId,
      alertId,
      deliveryStatus: "QUEUED" as const,
      processingStatus: "PENDING" as const,
      decisionStatus: "PENDING" as const,
      signal: {} as never,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const [a, b] = await Promise.all([
      store.reserveAlert(userId, alertId, { ...signal, id: "s1" }),
      store.reserveAlert(userId, alertId, { ...signal, id: "s2" })
    ]);
    expect([a, b].filter((x) => x === "reserved")).toHaveLength(1);
    expect([a, b].filter((x) => x === "duplicate")).toHaveLength(1);
  });

  it("reserveEntryAtomically with different symbols under concurrency", async () => {
    const limits = {
      ...DEFAULT_STOCK_INTRADAY_LIMITS,
      maxSimultaneousPositions: 2,
      maxTradesPerDay: 5,
      dailyCapitalAllocation: 1000,
      maxPortfolioExposure: 1000,
      maxExposurePerSymbol: 500,
      minCashReserve: 0
    };
    const mk = (symbol: string) => {
      const intent = intentFor({ symbol, intentId: `i-${symbol}-${Date.now()}` });
      return store.reserveEntryAtomically({
        userId,
        idempotencyKey: `idem-${symbol}-${Date.now()}-${Math.random()}`,
        intent,
        position: {
          positionId: `p-${symbol}-${Date.now()}`,
          userId,
          intentId: intent.intentId,
          symbol,
          environment: "PAPER",
          quantity: 0.1,
          entryPrice: 180,
          stop: 178,
          takeProfit: 185,
          currentExitRule: "HARD_STOP",
          unrealisedPnl: 0,
          openedAt: new Date().toISOString(),
          goldMetaManaged: true
        },
        cashAmount: 18,
        availableCashFromBroker: 5000,
        limits,
        openShadowPosition: true
      });
    };
    const results = await Promise.all([mk("AAPL"), mk("MSFT")]);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
  });

  it("maximum position enforcement", async () => {
    const limits = {
      ...DEFAULT_STOCK_INTRADAY_LIMITS,
      maxSimultaneousPositions: 1,
      maxTradesPerDay: 5,
      dailyCapitalAllocation: 1000,
      maxPortfolioExposure: 1000,
      maxExposurePerSymbol: 500,
      minCashReserve: 0
    };
    const firstIntent = intentFor({ symbol: "AAPL", intentId: `max-a-${Date.now()}` });
    const first = await store.reserveEntryAtomically({
      userId,
      idempotencyKey: `max-a-${Date.now()}`,
      intent: firstIntent,
      position: {
        positionId: `p-max-a-${Date.now()}`,
        userId,
        intentId: firstIntent.intentId,
        symbol: "AAPL",
        environment: "PAPER",
        quantity: 0.1,
        entryPrice: 180,
        stop: 178,
        takeProfit: 185,
        currentExitRule: "HARD_STOP",
        unrealisedPnl: 0,
        openedAt: new Date().toISOString(),
        goldMetaManaged: true
      },
      cashAmount: 18,
      availableCashFromBroker: 5000,
      limits,
      openShadowPosition: true
    });
    expect(first.ok).toBe(true);
    const secondIntent = intentFor({ symbol: "MSFT", intentId: `max-b-${Date.now()}` });
    const second = await store.reserveEntryAtomically({
      userId,
      idempotencyKey: `max-b-${Date.now()}`,
      intent: secondIntent,
      position: {
        positionId: `p-max-b-${Date.now()}`,
        userId,
        intentId: secondIntent.intentId,
        symbol: "MSFT",
        environment: "PAPER",
        quantity: 0.1,
        entryPrice: 180,
        stop: 178,
        takeProfit: 185,
        currentExitRule: "HARD_STOP",
        unrealisedPnl: 0,
        openedAt: new Date().toISOString(),
        goldMetaManaged: true
      },
      cashAmount: 18,
      availableCashFromBroker: 5000,
      limits,
      openShadowPosition: true
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("MAX_POSITIONS");
  });

  it("daily allocation and cash reservation enforcement", async () => {
    const limits = {
      ...DEFAULT_STOCK_INTRADAY_LIMITS,
      dailyCapitalAllocation: 20,
      maxPortfolioExposure: 1000,
      maxExposurePerSymbol: 500,
      minCashReserve: 4900,
      maxSimultaneousPositions: 5,
      maxTradesPerDay: 5
    };
    const intent = intentFor({ intentId: `alloc-${Date.now()}` });
    const alloc = await store.reserveEntryAtomically({
      userId,
      idempotencyKey: `alloc-${Date.now()}`,
      intent,
      position: null,
      cashAmount: 25,
      availableCashFromBroker: 5000,
      limits,
      openShadowPosition: false,
      reservePendingCapacity: true
    });
    expect(alloc.ok).toBe(false);
    if (!alloc.ok) expect(alloc.code).toBe("DAILY_ALLOCATION_EXCEEDED");

    const cashIntent = intentFor({ intentId: `cash-${Date.now()}`, symbol: "MSFT" });
    const cash = await store.reserveEntryAtomically({
      userId,
      idempotencyKey: `cash-${Date.now()}`,
      intent: cashIntent,
      position: null,
      cashAmount: 18,
      availableCashFromBroker: 5000,
      limits: { ...limits, dailyCapitalAllocation: 100, minCashReserve: 4990 },
      openShadowPosition: false,
      reservePendingCapacity: true
    });
    expect(cash.ok).toBe(false);
    if (!cash.ok) expect(cash.code).toBe("CASH_RESERVE");
  });

  it("job lease claims and dead-letter transition", async () => {
    const job = await store.createJob({
      jobId: `job-${Date.now()}`,
      userId,
      kind: "PROCESS_SIGNAL",
      signalId: null,
      alertId: null,
      maxAttempts: 1,
      payload: {}
    });
    const [a, b] = await Promise.all([
      store.claimJob(userId, job.jobId, "worker-a"),
      store.claimJob(userId, job.jobId, "worker-b")
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const failed = await store.failJob(userId, job.jobId, "boom");
    expect(failed?.state).toBe("DEAD_LETTER");
  });

  it("retry-index query returns due QUEUED jobs", async () => {
    const job = await store.createJob({
      jobId: `retry-${Date.now()}`,
      userId,
      kind: "PROCESS_SIGNAL",
      signalId: null,
      alertId: null,
      maxAttempts: 3,
      payload: {}
    });
    await store.claimJob(userId, job.jobId, "w1");
    await store.failJob(userId, job.jobId, "temp");
    // Force due
    const dueForced = await store.listDueRetryJobs(Date.now() + 60 * 60_000);
    expect(dueForced.some((d) => d.jobId === job.jobId)).toBe(true);
  });

  it("dashboard persistence", async () => {
    await store.saveDashboardSnapshot({
      userId,
      lastTradingViewAlert: null,
      lastRankedOpportunities: [],
      rejectedRecently: [{ symbol: "AAPL", reason: "test", at: new Date().toISOString() }],
      lastMarketDataAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const snap = await store.getDashboardSnapshot(userId);
    expect(snap.rejectedRecently[0]?.reason).toBe("test");
  });

  it("webhook connection revocation uses hashed routing id", async () => {
    const connectionId = `gm_si_emu_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const routingIdHash = hashRoutingId(connectionId);
    await store.saveWebhookConnection({
      connectionId,
      routingIdHash,
      userId,
      label: "emu",
      enabled: true,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 10,
      rateCount: 0,
      rateWindowStart: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rotatedFromRoutingIdHash: null
    });
    const loaded = await store.getWebhookConnection(connectionId);
    expect(loaded?.routingIdHash).toBe(routingIdHash);
    const revoked = await store.revokeWebhookConnection(connectionId, userId);
    expect(revoked?.enabled).toBe(false);
    expect(revoked?.revokedAt).toBeTruthy();
  });
});
