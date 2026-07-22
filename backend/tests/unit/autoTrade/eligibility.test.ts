import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "../../../src/services/autoTrade/eligibility";
import { createDefaultRiskState } from "../../../src/services/autoTrade/riskEngine";
import { FIRST_PILOT_LIMITS } from "../../../src/services/autoTrade/types";

function baseInput(overrides: Record<string, unknown> = {}) {
  const riskState = {
    ...createDefaultRiskState("u1"),
    mode: "IG_DEMO_AUTO" as const
  };
  return {
    decision: "BUY",
    score: 90,
    hasValidatedPlan: true,
    stop: 2380,
    takeProfit: 2400,
    entry: 2385,
    riskReward: 3,
    decisionAgeMs: 1_000,
    marketStatus: "TRADEABLE" as const,
    quoteAgeMs: 500,
    spread: 0.3,
    newsBlackoutActive: false,
    openGoldMetaPositions: 0,
    conflictingPosition: false,
    brokerHealthy: true,
    session: "LONDON" as const,
    riskState,
    limits: FIRST_PILOT_LIMITS,
    ...overrides
  };
}

describe("eligibility", () => {
  it("never executes WAIT", () => {
    const r = evaluateEligibility(baseInput({ decision: "WAIT" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/WAIT/);
  });

  it("rejects low score", () => {
    const r = evaluateEligibility(baseInput({ score: 70 }));
    expect(r.ok).toBe(false);
  });

  it("rejects stale quote", () => {
    const r = evaluateEligibility(baseInput({ quoteAgeMs: 120_000 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/stale/i);
  });

  it("rejects closed market", () => {
    const r = evaluateEligibility(baseInput({ marketStatus: "CLOSED" }));
    expect(r.ok).toBe(false);
  });

  it("rejects when locked", () => {
    const riskState = {
      ...createDefaultRiskState("u1"),
      mode: "IG_DEMO_AUTO" as const,
      locked: true,
      lockReason: "emergency_stop"
    };
    const r = evaluateEligibility(baseInput({ riskState }));
    expect(r.ok).toBe(false);
  });

  it("accepts a strong London BUY", () => {
    const r = evaluateEligibility(baseInput());
    expect(r.ok).toBe(true);
  });
});
