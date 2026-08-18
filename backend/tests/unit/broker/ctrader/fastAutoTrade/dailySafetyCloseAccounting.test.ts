import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    reset() {
      docs.clear();
    }
  };
});

vi.mock("../../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings: vi.fn(async () => ({
    uid: "u1",
    environment: "demo",
    maxDailyLoss: 250,
    maxTradesPerDay: 48,
    maxOpenPositions: 1,
    pauseAfterConsecutiveLosses: 3,
    tradeCooldownMinutes: 30,
    dailyProfitTargetEnabled: false,
    dailyProfitTarget: null,
    profitProtectionEnabled: false,
    profitProtectionFloor: null,
    emergencyStopActive: false
  }))
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      async get() {
        const data = store.docs.get(path);
        return { exists: Boolean(data), data: () => data };
      },
      async set(next: Record<string, unknown>) {
        store.docs.set(path, { ...(store.docs.get(path) ?? {}), ...next });
      }
    })
  }),
  FieldValue: {}
}));

import {
  markTradeClosed
} from "../../../../../src/services/broker/ctrader/dailySafetyService";
import {
  emptyDailySafety,
  getDailySafetyDoc,
  saveDailySafetyDoc,
  tradingDayKey
} from "../../../../../src/services/broker/ctrader/dailySafetyStore";
import { computeCloseDiagnostics } from "../../../../../src/services/broker/ctrader/fastAutoTrade/closeDiagnostics";
import { FAST_AUTOTRADE_STRATEGY_ID } from "../../../../../src/services/broker/ctrader/fastAutoTrade/types";

describe("daily safety close accounting", () => {
  beforeEach(() => {
    store.reset();
  });

  it("applies broker-confirmed -55.55 once and increments consecutiveLosses", async () => {
    const day = tradingDayKey();
    const daily = emptyDailySafety("u1", "demo", day);
    daily.openPositions = 1;
    daily.tradesUsed = 1;
    daily.countedTradeIds = ["open:corr_msx3w970_f24afed5"];
    await saveDailySafetyDoc(daily);

    await markTradeClosed({
      uid: "u1",
      environment: "demo",
      tradeId: "corr_msx3w970_f24afed5",
      pnl: -55.55,
      strategyId: FAST_AUTOTRADE_STRATEGY_ID,
      brokerDealId: "60811349",
      brokerPositionId: "54335877"
    });

    const after = await getDailySafetyDoc("u1", "demo");
    expect(after.realisedPnl).toBeCloseTo(-55.55, 2);
    expect(after.consecutiveLosses).toBe(1);
    expect(after.openPositions).toBe(0);
    expect(after.countedTradeIds).toContain("close:corr_msx3w970_f24afed5");
    expect(after.countedTradeIds).toContain("deal:60811349");
    expect(after.cooldownUntil).toBeTruthy();

    await markTradeClosed({
      uid: "u1",
      environment: "demo",
      tradeId: "corr_msx3w970_f24afed5",
      pnl: -55.55,
      strategyId: FAST_AUTOTRADE_STRATEGY_ID,
      brokerDealId: "60811349",
      brokerPositionId: "54335877"
    });
    const again = await getDailySafetyDoc("u1", "demo");
    expect(again.realisedPnl).toBeCloseTo(-55.55, 2);
    expect(again.consecutiveLosses).toBe(1);
  });

  it("rolls a stale trading-day document into history and starts a fresh today", async () => {
    const yesterday = emptyDailySafety("u1", "demo", "2026-08-16");
    yesterday.realisedPnl = -55.55;
    yesterday.consecutiveLosses = 1;
    yesterday.countedTradeIds = ["close:corr_old"];
    store.docs.set("users/u1/autotradeDailySafety/demo", { ...yesterday });
    const today = await getDailySafetyDoc("u1", "demo");
    expect(today.tradingDay).toBe(tradingDayKey());
    expect(today.realisedPnl).toBe(0);
    expect(today.consecutiveLosses).toBe(0);
    expect(today.countedTradeIds).toEqual([]);
    const hist = store.docs.get("users/u1/autotradeDailySafetyHistory/demo_2026-08-16");
    expect(hist?.realisedPnl).toBeCloseTo(-55.55, 2);
    expect(hist?.consecutiveLosses).toBe(1);
  });

  it("records stop-slippage diagnostics for the production close", () => {
    const d = computeCloseDiagnostics({
      side: "BUY",
      brokerStopLoss: 4397.61,
      closePrice: 4397.45,
      fillPrice: 4398.08,
      filledLots: 92,
      quoteToDeposit: 0.86253741,
      grossPnl: -49.99,
      commission: -5.56,
      swap: 0,
      netPnl: -55.55,
      effectiveRiskAmount: 37.5
    });
    expect(d.stopSlippagePrice).toBeCloseTo(0.16, 5);
    expect(d.netPnl).toBeCloseTo(-55.55, 2);
    expect(d.netR).toBeCloseTo(-55.55 / 37.5, 3);
  });
});
