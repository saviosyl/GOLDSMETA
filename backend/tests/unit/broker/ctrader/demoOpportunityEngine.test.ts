import { describe, expect, it } from "vitest";
import {
  applyRiskMultiplier,
  armedWindowMs,
  classifyDemoSetupTier,
  demoRiskMultiplier,
  demoSessionPolicyAllows,
  formatOpportunityActivity,
  hasMeaningfulStructuralSupport,
  isHardSessionPlanInvalidator,
  isPlanRefreshUnavailableState
} from "../../../../src/services/broker/ctrader/demoOpportunityEngine";
import { isCTraderLiveEnabled, isBrokerExecutionEnabled } from "../../../../src/services/broker/ctrader/flags";

describe("demo opportunity engine", () => {
  it("classifies A+ / A / BELOW from setup score (not win probability)", () => {
    expect(classifyDemoSetupTier(94)).toBe("A_PLUS");
    expect(classifyDemoSetupTier(86)).toBe("A");
    expect(classifyDemoSetupTier(79)).toBe("BELOW");
  });

  it("armed window defaults to 15 minutes (3×5M)", () => {
    expect(armedWindowMs()).toBe(15 * 60 * 1000);
  });

  it("NO_VALID_PLAN is plan refresh unavailable, not hard invalidator", () => {
    expect(isPlanRefreshUnavailableState("NO_VALID_PLAN")).toBe(true);
    expect(isHardSessionPlanInvalidator("NO_VALID_PLAN")).toBe(false);
    expect(isHardSessionPlanInvalidator("INVALIDATED")).toBe(true);
  });

  it("recognises existing structural reason tokens", () => {
    expect(hasMeaningfulStructuralSupport(["TREND_AGREEMENT", "MTF_BULLISH"])).toBe(true);
    expect(hasMeaningfulStructuralSupport(["noise"])).toBe(false);
  });

  it("risk multipliers: A+ major 1.0, A major 0.75, Asia 0.50", () => {
    expect(demoRiskMultiplier({ tier: "A_PLUS", session: "London" })).toBe(1);
    expect(demoRiskMultiplier({ tier: "A", session: "NewYork" })).toBe(0.75);
    expect(demoRiskMultiplier({ tier: "A_PLUS", session: "Asia" })).toBe(0.5);
    expect(applyRiskMultiplier(50, 0.5)).toBe(25);
  });

  it("Asia ACTIVE_DEMO allows A+/A only", () => {
    const asiaA = demoSessionPolicyAllows({
      mode: "ACTIVE_DEMO",
      allowedSessions: ["London", "NewYork"],
      tier: "A_PLUS",
      now: new Date("2026-08-11T02:00:00.000Z") // Asia UTC
    });
    expect(asiaA.ok).toBe(true);
    expect(asiaA.asiaExperimental).toBe(true);

    const asiaBelow = demoSessionPolicyAllows({
      mode: "ACTIVE_DEMO",
      allowedSessions: ["London", "NewYork"],
      tier: "BELOW",
      now: new Date("2026-08-11T02:00:00.000Z")
    });
    expect(asiaBelow.ok).toBe(false);
  });

  it("formats activity without treating score as probability", () => {
    expect(
      formatOpportunityActivity({
        tier: "A_PLUS",
        direction: "BUY",
        score: 94,
        event: "FAST_CONFIRMATION_SUBMITTED"
      })
    ).toContain("A+ BUY 94/100");
    expect(
      formatOpportunityActivity({
        tier: "A",
        direction: "BUY",
        score: 86,
        event: "ARMED_WAITING",
        barsRemaining: 2
      })
    ).toMatch(/ARMED — waiting 5M confirmation — 2 bars remaining/);
  });

  it("Live hard locks remain false", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
  });
});
