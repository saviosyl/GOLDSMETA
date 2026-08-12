import { afterEach, describe, expect, it } from "vitest";
import {
  applyDemoOvernightOverlay,
  isDemoOvernightWindowEnded,
  loadDemoOvernightConfig
} from "../../../../src/services/broker/ctrader/demoOvernightGuard";
import {
  assertCTraderLiveMutationsDisabled,
  isBrokerExecutionEnabled,
  isCTraderLiveEnabled
} from "../../../../src/services/broker/ctrader/flags";
import type { UserAutoTradeSettings } from "../../../../src/services/broker/ctrader/userAutoTradeSettings";

function baseSettings(
  over: Partial<UserAutoTradeSettings> = {}
): UserAutoTradeSettings {
  return {
    uid: "u1",
    environment: "demo",
    updatedAt: "2026-08-12T00:00:00.000Z",
    selectedAccountId: "48014710",
    sizingMode: "automatic_risk",
    fixedRiskAmount: 50,
    percentageRisk: 1,
    manualLotSize: 0.01,
    maxDailyLoss: 250,
    maxTradesPerDay: 6,
    maxOpenPositions: 2,
    minConfidence: 70,
    minRiskReward: 1.5,
    maxSpread: 2,
    maxQuoteAgeSeconds: 30,
    stopLossDistance: null,
    takeProfitMethod: "signal",
    tradeCooldownMinutes: 0,
    pauseAfterConsecutiveLosses: 3,
    allowedSessions: ["London", "NewYork", "Asia"],
    allowedDays: [],
    newsFilterEnabled: false,
    newsImpactMode: "OFF",
    newsMinutesBefore: 15,
    newsMinutesAfter: 15,
    maxSlippage: 1,
    dailyProfitTarget: null,
    dailyProfitTargetEnabled: false,
    profitProtectionEnabled: false,
    profitProtectionFloor: null,
    maxPositionExposureLots: null,
    confirmationCandleRequired: false,
    trendConfirmationRequired: false,
    volumeConfirmationRequired: false,
    breakEvenEnabled: false,
    trailingStopEnabled: false,
    partialTakeProfitEnabled: false,
    demoProfitLockLadderEnabled: false,
    autoTradePaused: false,
    autoTradePausedReason: null,
    liveActivationConfirmedAt: null,
    liveActivationPhraseConfirmed: false,
    autoTradeEnabledIntent: true,
    emergencyStopActive: false,
    ...over
  };
}

describe("Demo overnight guard", () => {
  afterEach(() => {
    delete process.env.DEMO_OVERNIGHT_MODE;
    delete process.env.DEMO_OVERNIGHT_RUN_UNTIL;
    delete process.env.DEMO_OVERNIGHT_RUN_ID;
  });

  it("disabled by default — no overlay", () => {
    const r = applyDemoOvernightOverlay(baseSettings(), {
      env: {},
      now: new Date("2026-08-12T23:00:00.000Z")
    });
    expect(r.enabled).toBe(false);
    expect(r.entriesAllowed).toBe(true);
    expect(r.effectiveRisk).toBe(50);
    expect(r.effectiveSettings.fixedRiskAmount).toBe(50);
  });

  it("caps risk/trades/confidence and forces confirmation without mutating saved risk source fields incorrectly", () => {
    process.env.DEMO_OVERNIGHT_MODE = "true";
    process.env.DEMO_OVERNIGHT_RUN_UNTIL = "2026-08-13T07:00:00+01:00";
    const saved = baseSettings({ fixedRiskAmount: 50, minConfidence: 70 });
    const r = applyDemoOvernightOverlay(saved, {
      now: new Date("2026-08-12T22:00:00.000Z")
    });
    expect(r.enabled).toBe(true);
    expect(r.entriesAllowed).toBe(true);
    expect(r.savedRisk).toBe(50);
    expect(r.overnightRiskCap).toBe(20);
    expect(r.effectiveRisk).toBe(20);
    expect(r.riskCapReason).toBe("OVERNIGHT_RISK_CAP");
    expect(r.effectiveSettings.fixedRiskAmount).toBe(20);
    expect(r.effectiveSettings.maxTradesPerDay).toBe(3);
    expect(r.effectiveSettings.maxOpenPositions).toBe(1);
    expect(r.effectiveSettings.minConfidence).toBe(80);
    expect(r.effectiveSettings.confirmationCandleRequired).toBe(true);
    // Original object not mutated
    expect(saved.fixedRiskAmount).toBe(50);
    expect(saved.minConfidence).toBe(70);
  });

  it("blocks new entries at/after Europe/Dublin 07:00 cutoff", () => {
    const cfg = loadDemoOvernightConfig({
      DEMO_OVERNIGHT_MODE: "true",
      DEMO_OVERNIGHT_RUN_UNTIL: "2026-08-13T07:00:00+01:00"
    } as NodeJS.ProcessEnv);
    expect(
      isDemoOvernightWindowEnded(
        cfg,
        new Date("2026-08-13T06:59:59+01:00")
      )
    ).toBe(false);
    expect(
      isDemoOvernightWindowEnded(
        cfg,
        new Date("2026-08-13T07:00:00+01:00")
      )
    ).toBe(true);
    const r = applyDemoOvernightOverlay(baseSettings(), {
      env: {
        DEMO_OVERNIGHT_MODE: "true",
        DEMO_OVERNIGHT_RUN_UNTIL: "2026-08-13T07:00:00+01:00"
      } as NodeJS.ProcessEnv,
      now: new Date("2026-08-13T06:00:00.000Z") // 07:00 Dublin
    });
    expect(r.entriesAllowed).toBe(false);
    expect(r.blockReason).toBe("OVERNIGHT_WINDOW_ENDED");
  });

  it("Live hard locks remain false even when env tries to enable", () => {
    expect(isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" })).toBe(false);
    expect(
      isBrokerExecutionEnabled({ BROKER_EXECUTION_ENABLED: "true" })
    ).toBe(false);
    expect(() =>
      assertCTraderLiveMutationsDisabled({
        CTRADER_LIVE_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toThrow(/CTRADER_LIVE_MUST_REMAIN_FALSE/);
    expect(() =>
      assertCTraderLiveMutationsDisabled({
        BROKER_EXECUTION_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toThrow(/BROKER_EXECUTION_MUST_REMAIN_FALSE/);
  });
});
