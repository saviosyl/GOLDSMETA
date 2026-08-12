import { beforeEach, describe, expect, it, vi } from "vitest";

const getPositionLifecycle = vi.fn();
const savePositionLifecycle = vi.fn();
const listOpenPositionLifecycles = vi.fn();

vi.mock("../../../../src/services/broker/ctrader/positionLifecycleStore", () => ({
  getPositionLifecycle: (...a: unknown[]) => getPositionLifecycle(...a),
  savePositionLifecycle: (...a: unknown[]) => savePositionLifecycle(...a),
  listOpenPositionLifecycles: (...a: unknown[]) => listOpenPositionLifecycles(...a),
  listOpenPositionOwners: vi.fn(async () => [])
}));

// Keep other lifecycle deps from pulling real broker I/O
const amendDemoStopLoss = vi.fn();
const reconcileDemoBrokerPositions = vi.fn(async () => [] as unknown[]);

vi.mock("../../../../src/services/broker/ctrader/demoPositionMutations", () => ({
  amendDemoStopLoss: (...a: unknown[]) => amendDemoStopLoss(...a),
  closeDemoBrokerPosition: vi.fn(),
  fetchConfirmedCloseForPosition: vi.fn(),
  loadDemoXauUsdSymbol: vi.fn(),
  reconcileDemoBrokerPositions: (...a: unknown[]) =>
    reconcileDemoBrokerPositions(...a)
}));
vi.mock("../../../../src/services/broker/ctrader/autoTradeJournal", () => ({
  updateAutoTradeJournalOnClose: vi.fn(async () => ({ updated: true }))
}));
vi.mock("../../../../src/services/broker/ctrader/autoTradeNotifications", () => ({
  notifyAutoTradeEvent: vi.fn()
}));
vi.mock("../../../../src/services/broker/ctrader/quoteService", () => ({
  getExecutableQuoteForAutoTrade: vi.fn()
}));
vi.mock("../../../../src/services/broker/ctrader/quoteStore", () => ({
  listOwnersNeedingQuoteRefresh: vi.fn(async () => [])
}));
vi.mock("../../../../src/services/broker/ctrader/openPositionReconcile", () => ({
  reconcileDemoOpenPositionCounters: vi.fn()
}));
vi.mock("../../../../src/services/broker/ctrader/newsGuard", () => ({
  evaluateNewsGuard: vi.fn(() => ({ active: false }))
}));
vi.mock("../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings: vi.fn(),
  setEmergencyStop: vi.fn()
}));
vi.mock("../../../../src/services/decisionEngine/management", () => ({
  evaluateManagement: vi.fn(() => ({ action: "HOLD", explanation: "ok" }))
}));

import {
  createDemoPositionLifecycle,
  verifyAndRepairProtection
} from "../../../../src/services/broker/ctrader/demoPositionLifecycle";
import {
  aggregateClosingDeals,
  parseBrokerClosedDeals
} from "../../../../src/services/broker/ctrader/openApiClient";
import {
  emptyProfitLockState,
  emptyTpStatuses,
  type DemoPositionLifecycle
} from "../../../../src/services/broker/ctrader/positionLifecycleTypes";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";

function lockDoc(
  overrides: Partial<DemoPositionLifecycle> = {}
): DemoPositionLifecycle {
  return {
    id: "c1",
    uid: "u1",
    environment: "DEMO",
    correlationId: "c1",
    brokerOrderId: "o1",
    brokerPositionId: "p1",
    accountId: "48014710",
    accountMasked: "48…10",
    symbol: "XAUUSD",
    side: "BUY",
    entry: 2350,
    currentPrice: 2350,
    lots: 17,
    remainingLots: 17,
    initialSl: 2340,
    currentSl: 2340,
    tp1: 2360,
    tp2: 2370,
    tp3: 2380,
    ...emptyTpStatuses(),
    openedAt: new Date().toISOString(),
    closedAt: null,
    realisedPnl: null,
    unrealisedPnl: 0,
    brokerPnlConfirmed: false,
    closePrice: null,
    grossPnl: null,
    commission: null,
    swap: null,
    netPnl: null,
    brokerDealId: null,
    initialRisk: 10,
    currentRisk: 10,
    qualificationStage: "LIVE_QUALIFICATION",
    decisionId: "d1",
    setupRef: "d1",
    source: "demo_auto",
    managementState: "HOLD",
    lastRecommendation: null,
    protectionVerified: false,
    protectionFailure: false,
    events: [],
    appliedDedupeKeys: [],
    updatedAt: new Date().toISOString(),
    status: "OPEN",
    ...emptyProfitLockState(),
    managementPolicy: "PROFIT_LOCK_V1",
    profitLockStage: "OPEN",
    brokerHardTakeProfit: 2380,
    ...overrides
  };
}

