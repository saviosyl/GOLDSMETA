import { describe, expect, it } from "vitest";
import { filterCompletedM1Bars } from "../../../../../src/services/broker/ctrader/fastAutoTrade/completedM1Candles";
import { TRENDBAR_PERIOD } from "../../../../../src/services/broker/ctrader/openApiClient";

describe("FAST completed 1m candles", () => {
  it("reuses Spotware M1 period on the existing trendbar pipeline", () => {
    expect(TRENDBAR_PERIOD.M1).toBe(1);
  });

  it("keeps completed 1m bars and drops the forming bar", () => {
    const nowMs = Date.parse("2026-08-14T09:02:30.000Z");
    const nowSec = Math.floor(nowMs / 1000);
    const bars = [
      { time: nowSec - 180, open: 3384, high: 3385, low: 3383.5, close: 3384.8, volume: 10 },
      { time: nowSec - 120, open: 3384.8, high: 3386, low: 3384.4, close: 3385.1, volume: 12 },
      { time: nowSec - 60, open: 3385.1, high: 3387.4, low: 3384.6, close: 3387.2, volume: 14 },
      { time: nowSec - 10, open: 3387.2, high: 3388, low: 3387, close: 3387.6, volume: 4 }
    ];
    const completed = filterCompletedM1Bars(bars, nowMs);
    expect(completed.map((b) => b.time)).toEqual([nowSec - 180, nowSec - 120, nowSec - 60]);
    expect(completed.at(-1)?.close).toBe(3387.2);
  });
});
