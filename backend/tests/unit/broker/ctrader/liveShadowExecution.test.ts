import { describe, expect, it, beforeEach } from "vitest";
import {
  isCTraderLiveEnabled,
  isCTraderLiveExecutionOwnerApproved,
  isCTraderLiveShadowEnabled
} from "../../../../src/services/broker/ctrader/flags";
import { buildIntentKey } from "../../../../src/services/broker/ctrader/preview";
import { lotsToOrderVolumeUnits } from "../../../../src/services/broker/ctrader/volumeUnits";
import {
  validateStopTpLadder,
  resolveRiskFromSettings,
  extractPlanSnapshot
} from "../../../../src/services/broker/ctrader/liveShadowExecution";
import type { DecisionRecord } from "../../../../src/models/types";

describe("LIVE shadow flags / hard locks", () => {
  beforeEach(() => {
    delete process.env.CTRADER_LIVE_SHADOW_ENABLED;
    delete process.env.CTRADER_LIVE_ENABLED;
  });

  it("keeps isCTraderLiveEnabled hard-false even when env tries true", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(
      isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("keeps owner-approval latch hard-false", () => {
    expect(isCTraderLiveExecutionOwnerApproved()).toBe(false);
    expect(
      isCTraderLiveExecutionOwnerApproved({
        CTRADER_LIVE_EXECUTION_OWNER_APPROVED: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("enables shadow only via CTRADER_LIVE_SHADOW_ENABLED", () => {
    expect(isCTraderLiveShadowEnabled()).toBe(false);
    expect(
      isCTraderLiveShadowEnabled({
        CTRADER_LIVE_SHADOW_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });
});

describe("LIVE shadow order payload math", () => {
  it("converts lots to protocol volume units (100 cents = 1.00 lot)", () => {
    expect(lotsToOrderVolumeUnits(0.01)).toBe(1);
    expect(lotsToOrderVolumeUnits(1)).toBe(100);
  });

  it("builds stable intent keys for duplicate prevention", () => {
    const a = buildIntentKey({
      ownerUid: "u1",
      broker: "pepperstone_ctrader",
      accountId: "12345606",
      environment: "LIVE",
      decisionId: "d1",
      symbolId: "41",
      action: "BUY"
    });
    const b = buildIntentKey({
      ownerUid: "u1",
      broker: "pepperstone_ctrader",
      accountId: "12345606",
      environment: "LIVE",
      decisionId: "d1",
      symbolId: "41",
      action: "BUY"
    });
    const c = buildIntentKey({
      ownerUid: "u1",
      broker: "pepperstone_ctrader",
      accountId: "12345606",
      environment: "LIVE",
      decisionId: "d2",
      symbolId: "41",
      action: "BUY"
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("TP ladder validation (no repair)", () => {
  it("blocks BUY when TP1 is below executable entry (example 4307.75 / 4306.43)", () => {
    const failed = validateStopTpLadder({
      side: "BUY",
      entry: 4307.75,
      stopLoss: 4293.19,
      takeProfit1: 4306.43,
      takeProfit2: null,
      takeProfit3: null
    });
    expect(failed).toContain("TP_ORDERING_INVALID");
  });

  it("accepts BUY with SL < entry < TP1 < TP2 < TP3", () => {
    const failed = validateStopTpLadder({
      side: "BUY",
      entry: 4300,
      stopLoss: 4290,
      takeProfit1: 4310,
      takeProfit2: 4320,
      takeProfit3: 4330
    });
    expect(failed).toEqual([]);
  });

  it("accepts SELL with SL > entry > TP1 > TP2 > TP3", () => {
    const failed = validateStopTpLadder({
      side: "SELL",
      entry: 4300,
      stopLoss: 4310,
      takeProfit1: 4290,
      takeProfit2: 4280,
      takeProfit3: 4270
    });
    expect(failed).toEqual([]);
  });

  it("blocks SELL when TP1 is above executable entry", () => {
    const failed = validateStopTpLadder({
      side: "SELL",
      entry: 4300,
      stopLoss: 4310,
      takeProfit1: 4305,
      takeProfit2: null,
      takeProfit3: null
    });
    expect(failed).toContain("TP_ORDERING_INVALID");
  });

  it("extracts originating plan values without modification", () => {
    const decision = {
      decisionId: "d1",
      confidence: 88,
      confidenceLabel: "HIGH",
      setupScore: 72,
      generatedAt: "2026-08-07T09:00:00.000Z",
      entry: { price: 4307.75 },
      stopLoss: { price: 4293.19 },
      takeProfits: [
        { label: "TP1", price: 4306.43, reason: "r1" },
        { label: "TP2", price: 4320, reason: "r2" }
      ]
    } as unknown as DecisionRecord;
    const plan = extractPlanSnapshot(decision);
    expect(plan.plannedEntry).toBe(4307.75);
    expect(plan.stopLoss).toBe(4293.19);
    expect(plan.takeProfit1).toBe(4306.43);
    expect(plan.takeProfit2).toBe(4320);
    expect(plan.takeProfit3).toBeNull();
  });
});

describe("risk configuration", () => {
  it("returns RISK_CONFIGURATION_MISSING when both fixed and percent absent", () => {
    const r = resolveRiskFromSettings({
      fixedRiskAmount: null,
      percentageRisk: null,
      equity: 1000,
      sizingMode: "automatic_risk"
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("RISK_CONFIGURATION_MISSING");
  });

  it("uses existing fixedRiskAmount as cash risk", () => {
    const r = resolveRiskFromSettings({
      fixedRiskAmount: 20,
      percentageRisk: 0.5,
      equity: 10000,
      sizingMode: "automatic_risk"
    });
    expect(r.ok).toBe(true);
    expect(r.riskAmount).toBe(20);
    expect(r.riskPercent).toBe(0.5);
    expect(r.maxCashRisk).toBe(20);
  });
});