describe("createDemoPositionLifecycle persist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savePositionLifecycle.mockResolvedValue(undefined);
    amendDemoStopLoss.mockResolvedValue({ accepted: true });
    reconcileDemoBrokerPositions.mockResolvedValue([]);
  });

  it("B1: PROFIT_LOCK_V1 keeps strategy TP1 when broker hard TP is TP3", async () => {
    getPositionLifecycle.mockResolvedValue(null);
    const doc = await createDemoPositionLifecycle({
      uid: "uid",
      correlationId: "corr_b1_tp_split",
      brokerOrderId: "ord-tp3",
      brokerPositionId: "pos-1",
      accountId: "48014710",
      accountMasked: "48…10",
      side: "BUY",
      entry: 2350,
      stopLoss: 2340,
      takeProfit: 2380, // broker-returned hard TP3 — must never become strategy TP1
      tp1: 2360,
      tp2: 2370,
      tp3: 2380,
      managementPolicy: "PROFIT_LOCK_V1",
      brokerHardTakeProfit: 2380,
      lots: 17,
      qualificationStage: "LIVE_QUALIFICATION",
      decisionId: "d1",
      source: "demo_auto",
      openedAt: "2026-08-12T11:00:00.000Z"
    });
    expect(doc.tp1).toBe(2360);
    expect(doc.tp2).toBe(2370);
    expect(doc.tp3).toBe(2380);
    expect(doc.brokerHardTakeProfit).toBe(2380);
    expect(doc.managementPolicy).toBe("PROFIT_LOCK_V1");
    expect(doc.profitLockStage).toBe("OPEN");
  });

  it("A/C: creates OPEN lifecycle with brokerPositionId exactly once", async () => {
    getPositionLifecycle.mockResolvedValue(null);
    const doc = await createDemoPositionLifecycle({
      uid: "uid",
      correlationId: "corr_msnkgvva_c53188cc",
      brokerOrderId: "ord-1",
      brokerPositionId: "53870324",
      accountId: "48014710",
      accountMasked: "48…10",
      side: "BUY",
      entry: 4376.6,
      stopLoss: 4376.4,
      takeProfit: 4377.0,
      tp1: 4377.0,
      tp2: null,
      tp3: null,
      lots: 0.13,
      qualificationStage: "DEMO_AUTO_ENABLED",
      decisionId: "4408a474b71597f8a043f544",
      source: "demo_auto",
      openedAt: "2026-08-10T18:32:05.000Z"
    });
    expect(doc.status).toBe("OPEN");
    expect(doc.brokerPositionId).toBe("53870324");
    expect(doc.brokerOrderId).toBe("ord-1");
    expect(doc.accountId).toBe("48014710");
    expect(doc.decisionId).toBe("4408a474b71597f8a043f544");
    expect(savePositionLifecycle).toHaveBeenCalledTimes(1);
  });

  it("A: merges missing brokerPositionId onto existing lifecycle", async () => {
    getPositionLifecycle.mockResolvedValue({
      id: "corr_x",
      uid: "uid",
      correlationId: "corr_x",
      brokerOrderId: "ord-1",
      brokerPositionId: null,
      accountId: null,
      accountMasked: "48…10",
      status: "OPEN",
      entry: null,
      initialSl: null,
      lots: null,
      remainingLots: null,
      currentPrice: null,
      decisionId: null,
      events: [],
      appliedDedupeKeys: ["open:corr_x"],
      updatedAt: "2026-08-10T18:32:05.000Z"
    });
    const doc = await createDemoPositionLifecycle({
      uid: "uid",
      correlationId: "corr_x",
      brokerOrderId: "ord-1",
      brokerPositionId: "53870324",
      accountId: "48014710",
      accountMasked: "48…10",
      side: "BUY",
      entry: 4376.6,
      stopLoss: 4376.4,
      lots: 0.13,
      qualificationStage: "DEMO_AUTO_ENABLED",
      decisionId: "sig",
      source: "demo_auto",
      openedAt: "2026-08-10T18:32:05.000Z"
    });
    expect(doc.brokerPositionId).toBe("53870324");
    expect(doc.accountId).toBe("48014710");
    expect(doc.entry).toBe(4376.6);
    expect(savePositionLifecycle).toHaveBeenCalledTimes(1);
  });
});

