import { describe, expect, it } from "vitest";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import { applyStablePlanToIntraday } from "./sessionPlanBridge";

describe("sessionPlanBridge", () => {
  it("returns null when plan missing", () => {
    expect(applyStablePlanToIntraday(null, { lifecycleState: "ARMED" })).toBeNull();
  });

  it("normalizes 5M confirmation authority when stable plan absent", () => {
    const plan = chartExampleIntradayPlanFixture;
    const next = applyStablePlanToIntraday(plan, null);
    expect(next).not.toBeNull();
    expect(next?.confirmation5m?.state).toBe(plan.confirmation5m.state);
    expect(next?.confirmation5m?.meaningful).toBe(false);
    expect(next?.confirmation5m?.label).toBe("Pending");
    expect(next?.timeframeAlignment?.cells.some((c) => c.timeframe === "5M")).toBe(true);
    // Actionable wait/prepare fixture must not be demoted to NO VALID without geometry failure.
    expect(next?.actionLabel).toBe(plan.actionLabel);
    expect(next?.geometryValid).not.toBe(false);
  });

  it("maps lifecycle, confirmation, and PLAN UNCHANGED from stable plan", () => {
    const merged = applyStablePlanToIntraday(chartExampleIntradayPlanFixture, {
      lifecycleState: "ARMED",
      planStabilityLabel: "PLAN UNCHANGED",
      planMutation: "PLAN_UNCHANGED",
      confirmationState: "BREAKOUT_CONFIRMED",
      fourHourContext: { direction: "BULL", structureState: "BULLISH" },
      higherTimeframeBias: "BULL",
      quoteAgeSeconds: 12
    });
    expect(merged?.planStatus).toBe("ARMED");
    expect(merged?.planUnchanged).toBe(true);
    expect(merged?.confirmation5m?.meaningful).toBe(true);
    expect(merged?.confirmation5m?.state).toBe("BREAKOUT_CONFIRMED");
    expect(merged?.timeframeAlignment?.cells).toHaveLength(4);
    expect(merged?.freshness.quoteAgeSeconds).toBe(12);
  });
});
