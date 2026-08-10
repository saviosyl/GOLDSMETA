import { describe, expect, it } from "vitest";
import {
  demoAutoAuthorityConflictsWithLegacyMode,
  evaluateDemoAutoExecutionAuthority
} from "../../../../src/services/broker/ctrader/demoAutoExecutionAuthority";
import { evaluateEntryGates } from "../../../../src/services/broker/ctrader/dailySafetyService";
import { evaluateQualificationCandidate } from "../../../../src/services/broker/ctrader/qualificationEvaluator";
import { allowsDemoOrderSubmission } from "../../../../src/services/broker/ctrader/qualificationMachine";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";
import type { UserAutoTradeSettings } from "../../../../src/services/broker/ctrader/userAutoTradeSettings";
import type { DailySafetyDocument } from "../../../../src/services/broker/ctrader/dailySafetyTypes";

function baseSettings(over: Partial<UserAutoTradeSettings> = {}): UserAutoTradeSettings {
  return {
    uid: "u1",
    environment: "demo",
    sizingMode: "automatic_risk",
    fixedRiskAmount: 300,
    percentageRisk: 0.5,
    manualLotSize: 0.01,
    maxDailyLoss: 50,
    maxTradesPerDay: 6,
    maxOpenPositions: 1,
    minConfidence: 80,
    minRiskReward: 1.5,
    maxSpread: 2,
    maxQuoteAgeSeconds: 15,
    stopLossDistance: null,
    takeProfitMethod: "fixed_rr",
    tradeCooldownMinutes: 30,
    pauseAfterConsecutiveLosses: 3,
    allowedSessions: ["London", "NewYork"],
    allowedDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    newsFilterEnabled: true,
    newsImpactMode: "HIGH",
    newsMinutesBefore: 15,
    newsMinutesAfter: 15,
    maxSlippage: 1.5,
    dailyProfitTarget: null,
    dailyProfitTargetEnabled: false,
    profitProtectionEnabled: false,
    profitProtectionFloor: null,
    maxPositionExposureLots: null,
    confirmationCandleRequired: true,
    trendConfirmationRequired: false,
    volumeConfirmationRequired: false,
    breakEvenEnabled: false,
    trailingStopEnabled: false,
    partialTakeProfitEnabled: false,
    autoTradePaused: false,
    autoTradePausedReason: null,
    autoTradeEnabledIntent: true,
    emergencyStopActive: false,
    liveActivationConfirmedAt: null,
    liveActivationPhraseConfirmed: false,
    updatedAt: new Date().toISOString(),
    ...over
  } as UserAutoTradeSettings;
}

function baseDaily(over: Partial<DailySafetyDocument> = {}): DailySafetyDocument {
  return {
    uid: "u1",
    environment: "demo",
    tradingDay: "2026-08-10",
    tradesUsed: 0,
    openPositions: 0,
    realisedPnl: 0,
    peakDailyPnl: 0,
    consecutiveLosses: 0,
    lastTradeWasLoss: null,
    lastTradeClosedAt: null,
    cooldownUntil: null,
    pausedReason: null,
    pausedAt: null,
    dailyLossLocked: false,
    dailyProfitTargetHit: false,
    profitProtectionPaused: false,
    countedTradeIds: [],
    updatedAt: new Date().toISOString(),
    ...over
  };
}

describe("Demo Auto state / execution authority", () => {
  it("A: Demo Auto enabled state is consumed consistently for execution", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(true);
    expect(authority.authorityLabel).toBe("DEMO_AUTO");
    expect(allowsDemoOrderSubmission("LIVE_QUALIFICATION")).toBe(true);
  });

  it("F: AutoTrade OFF (intent/state) → no Demo submission authority", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "PREVIEW_QUALIFICATION",
      autoTradeEnabledIntent: false,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(false);
    expect(authority.authorityLabel).toBe("OFF");
  });

  it("G: stale quote → qualification candidate blocked", () => {
    const result = evaluateQualificationCandidate({
      direction: "BUY",
      signalId: "s1",
      entry: 4350,
      stopLoss: 4340,
      takeProfit: 4370,
      confidence: 90,
      minConfidence: 80,
      minRiskReward: 1.5,
      quoteBid: 4350,
      quoteAsk: 4350.1,
      quoteSpread: 0.1,
      quoteStale: false,
      marketStatus: "OPEN",
      maxSpread: 2,
      maxQuoteAgeSeconds: 15,
      quoteAgeSeconds: 180,
      alreadyCountedSignal: false
    });
    expect(result.ok).toBe(false);
    expect(result.failed).toContain("QUOTE_AGE");
  });

  it("H: legacy mode OFF can conflict with Demo Auto authority (detectable)", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(
      demoAutoAuthorityConflictsWithLegacyMode({
        legacyMode: "OFF",
        authority
      })
    ).toBe(true);
  });

  it("ghost openPositions counter blocks entries until reconciled to zero", () => {
    const blocked = evaluateEntryGates({
      settings: baseSettings(),
      daily: baseDaily({ openPositions: 1, tradesUsed: 1 })
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe("MAX_OPEN_POSITIONS");

    const clear = evaluateEntryGates({
      settings: baseSettings(),
      daily: baseDaily({ openPositions: 0, tradesUsed: 1 })
    });
    expect(clear.allowed).toBe(true);
  });

  it("B/C/D/E structural: LIVE_QUALIFICATION allows Demo orders; confirmation gate remains", () => {
    expect(allowsDemoOrderSubmission("LIVE_QUALIFICATION")).toBe(true);
    expect(allowsDemoOrderSubmission("PREVIEW_QUALIFICATION")).toBe(false);
    const pending = evaluateQualificationCandidate({
      direction: "BUY",
      signalId: "armed",
      entry: 4350,
      stopLoss: 4340,
      takeProfit: 4370,
      confidence: 99,
      minConfidence: 80,
      minRiskReward: 1.5,
      quoteBid: 4350,
      quoteAsk: 4350.1,
      quoteSpread: 0.1,
      quoteStale: false,
      marketStatus: "OPEN",
      maxSpread: 2,
      maxQuoteAgeSeconds: 15,
      quoteAgeSeconds: 2,
      alreadyCountedSignal: false
    });
    expect(pending.ok).toBe(true);
  });

  it("I: Live trading stays locked", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: true,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(false);
    expect(authority.authorityLabel).toBe("DEMO_AUTO_LOCKED_LIVE");
  });
});

describe("openPositionReconcile pure expectations", () => {
  it("cleared ghost counter restores entry permission with maxOpenPositions=1", () => {
    const settings = baseSettings({ maxOpenPositions: 1, maxTradesPerDay: 6 });
    expect(
      evaluateEntryGates({
        settings,
        daily: baseDaily({ openPositions: 0, tradesUsed: 1 })
      }).allowed
    ).toBe(true);
  });
});
