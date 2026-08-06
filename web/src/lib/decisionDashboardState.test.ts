import { describe, expect, it } from "vitest";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import { deriveDecisionDashboardState } from "./decisionDashboardState";
import { premiumDecisionChip } from "./premiumDecisionCopy";
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

  it("maps hard conflict with levels to BLOCKED", () => {
    const plan = clonePlan();
    plan.action = "NO_TRADE";
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
    expect(state.mode).toBe("BLOCKED");
    expect(premiumDecisionChip(state, plan)).toBe("BLOCKED");
  });

  it("uses PREPARE BUY chip while awaiting confirmation", () => {
    const plan = clonePlan();
    plan.action = "PREPARE";
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
  });

  it("exposes setup quality label instead of profit probability wording", () => {
    const plan = clonePlan();
    plan.confidence = 74;
    plan.planStatus = "NO_VALID_PLAN";
    plan.geometryValid = false;
    const state = deriveDecisionDashboardState({ plan, livePrice: 4300 });
    expect(state.confidenceLabel).toMatch(/Setup quality:\s*74%/i);
    expect(state.confidenceLabel).toMatch(/Required for ready:\s*80%/i);
  });
});
