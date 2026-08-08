import { describe, expect, it } from "vitest";
import { evaluateEntryGates } from "../../../../src/services/broker/ctrader/dailySafetyService";
import { emptyDailySafety } from "../../../../src/services/broker/ctrader/dailySafetyStore";
import { defaultUserAutoTradeSettings } from "../../../../src/services/broker/ctrader/userAutoTradeSettings";
import { validateSettingsPatch } from "../../../../src/services/broker/ctrader/userAutoTradeSettings";
import { evaluateQualificationCandidate } from "../../../../src/services/broker/ctrader/qualificationEvaluator";
import { sessionAllowed } from "../../../../src/services/broker/ctrader/sessionGuard";

describe("daily safety + settings", () => {
  it("accepts maxTradesPerDay 6 and rejects 0 / 11", () => {
    expect(validateSettingsPatch({ maxTradesPerDay: 6 }, "demo").ok).toBe(true);
    expect(validateSettingsPatch({ maxTradesPerDay: 0 }, "demo").ok).toBe(false);
    expect(validateSettingsPatch({ maxTradesPerDay: 11 }, "demo").ok).toBe(false);
  });

  it("blocks 7th trade when limit is 6", () => {
    const settings = defaultUserAutoTradeSettings("u", "demo");
    settings.maxTradesPerDay = 6;
    const daily = emptyDailySafety("u", "demo");
    daily.tradesUsed = 6;
    const gate = evaluateEntryGates({ settings, daily });
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe("DAILY_TRADE_LIMIT");
  });

  it("allows 6th trade when limit is 6", () => {
    const settings = defaultUserAutoTradeSettings("u", "demo");
    settings.maxTradesPerDay = 6;
    const daily = emptyDailySafety("u", "demo");
    daily.tradesUsed = 5;
    expect(evaluateEntryGates({ settings, daily }).allowed).toBe(true);
  });

  it("blocks on consecutive losses and cooldown", () => {
    const settings = defaultUserAutoTradeSettings("u", "demo");
    settings.pauseAfterConsecutiveLosses = 3;
    settings.tradeCooldownMinutes = 30;
    const daily = emptyDailySafety("u", "demo");
    daily.consecutiveLosses = 3;
    expect(evaluateEntryGates({ settings, daily }).code).toBe("CONSECUTIVE_LOSS_PAUSE");
    daily.consecutiveLosses = 0;
    daily.cooldownUntil = new Date(Date.now() + 60_000).toISOString();
    expect(evaluateEntryGates({ settings, daily }).code).toBe("COOLDOWN_ACTIVE");
  });

  it("WAIT does not pass candidate gates", () => {
    const r = evaluateQualificationCandidate({
      direction: "WAIT",
      signalId: "s1",
      entry: 1,
      stopLoss: 0.9,
      takeProfit: 1.2,
      confidence: 90,
      minConfidence: 80,
      quoteBid: 1,
      quoteAsk: 1.01,
      quoteSpread: 0.1,
      quoteStale: false,
      marketStatus: "OPEN",
      maxSpread: 2,
      maxQuoteAgeSeconds: 30,
      quoteAgeSeconds: 1,
      alreadyCountedSignal: false
    });
    expect(r.ok).toBe(false);
    expect(r.failed).toContain("NOT_ACTIONABLE");
  });

  it("rejects RR below minimum", () => {
    const r = evaluateQualificationCandidate({
      direction: "BUY",
      signalId: "s2",
      entry: 100,
      stopLoss: 99,
      takeProfit: 100.5,
      confidence: 90,
      minConfidence: 80,
      minRiskReward: 2,
      quoteBid: 100,
      quoteAsk: 100.1,
      quoteSpread: 0.1,
      quoteStale: false,
      marketStatus: "OPEN",
      maxSpread: 2,
      maxQuoteAgeSeconds: 30,
      quoteAgeSeconds: 1,
      alreadyCountedSignal: false
    });
    expect(r.ok).toBe(false);
    expect(r.failed).toContain("RR_TOO_LOW");
  });

  it("session filter blocks when session not allowed", () => {
    const r = sessionAllowed(["Asia"], new Date("2026-08-08T18:00:00.000Z"));
    expect(r.ok).toBe(false);
  });
});
