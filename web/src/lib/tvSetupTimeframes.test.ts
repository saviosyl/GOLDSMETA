import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEFRAME_FOR_ROLE,
  isValidTvTimeframe,
  mergeTimeframeOptions,
  normalizeSelectedTimeframe,
  resolveDefaultTimeframeForRole,
  TV_SETUP_TIMEFRAMES,
  TV_TIMEFRAME_GUIDANCE
} from "./tvSetupTimeframes";

describe("tvSetupTimeframes", () => {
  it("maps alert roles to default timeframes", () => {
    expect(DEFAULT_TIMEFRAME_FOR_ROLE.PLAN_15M).toBe("15");
    expect(DEFAULT_TIMEFRAME_FOR_ROLE.CONFIRM_5M).toBe("5");
    expect(DEFAULT_TIMEFRAME_FOR_ROLE.QUOTE_1M).toBe("1");
    expect(resolveDefaultTimeframeForRole("PLAN_15M")).toBe("15");
    expect(resolveDefaultTimeframeForRole("CONFIRM_5M")).toBe("5");
    expect(resolveDefaultTimeframeForRole("QUOTE_1M")).toBe("1");
  });

  it("exposes 1m 5m 15m 30m 1h 4h choices", () => {
    expect(TV_SETUP_TIMEFRAMES.map((t) => t.shortLabel)).toEqual([
      "1m",
      "5m",
      "15m",
      "30m",
      "1h",
      "4h"
    ]);
  });

  it("keeps canonical options even when template is empty", () => {
    expect(mergeTimeframeOptions(null)).toHaveLength(6);
    expect(mergeTimeframeOptions([])).toHaveLength(6);
  });

  it("normalizes selected timeframe and defaults PLAN_15M to 15", () => {
    expect(normalizeSelectedTimeframe(["15"], "PLAN_15M")).toBe("15");
    expect(normalizeSelectedTimeframe([], "PLAN_15M")).toBe("15");
    expect(normalizeSelectedTimeframe(null, "CONFIRM_5M")).toBe("5");
    expect(isValidTvTimeframe("240")).toBe(true);
    expect(isValidTvTimeframe("7")).toBe(false);
  });

  it("documents chart vs wizard guidance", () => {
    expect(TV_TIMEFRAME_GUIDANCE).toMatch(/setup guidance/i);
    expect(TV_TIMEFRAME_GUIDANCE).toMatch(/TradingView chart/i);
  });
});
