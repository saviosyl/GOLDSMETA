import { describe, expect, it } from "vitest";
import {
  computeMid,
  freshnessStatusLabel,
  shouldFlushQuoteDisplay
} from "./liveQuote";

describe("liveQuote display helpers", () => {
  it("computes mid correctly", () => {
    expect(computeMid(100, 102)).toBe(101);
  });

  it("maps freshness labels", () => {
    expect(freshnessStatusLabel("LIVE")).toBe("Live");
    expect(freshnessStatusLabel("DELAYED")).toBe("Delayed");
    expect(freshnessStatusLabel("STALE")).toBe("Stale");
    expect(freshnessStatusLabel("MARKET_CLOSED")).toBe("Market closed");
    expect(freshnessStatusLabel("UNAVAILABLE")).toBe("Unavailable");
  });

  it("throttles high-frequency updates but flushes material changes", () => {
    expect(
      shouldFlushQuoteDisplay({
        previousMid: 100,
        nextMid: 100.01,
        lastFlushAt: 1_000,
        nowMs: 1_100,
        throttleMs: 300
      })
    ).toBe(false);

    expect(
      shouldFlushQuoteDisplay({
        previousMid: 100,
        nextMid: 100.01,
        lastFlushAt: 1_000,
        nowMs: 1_400,
        throttleMs: 300
      })
    ).toBe(true);

    expect(
      shouldFlushQuoteDisplay({
        previousMid: 100,
        nextMid: 100.2,
        lastFlushAt: 1_000,
        nowMs: 1_050,
        throttleMs: 300,
        materialChange: 0.05
      })
    ).toBe(true);
  });
});
