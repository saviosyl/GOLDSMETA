import { describe, expect, it } from "vitest";
import strategyFixture from "../../fixtures/intradayStrategyPayload.json";
import quoteFixture from "../../fixtures/intradayQuotePayload.json";
import { tradingViewPayloadSchema } from "../../../src/models/types";

describe("intraday TradingView payload examples (Issue #50)", () => {
  it("validates complete STRATEGY sample against tradingViewPayloadSchema", () => {
    const parsed = tradingViewPayloadSchema.safeParse(strategyFixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues));
    }
    expect(parsed.data.metadata?.alertKind).toBe("STRATEGY");
    expect(parsed.data.metadata?.scriptVersion).toBe("2.1.0");
    expect(parsed.data.eventId).toContain("STRATEGY");
    expect(parsed.data.optionalIndicators?.ema21).toBeDefined();
    expect(parsed.data.optionalIndicators?.vwap).toBeDefined();
  });

  it("validates lightweight QUOTE sample (OHLC freshness only)", () => {
    const parsed = tradingViewPayloadSchema.safeParse(quoteFixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues));
    }
    expect(parsed.data.timeframe).toBe("1");
    expect(parsed.data.eventType).toBe("BAR_UPDATE");
    expect(parsed.data.metadata?.alertKind).toBe("QUOTE");
    expect(parsed.data.metadata?.quoteOnly).toBe(true);
    expect(parsed.data.trend).toBeUndefined();
    expect(parsed.data.levels).toBeUndefined();
  });

  it("keeps STRATEGY and QUOTE eventIds distinct for the same bar window", () => {
    expect(strategyFixture.eventId).not.toBe(quoteFixture.eventId);
    expect(strategyFixture.eventId).toContain("|STRATEGY");
    expect(quoteFixture.eventId).toContain("|QUOTE");
  });
});
