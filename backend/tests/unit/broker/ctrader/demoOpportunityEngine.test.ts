import { describe, expect, it } from "vitest";
import {
  applyRiskMultiplier,
  armedWindowMs,
  classifyDemoSetupTier,
  confirmationRequiredForTier,
  demoRiskMultiplier,
  demoSessionPolicyAllows,
  formatOpportunityActivity,
  hasFastDirectionalConfirmation,
  hasMeaningfulStructuralSupport,
  isHardSessionPlanInvalidator,
  isPlanRefreshUnavailableState,
  isValidDemoRiskMultiplier,
  loadDemoOpportunityConfig,
  markPriceForInvalidation,
  resolveExecutionSetupTier
} from "../../../../src/services/broker/ctrader/demoOpportunityEngine";
import {
  isCTraderLiveEnabled,
  isBrokerExecutionEnabled
} from "../../../../src/services/broker/ctrader/flags";

describe("demo opportunity engine", () => {
  it("classifies A+ / A / BELOW from setup score (not win probability)", () => {
    expect(classifyDemoSetupTier(94)).toBe("A_PLUS");
    expect(classifyDemoSetupTier(86)).toBe("A");
    expect(classifyDemoSetupTier(78)).toBe("BELOW");
  });

  it("armed window defaults to 15 minutes (3×5M); bars=6 → 30m", () => {
    expect(armedWindowMs()).toBe(15 * 60 * 1000);
    expect(
      armedWindowMs(
        loadDemoOpportunityConfig({
          DEMO_ARMED_CONFIRMATION_BARS_5M: "6"
        } as NodeJS.ProcessEnv)
      )
    ).toBe(30 * 60 * 1000);
  });

  it("NO_VALID_PLAN is soft refresh; NO_TRADE / INVALIDATED / EXPIRED are hard", () => {
    expect(isPlanRefreshUnavailableState("NO_VALID_PLAN")).toBe(true);
    expect(isPlanRefreshUnavailableState("NO_TRADE")).toBe(false);
    expect(isHardSessionPlanInvalidator("NO_VALID_PLAN")).toBe(false);
    expect(isHardSessionPlanInvalidator("NO_TRADE")).toBe(true);
    expect(isHardSessionPlanInvalidator("INVALIDATED")).toBe(true);
    expect(isHardSessionPlanInvalidator("EXPIRED")).toBe(true);
  });

  it("recognises structural tokens but not as directional confirmation alone", () => {
    expect(hasMeaningfulStructuralSupport(["TREND_AGREEMENT"])).toBe(true);
    expect(
      hasFastDirectionalConfirmation({
        direction: "BUY",
        reasons: ["TREND_AGREEMENT"],
        confirmationClassification: "OUTSIDE_ZONE"
      })
    ).toBe(false);
  });

  it("A+ fast directional confirmation is direction-aware", () => {
    expect(
      hasFastDirectionalConfirmation({
        direction: "BUY",
        reasons: ["MTF_BULLISH", "MARKET_STRUCTURE"],
        confirmationClassification: "BREAKOUT_CONFIRMED"
      })
    ).toBe(true);
    expect(
      hasFastDirectionalConfirmation({
        direction: "SELL",
        reasons: ["MTF_BEARISH"],
        confirmationClassification: "REJECTION_CONFIRMED"
      })
    ).toBe(true);
    expect(
      hasFastDirectionalConfirmation({
        direction: "BUY",
        reasons: ["MTF_BEARISH"],
        confirmationClassification: "REJECTION_CONFIRMED"
      })
    ).toBe(false);
  });

  it("explicit opposite confirmation vetoes fast-confirm despite same-side reasons", () => {
    expect(
      hasFastDirectionalConfirmation({
        direction: "BUY",
        reasons: ["MTF_BULLISH", "TREND_AGREEMENT"],
        confirmationClassification: "BEARISH_REJECTION"
      })
    ).toBe(false);
    expect(
      hasFastDirectionalConfirmation({
        direction: "BUY",
        reasons: ["MTF_BULLISH"],
        confirmationClassification: "BEARISH_CONFIRMED"
      })
    ).toBe(false);
    expect(
      hasFastDirectionalConfirmation({
        direction: "SELL",
        reasons: ["MTF_BEARISH"],
        confirmationClassification: "BULLISH_BREAKOUT"
      })
    ).toBe(false);
    expect(
      hasFastDirectionalConfirmation({
        direction: "SELL",
        reasons: ["MTF_BEARISH"],
        confirmationClassification: "BULLISH_CONFIRMED"
      })
    ).toBe(false);
    // Bare CONFIRMED alone is insufficient without side proof.
    expect(
      hasFastDirectionalConfirmation({
        direction: "BUY",
        reasons: ["TREND_AGREEMENT"],
        confirmationClassification: "CONFIRMED"
      })
    ).toBe(false);
  });

  it("runtime tier config stays consistent; confidence is not a substitute", () => {
    const cfg = loadDemoOpportunityConfig({
      DEMO_A_PLUS_MIN_SCORE: "95",
      DEMO_A_MIN_SCORE: "85"
    } as NodeJS.ProcessEnv);
    expect(classifyDemoSetupTier(90, cfg)).toBe("A");
    expect(
      resolveExecutionSetupTier({
        armedTier: "A",
        setupScore: 90,
        confidence: 99,
        config: cfg
      })
    ).toBe("A");
    expect(
      resolveExecutionSetupTier({
        setupScore: null,
        confidence: 99,
        config: cfg
      })
    ).toBe("BELOW");
    expect(
      confirmationRequiredForTier({
        mode: "ACTIVE_DEMO",
        tier: "A",
        settingConfirmationRequired: false
      })
    ).toBe(true);
  });

  it("risk multipliers: A+ major 1.0, A major 0.75, Asia 0.50; BELOW=0", () => {
    expect(demoRiskMultiplier({ tier: "A_PLUS", session: "London" })).toBe(1);
    expect(demoRiskMultiplier({ tier: "A", session: "NewYork" })).toBe(0.75);
    expect(demoRiskMultiplier({ tier: "A_PLUS", session: "Asia" })).toBe(0.5);
    expect(demoRiskMultiplier({ tier: "A", session: "Asia" })).toBe(0.5);
    expect(demoRiskMultiplier({ tier: "BELOW", session: "London" })).toBe(0);
    expect(applyRiskMultiplier(50, 0.5)).toBe(25);
    expect(isValidDemoRiskMultiplier(0)).toBe(false);
    expect(isValidDemoRiskMultiplier(1.1)).toBe(false);
    expect(applyRiskMultiplier(50, 0)).toBe(0);
  });

  it("loads configurable bounds and rejects inverted A/A+ scores", () => {
    const cfg = loadDemoOpportunityConfig({
      DEMO_OPPORTUNITY_MODE: "ACTIVE_DEMO",
      DEMO_ARMED_CONFIRMATION_BARS_5M: "4",
      DEMO_A_PLUS_MIN_SCORE: "92",
      DEMO_A_MIN_SCORE: "81",
      DEMO_ASIA_EXPERIMENTAL_ENABLED: "true",
      DEMO_RISK_MULT_A_PLUS_MAJOR: "1",
      DEMO_RISK_MULT_A_MAJOR: "0.75",
      DEMO_RISK_MULT_ASIA: "0.5"
    } as NodeJS.ProcessEnv);
    expect(cfg.armedConfirmationBars5m).toBe(4);
    expect(cfg.aPlusMinScore).toBe(92);
    expect(cfg.aMinScore).toBe(81);

    const bad = loadDemoOpportunityConfig({
      DEMO_A_PLUS_MIN_SCORE: "70",
      DEMO_A_MIN_SCORE: "90",
      DEMO_RISK_MULT_ASIA: "2"
    } as NodeJS.ProcessEnv);
    expect(bad.aPlusMinScore).toBe(90);
    expect(bad.aMinScore).toBe(80);
    expect(bad.riskMultiplierAsia).toBe(0.5); // >1 rejected → default
  });

  it("Asia ACTIVE_DEMO allows A+/A only", () => {
    const asiaA = demoSessionPolicyAllows({
      mode: "ACTIVE_DEMO",
      allowedSessions: ["London", "NewYork"],
      tier: "A_PLUS",
      now: new Date("2026-08-11T02:00:00.000Z")
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
    expect(asiaBelow.reason).toBe("TIER_BELOW_A");
  });

  it("invalidation mark uses bid for BUY and ask for SELL (not mid)", () => {
    expect(
      markPriceForInvalidation({ direction: "BUY", bid: 3390, ask: 3391 })
    ).toBe(3390);
    expect(
      markPriceForInvalidation({ direction: "SELL", bid: 3390, ask: 3391 })
    ).toBe(3391);
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
  });

  it("Live hard locks remain false", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
  });
});
