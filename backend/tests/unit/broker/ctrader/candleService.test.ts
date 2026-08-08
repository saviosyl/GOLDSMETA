import { describe, expect, it } from "vitest";
import {
  normalizeCandleTimeframe,
  clearCandleCacheForTests,
  classifyCandleFailure
} from "../../../../src/services/broker/ctrader/candleService";
import { parseTrendbarCandles } from "../../../../src/services/broker/ctrader/openApiClient";

describe("normalizeCandleTimeframe", () => {
  it("accepts common aliases", () => {
    expect(normalizeCandleTimeframe("15m")).toBe("M15");
    expect(normalizeCandleTimeframe("M5")).toBe("M5");
    expect(normalizeCandleTimeframe("1H")).toBe("H1");
    expect(normalizeCandleTimeframe("240")).toBe("H4");
    expect(normalizeCandleTimeframe("bad")).toBeNull();
  });
});

describe("classifyCandleFailure", () => {
  it("maps safe diagnostic categories", () => {
    expect(classifyCandleFailure(Object.assign(new Error("x"), { code: "CANDLE_CTRADER_TIMEOUT" }))).toBe(
      "CANDLE_CTRADER_TIMEOUT"
    );
    expect(classifyCandleFailure(Object.assign(new Error("x"), { code: "CANDLE_EMPTY_RESPONSE" }))).toBe(
      "CANDLE_EMPTY_RESPONSE"
    );
    expect(classifyCandleFailure(new Error("ETIMEDOUT"))).toBe("CANDLE_CTRADER_TIMEOUT");
  });
});

describe("parseTrendbarCandles", () => {
  it("converts relative low/deltas into OHLC", () => {
    clearCandleCacheForTests();
    const bars = parseTrendbarCandles([
      {
        volume: 120,
        low: 235_010_000,
        deltaOpen: 10_000,
        deltaClose: 25_000,
        deltaHigh: 40_000,
        utcTimestampInMinutes: 28_000_000
      }
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0].time).toBe(28_000_000 * 60);
    expect(bars[0].low).toBeCloseTo(2350.1, 5);
    expect(bars[0].open).toBeCloseTo(2350.2, 5);
    expect(bars[0].close).toBeCloseTo(2350.35, 5);
    expect(bars[0].high).toBeCloseTo(2350.5, 5);
  });
});