describe("F5 — PROFIT_LOCK_V1 initial SL + TP3 verification", () => {
  it("SL + correct TP3 → verified", async () => {
    reconcileDemoBrokerPositions.mockResolvedValue([
      {
        positionId: "p1",
        symbolId: "41",
        side: "BUY",
        volumeLots: 17,
        volumeUnits: 1700,
        entryPrice: 2350,
        stopLoss: 2340,
        takeProfit: 2380,
        unrealisedPnl: 0,
        usedMargin: null,
        openTimestamp: null
      }
    ]);
    const next = await verifyAndRepairProtection(lockDoc(), {
      profitLockActive: true
    });
    expect(next.protectionVerified).toBe(true);
    expect(amendDemoStopLoss).not.toHaveBeenCalled();
  });

  it("SL exists + wrong TP → repair then reconcile to TP3", async () => {
    reconcileDemoBrokerPositions
      .mockResolvedValueOnce([
        {
          positionId: "p1",
          side: "BUY",
          volumeLots: 17,
          volumeUnits: 1700,
          entryPrice: 2350,
          stopLoss: 2340,
          takeProfit: 2360, // wrong (strategy TP1 leaked)
          unrealisedPnl: 0,
          usedMargin: null,
          openTimestamp: null,
          symbolId: "41"
        }
      ])
      .mockResolvedValueOnce([
        {
          positionId: "p1",
          side: "BUY",
          volumeLots: 17,
          volumeUnits: 1700,
          entryPrice: 2350,
          stopLoss: 2340,
          takeProfit: 2380,
          unrealisedPnl: 0,
          usedMargin: null,
          openTimestamp: null,
          symbolId: "41"
        }
      ]);
    const next = await verifyAndRepairProtection(lockDoc(), {
      profitLockActive: true
    });
    expect(amendDemoStopLoss).toHaveBeenCalledWith(
      expect.objectContaining({ stopLoss: 2340, takeProfit: 2380 })
    );
    expect(next.protectionVerified).toBe(true);
  });

  it("SL exists + TP null → repair then reconcile", async () => {
    reconcileDemoBrokerPositions
      .mockResolvedValueOnce([
        {
          positionId: "p1",
          side: "BUY",
          volumeLots: 17,
          volumeUnits: 1700,
          entryPrice: 2350,
          stopLoss: 2340,
          takeProfit: null,
          unrealisedPnl: 0,
          usedMargin: null,
          openTimestamp: null,
          symbolId: "41"
        }
      ])
      .mockResolvedValueOnce([
        {
          positionId: "p1",
          side: "BUY",
          volumeLots: 17,
          volumeUnits: 1700,
          entryPrice: 2350,
          stopLoss: 2340,
          takeProfit: 2380,
          unrealisedPnl: 0,
          usedMargin: null,
          openTimestamp: null,
          symbolId: "41"
        }
      ]);
    const next = await verifyAndRepairProtection(lockDoc(), {
      profitLockActive: true
    });
    expect(amendDemoStopLoss).toHaveBeenCalledWith(
      expect.objectContaining({ stopLoss: 2340, takeProfit: 2380 })
    );
    expect(next.protectionVerified).toBe(true);
  });

  it("repair accepted but broker still old TP → not verified", async () => {
    reconcileDemoBrokerPositions.mockResolvedValue([
      {
        positionId: "p1",
        side: "BUY",
        volumeLots: 17,
        volumeUnits: 1700,
        entryPrice: 2350,
        stopLoss: 2340,
        takeProfit: 2360,
        unrealisedPnl: 0,
        usedMargin: null,
        openTimestamp: null,
        symbolId: "41"
      }
    ]);
    const next = await verifyAndRepairProtection(lockDoc(), {
      profitLockActive: true
    });
    expect(next.protectionVerified).toBe(false);
    expect(next.profitLockLastBlocker).toBe(
      "BROKER_TP3_INITIAL_PROTECTION_UNCONFIRMED"
    );
    expect(next.protectionFailure).toBe(false);
  });

  it("LEGACY_V1: SL alone verifies without TP3", async () => {
    reconcileDemoBrokerPositions.mockResolvedValue([
      {
        positionId: "p1",
        side: "BUY",
        volumeLots: 17,
        volumeUnits: 1700,
        entryPrice: 2350,
        stopLoss: 2340,
        takeProfit: null,
        unrealisedPnl: 0,
        usedMargin: null,
        openTimestamp: null,
        symbolId: "41"
      }
    ]);
    const next = await verifyAndRepairProtection(
      lockDoc({ managementPolicy: "LEGACY_V1", brokerHardTakeProfit: null }),
      { profitLockActive: false }
    );
    expect(next.protectionVerified).toBe(true);
  });

  it("Live hard lock remains false (zero Live mutations in this path)", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
  });
});

describe("broker closed deal parsing", () => {
  it("E: parses broker net/gross P/L from deal list", () => {
    const deals = parseBrokerClosedDeals([
      {
        dealId: 1,
        orderId: 2,
        positionId: 53870324,
        executionPrice: 4376.37,
        executionTimestamp: Date.parse("2026-08-10T19:00:00.000Z"),
        moneyDigits: 2,
        closePositionDetail: {
          moneyDigits: 2,
          grossProfit: -293,
          commission: -78,
          swap: 0,
          closedVolume: 13
        }
      }
    ]);
    expect(deals).toHaveLength(1);
    expect(deals[0]!.positionId).toBe("53870324");
    expect(deals[0]!.grossPnl).toBe(-2.93);
    expect(deals[0]!.commission).toBe(-0.78);
    const agg = aggregateClosingDeals(deals);
    expect(agg?.netPnl).toBeCloseTo(-3.71, 2);
  });
});
