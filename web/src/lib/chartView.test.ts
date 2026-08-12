import { describe, expect, it } from "vitest";
import {
  collectLevelPrices,
  computeDefaultLogicalRange,
  computeFitPriceRange,
  computeSpread,
  computeUsefulPriceRange,
  DEFAULT_RIGHT_OFFSET_BARS,
  DEFAULT_VISIBLE_BARS,
  selectCandlesForLogicalRange,
  selectRecentCandles
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

  it("Fit vertical range ignores hidden oldest outlier spikes", () => {
    const bars = Array.from({ length: 120 }, (_, i) => ({
      time: i,
      open: 2350,
      high: 2351,
      low: 2349,
      close: 2350
    }));
    // Extreme spike only in the oldest 30 bars (hidden by recent-90 Fit).
    for (let i = 0; i < 30; i++) {
      bars[i] = { time: i, open: 1000, high: 5000, low: 500, close: 1000 };
    }
    const allRange = computeUsefulPriceRange(bars, { currentPrice: 2350 });
    const fitRange = computeFitPriceRange(bars, {
      currentPrice: 2350,
      poc: 2350.5,
      support: 2348
    });
    expect(selectRecentCandles(bars, 90)).toHaveLength(90);
    expect(allRange!.max).toBeGreaterThan(4000);
    expect(fitRange).not.toBeNull();
    // Recent band ~2348–2351 — must not be dominated by the 5000 spike.
    expect(fitRange!.max).toBeLessThan(2400);
    expect(fitRange!.min).toBeGreaterThan(2300);
  });

  it("logical-range slice matches visible window", () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({
      time: i,
      open: i,
      high: i + 1,
      low: i - 1,
      close: i
    }));
    const slice = selectCandlesForLogicalRange(bars, 7, 9);
    expect(slice.map((b) => b.time)).toEqual([7, 8, 9]);
  });

  it("computes spread only when bid/ask finite", () => {
    expect(computeSpread(100, 100.2)).toBeCloseTo(0.2, 8);
    expect(computeSpread(null, 100)).toBeNull();
    expect(computeSpread(100, Number.NaN)).toBeNull();
  });
});
