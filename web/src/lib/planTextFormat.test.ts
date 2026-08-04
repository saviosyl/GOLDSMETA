import { describe, expect, it } from "vitest";
import {
  fixJoinedPricesAndSpaces,
  formatLevelWithOptionalPrice,
  isLegacyPlanData,
  isNoValidIntradayPlan,
  sanitizePlanText,
  stripFixtureLabels
} from "./planTextFormat";

describe("planTextFormat", () => {
  it("strips LABELLED FIXTURE and not-live labels", () => {
    const raw =
      "Price is below value. (LABELLED FIXTURE — not live market data) Preview fixture inside-value — not live market data.";
    expect(stripFixtureLabels(raw)).not.toMatch(/LABELLED FIXTURE/i);
    expect(stripFixtureLabels(raw)).not.toMatch(/not live market data/i);
    expect(stripFixtureLabels(raw)).not.toMatch(/preview fixture/i);
    expect(sanitizePlanText(raw)).toMatch(/Price is below value/i);
  });

  it("fixes missing spaces between prices and words", () => {
    expect(fixJoinedPricesAndSpaces("4031.1ends the immediate reclaim attempt")).toBe(
      "4031.1 ends the immediate reclaim attempt"
    );
    expect(sanitizePlanText("Break and hold below 4031.1 ends the immediate reclaim attempt")).toBe(
      "Break and hold below 4031.1 ends the immediate reclaim attempt"
    );
  });

  it("prevents raw+formatted price concatenation", () => {
    expect(fixJoinedPricesAndSpaces("VAL 4037.3084,037.31 is resistance")).toMatch(
      /VAL 4,?037\.31 is resistance/
    );
    expect(sanitizePlanText("4037.3084,037.31")).not.toMatch(/4037\.3084/);
  });

  it("does not append a duplicate price when label already contains it", () => {
    const label = "Reclaim and hold above VAL 4037.308";
    expect(formatLevelWithOptionalPrice(label, 4037.308)).toBe(
      sanitizePlanText(label)
    );
    expect(formatLevelWithOptionalPrice(label, 4037.308)).not.toMatch(/4037\.3084/);
    expect(formatLevelWithOptionalPrice("Entry zone", 4040.5)).toMatch(/4,?040\.50/);
  });

  it("detects NO_VALID_PLAN and LIVE_RANGE_ONLY", () => {
    expect(isNoValidIntradayPlan({ planStatus: "NO_VALID_PLAN" })).toBe(true);
    expect(
      isNoValidIntradayPlan({
        freshness: { marketStructureMode: "LIVE_RANGE_ONLY" }
      })
    ).toBe(true);
    expect(
      isNoValidIntradayPlan({
        planStatus: "ARMED",
        freshness: { marketStructureMode: "COMPLETE" }
      })
    ).toBe(false);
  });

  it("flags legacy plan data when planSourceKey is absent", () => {
    expect(isLegacyPlanData({ planSourceKey: null, freshness: { sourceLabel: "STRATEGY" } })).toBe(
      true
    );
    expect(
      isLegacyPlanData({ planSourceKey: "XAU|LONDON|1|PLAN_15M", freshness: { sourceLabel: "2.1" } })
    ).toBe(false);
  });
});
