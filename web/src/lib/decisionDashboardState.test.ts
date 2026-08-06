import { describe, expect, it } from "vitest";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import { deriveDecisionDashboardState } from "./decisionDashboardState";
import { premiumDecisionChip, premiumStatusLabel } from "./premiumDecisionCopy";
import type { IntradayPlan } from "../types/intradayPlan";

function clonePlan(): IntradayPlan {
  return structuredClone(chartExampleIntradayPlanFixture);
}

describe("deriveDecisionDashboardState forming states", () => {
  it("maps no-valid plan near support to WATCHING", () => {
    const plan = clonePlan();
    plan.planStatus = "NO_VALID_PLAN";
    plan.geometryValid = false;
    plan.action = "NO_TRADE";
    plan.zones = { ...(plan.zones as IntradayPlan["zones"]), nearestSupport: 4265, nearestResistance: 4280 };
    const state = deriveDecisionDashboardState({
      plan,
      marketStructureMode: "LIVE_RANGE_ONLY",
      livePrice: 4266
    });
    expect(state.mode).toBe("WATCHING");
    expect(premiumDecisionChip(state, plan)).toBe("WATCHING");
  });

  it("maps hard conflict below 65% to HOLD (never BLOCKED)", () => {
    const plan = clonePlan();
    plan.action = "NO_TRADE";
    plan.confidence = 55;
    plan.tradePlan = {
      ...plan.tradePlan,
      direction: "BUY",
      entryZone: "4270-4271",
      stopLoss: 4265,
      tp1: 4280
    };
    plan.geometryReasonCodes = ["PRICE_SOURCE_MISMATCH", "HARD_CONFLICT"];
    const state = deriveDecisionDashboardState({
      plan,
      marketStructureMode: "MISMATCH",
      livePrice: 4270
    });
    expect(state.mode).toBe("HOLD");
    expect(premiumDecisionChip(state, plan)).toBe("HOLD");
    expect(premiumStatusLabel(state, plan)).toBe("On hold");
  });

  it("shows BUY at 65%+ even when soft trend disagreement remains", () => {
    const plan = clonePlan();
    plan.action = "PREPARE";
    plan.confidence = 75;
    plan.planStatus = "WAITING_FOR_ENTRY_ZONE";
    plan.geometryValid = true;
    plan.tradePlan = {
      ...plan.tradePlan,
      direction: "BUY",
      entryZone: "4270",
      stopLoss: 4260,
      tp1: 4285,
      actionable: true
    };
    plan.planQuality = {
      ...(plan.planQuality as IntradayPlan["planQuality"]),
      reasons: ["SOFT_DISAGREEMENT"]
    };
    plan.confirmation5m = { state: "PENDING", label: "Pending" } as IntradayPlan["confirmation5m"];
    const state = deriveDecisionDashboardState({
      plan,
      marketStructureMode: "COMPLETE",
      livePrice: 4272
    });
    expect(state.mode).toBe("POTENTIAL_BUY");
    expect(premiumDecisionChip(state, plan)).toBe("BUY");
    expect(state.confidencePercent).toBe(75);
    expect(state.confidenceLabel).toMatch(/75%\s*confidence/i);
    expect(premiumStatusLabel(state, plan)).toBe("Forming");
  });

  it("uses PREPARE BUY chip while awaiting confirmation below 65%", () => {
    const plan = clonePlan();
    plan.action = "PREPARE";
    plan.confidence = 58;
    plan.planStatus = "WAITING_FOR_ENTRY_ZONE";
    plan.geometryValid = true;
    plan.tradePlan = {
      ...plan.tradePlan,
      direction: "BUY",
      entryZone: "4270",
      stopLoss: 4260,
      tp1: 4285,
      actionable: true
    };
    plan.confirmation5m = { state: "PENDING", label: "Pending" } as IntradayPlan["confirmation5m"];
    const state = deriveDecisionDashboardState({
      plan,
      marketStructureMode: "COMPLETE",
      livePrice: 4272
    });
    expect(["POTENTIAL_BUY", "BUY_READY"]).toContain(state.mode);
    const chip = premiumDecisionChip(state, plan);
    expect(["PREPARE BUY", "BUY"]).toContain(chip);
    expect(chip).toBe("PREPARE BUY");
  });

  it("exposes confidence percent label for the hero", () => {
    const plan = clonePlan();
    plan.confidence = 74;
    plan.planStatus = "NO_VALID_PLAN";
    plan.geometryValid = false;
    const state = deriveDecisionDashboardState({ plan, livePrice: 4300 });
    expect(state.confidenceLabel).toMatch(/74%\s*confidence/i);
    expect(state.confidencePercent).toBe(74);
  });
});
