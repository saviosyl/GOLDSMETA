import { describe, expect, it } from "vitest";
import { looksLikeReasonCode, plainReason, plainReasons } from "./reasonCodePlain";

describe("reasonCodePlain", () => {
  it("translates geometry and structure codes", () => {
    expect(plainReason("ENTRY_EQUALS_STOP")).toMatch(/too close/i);
    expect(plainReason("LIVE_RANGE_ONLY")).toMatch(/Observation/i);
    expect(plainReason("PRICE_SOURCE_MISMATCH")).toMatch(/disagree/i);
    expect(plainReasons(["MISSING_REQUIRED_LEVEL", "ZERO_RISK"])).toHaveLength(2);
  });

  it("detects raw reason codes", () => {
    expect(looksLikeReasonCode("STRUCTURE_ONLY_OR_INCOMPLETE_TRADE_PLAN")).toBe(true);
    expect(looksLikeReasonCode("Complete trade levels are not available yet.")).toBe(false);
  });
});
