import { describe, expect, it } from "vitest";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import {
  classifyRangeLocation,
  dayTradeGuidance,
  nearestDecisionLevels,
  nextDecisionModeMessage,
  rangeConfidenceBand,
  rangeDataModeLabel,
  rangeLocationLabel,
  rangeStatusBadge
} from "./rangeMapHelpers";

const base = chartExampleIntradayPlanFixture.expectedRange;

describe("rangeMapHelpers", () => {
  it("classifies inside / near edges / outside from verified prices", () => {
    expect(classifyRangeLocation(base)).toBe("inside_probable_range");
    expect(
      classifyRangeLocation({ ...base, currentPrice: base.probableLow! + 0.2 })
    ).toBe("near_probable_low");
    expect(
      classifyRangeLocation({ ...base, currentPrice: base.probableHigh! - 0.2 })
    ).toBe("near_probable_high");
    expect(
      classifyRangeLocation({ ...base, currentPrice: base.probableLow! - 5 })
    ).toBe("below_range");
    expect(
      classifyRangeLocation({ ...base, currentPrice: base.probableHigh! + 5 })
    ).toBe("above_range");
    expect(
      classifyRangeLocation({ ...base, rangeAvailable: false, currentPrice: null })
    ).toBe("unknown");
  });

  it("maps confidence and data mode labels", () => {
    expect(rangeConfidenceBand(80)).toBe("High");
    expect(rangeConfidenceBand(58)).toBe("Moderate");
    expect(rangeConfidenceBand(30)).toBe("Low");
    expect(rangeDataModeLabel("COMPLETE")).toBe("Complete structure");
    expect(rangeDataModeLabel("LIVE_RANGE_ONLY")).toBe("Live range only");
    expect(rangeDataModeLabel("MISMATCH")).toBe("Mismatch");
  });

  it("builds guidance and badges without inventing levels", () => {
    expect(
      dayTradeGuidance({
        location: "near_probable_high",
        mode: "COMPLETE",
        rangeAvailable: true
      })
    ).toMatch(/probable high/i);
    expect(
      dayTradeGuidance({
        location: "inside_probable_range",
        mode: "COMPLETE",
        rangeAvailable: true
      })
    ).toMatch(/middle of the range/i);
    expect(
      dayTradeGuidance({
        location: "unknown",
        mode: "LIVE_RANGE_ONLY",
        rangeAvailable: true
      })
    ).toMatch(/observation only/i);
    expect(
      dayTradeGuidance({
        location: "inside_probable_range",
        mode: "MISMATCH",
        rangeAvailable: true
      })
    ).toMatch(/NO TRADE/i);

    expect(
      rangeStatusBadge({
        location: "near_probable_low",
        mode: "COMPLETE",
        rangeAvailable: true,
        remainingAbovePoints: 5,
        remainingBelowPoints: 1
      })
    ).toBe("Near support");
    expect(
      rangeStatusBadge({
        location: "inside_probable_range",
        mode: "MISMATCH",
        rangeAvailable: true,
        remainingAbovePoints: 2,
        remainingBelowPoints: 2
      })
    ).toBe("No trade");
    expect(rangeLocationLabel("above_range")).toBe("Above range");
  });

  it("uses verified zone nearest levels when present", () => {
    const nearest = nearestDecisionLevels(base, chartExampleIntradayPlanFixture.zones);
    expect(nearest.upside).toBe(4037.308);
    expect(nearest.downside).toBe(4031.1);
  });

  it("returns mode messages for Next Decision strip", () => {
    expect(nextDecisionModeMessage("LIVE_RANGE_ONLY")).toMatch(/observation only/i);
    expect(nextDecisionModeMessage("MISMATCH")).toMatch(/NO TRADE/i);
    expect(nextDecisionModeMessage("COMPLETE")).toBeNull();
  });
});
