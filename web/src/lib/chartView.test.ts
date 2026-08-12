import { describe, expect, it } from "vitest";
import {
  collectLevelPrices,
  computeDefaultLogicalRange,
  computeSpread,
  computeUsefulPriceRange,
  DEFAULT_RIGHT_OFFSET_BARS,
  DEFAULT_VISIBLE_BARS
} from "./chartView";

describe("chartView helpers", () => {
  it("filters non-finite overlay prices", () => {
    expect(
      collectLevelPrices({
        resistance: 2400,
        vah: Number.NaN,
        poc: 2390,
        val: Number.POSITIVE_INFINITY,
        support: null,
        currentPrice: 2395
      })
    ).toEqual([2400, 2390, 2395]);
  });

  it("computes padded vertical range from candles + levels", () => {
    const range = computeUsefulPriceRange(
      [
        { time: 1, open: 100, high: 110, low: 95, close: 105 },
        { time: 2, open: 105, high: 112, low: 104, close: 108 }
      ],
      { currentPrice: 109, support: 94, resistance: 115 },
      0.1
    );
    expect(range).not.toBeNull();
    expect(range!.min).toBeLessThan(94);
    expect(range!.max).toBeGreaterThan(115);
  });

  it("ignores invalid candles when computing range", () => {
    const range = computeUsefulPriceRange(
      [{ time: 1, open: Number.NaN, high: Number.NaN, low: Number.NaN, close: Number.NaN }],
      { currentPrice: 2000 },
      0.1
    );
    expect(range).not.toBeNull();
    expect(range!.min).toBeLessThan(2000);
    expect(range!.max).toBeGreaterThan(2000);
  });

  it("default logical range shows recent bars with right offset", () => {
    const r = computeDefaultLogicalRange(200);
    expect(r).not.toBeNull();
    expect(r!.to).toBe(199 + DEFAULT_RIGHT_OFFSET_BARS);
    expect(r!.to - r!.from).toBeGreaterThanOrEqual(DEFAULT_VISIBLE_BARS);
  });

  it("computes spread only when bid/ask finite", () => {
    expect(computeSpread(100, 100.2)).toBeCloseTo(0.2, 8);
    expect(computeSpread(null, 100)).toBeNull();
    expect(computeSpread(100, Number.NaN)).toBeNull();
  });
});
