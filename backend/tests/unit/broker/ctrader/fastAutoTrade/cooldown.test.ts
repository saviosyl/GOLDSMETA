import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserAutoTradeSettings = vi.fn();
const getDailySafetyDoc = vi.fn();
const saveDailySafetyDoc = vi.fn();

vi.mock("../../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings: (...a: unknown[]) => getUserAutoTradeSettings(...a)
}));
vi.mock("../../../../../src/services/broker/ctrader/dailySafetyStore", () => ({
  getDailySafetyDoc: (...a: unknown[]) => getDailySafetyDoc(...a),
  saveDailySafetyDoc: (...a: unknown[]) => saveDailySafetyDoc(...a),
  tradingDayKey: () => "2026-08-14"
}));

import {
  demoPostLossCooldownMinutes,
  markTradeClosed
} from "../../../../../src/services/broker/ctrader/dailySafetyService";
import { FAST_AUTOTRADE_STRATEGY_ID } from "../../../../../src/services/broker/ctrader/fastAutoTrade";

function settings() {
  return {
    uid: "uid",
    environment: "demo" as const,
    tradeCooldownMinutes: 30,
    pauseAfterConsecutiveLosses: 3,
    maxDailyLoss: 1000,
    dailyProfitTargetEnabled: false,
    dailyProfitTarget: null,
    profitProtectionEnabled: false,
    profitProtectionFloor: null
  };
}

function dailyDoc() {
  return {
    uid: "uid",
    environment: "demo" as const,
    tradingDay: "2026-08-14",
    tradesUsed: 1,
    realisedPnl: 0,
    peakDailyPnl: 0,
    consecutiveLosses: 0,
    openPositions: 1,
    cooldownUntil: null,
    pausedReason: null,
    pausedAt: null,
    dailyLossLocked: false,
    dailyProfitTargetHit: false,
    profitProtectionPaused: false,
    lastTradeClosedAt: null,
    lastTradeWasLoss: null,
    updatedAt: "2026-08-14T09:00:00.000Z",
    countedTradeIds: ["open:corr_x"]
  };
}

describe("FAST-only demo post-loss cooldown", () => {
  it("reduces to 1 minute only for FAST_AUTOTRADE_V1 demo closes", () => {
    expect(
      demoPostLossCooldownMinutes({
        settingsCooldownMinutes: 30,
        environment: "demo",
        strategyId: FAST_AUTOTRADE_STRATEGY_ID
      })
    ).toBe(1);
  });

  it("keeps the user cooldown for manual / legacy / other demo strategies", () => {
    expect(
      demoPostLossCooldownMinutes({
        settingsCooldownMinutes: 30,
        environment: "demo",
        strategyId: null
      })
    ).toBe(30);
    expect(
      demoPostLossCooldownMinutes({
        settingsCooldownMinutes: 30,
        environment: "demo",
        strategyId: "GOLD_HUNTER"
      })
    ).toBe(30);
    expect(
      demoPostLossCooldownMinutes({
        settingsCooldownMinutes: 30,
        environment: "demo",
        strategyId: "ACTIVE_DEMO"
      })
    ).toBe(30);
  });

  it("does not change Live cooldown even for a FAST strategyId", () => {
    expect(
      demoPostLossCooldownMinutes({
        settingsCooldownMinutes: 30,
        environment: "live",
        strategyId: FAST_AUTOTRADE_STRATEGY_ID
      })
    ).toBe(30);
  });

  describe("markTradeClosed wiring", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-14T09:10:00.000Z"));
      getUserAutoTradeSettings.mockResolvedValue(settings());
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("writes a 1-minute cooldown only when strategyId is FAST_AUTOTRADE_V1", async () => {
      const fastDaily = dailyDoc();
      getDailySafetyDoc.mockResolvedValue(fastDaily);
      saveDailySafetyDoc.mockImplementation(async (d: typeof fastDaily) => {
        Object.assign(fastDaily, d);
      });
      await markTradeClosed({
        uid: "uid",
        environment: "demo",
        tradeId: "corr_fast",
        pnl: -2,
        strategyId: FAST_AUTOTRADE_STRATEGY_ID
      });
      expect(Date.parse(fastDaily.cooldownUntil ?? "")).toBe(
        Date.parse("2026-08-14T09:11:00.000Z")
      );

      const otherDaily = dailyDoc();
      getDailySafetyDoc.mockResolvedValue(otherDaily);
      saveDailySafetyDoc.mockImplementation(async (d: typeof otherDaily) => {
        Object.assign(otherDaily, d);
      });
      await markTradeClosed({
        uid: "uid",
        environment: "demo",
        tradeId: "corr_manual",
        pnl: -2,
        strategyId: null
      });
      expect(Date.parse(otherDaily.cooldownUntil ?? "")).toBe(
        Date.parse("2026-08-14T09:40:00.000Z")
      );
    });
  });
});
