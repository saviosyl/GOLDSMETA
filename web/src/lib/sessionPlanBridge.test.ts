import { describe, expect, it } from "vitest";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import { applyStablePlanToIntraday } from "./sessionPlanBridge";

describe("sessionPlanBridge", () => {
  it("returns null when plan missing", () => {
    expect(applyStablePlanToIntraday(null, { lifecycleState: "ARMED" })).toBeNull();
  });

  it("leaves plan unchanged when stable plan absent", () => {
    const plan = chartExampleIntradayPlanFixture;
    expect(applyStablePlanToIntraday(plan, null)).toBe(plan);
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
