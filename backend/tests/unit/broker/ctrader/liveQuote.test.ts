import { describe, expect, it } from "vitest";
import {
  assertBidAskOrder,
  buildAuthoritativeQuote,
  computeMid,
  computeSpread,
  executableEntryPrice,
  isQuoteExecutableForAutoTrade,
  loadLiveQuoteThresholds,
  refreshAuthoritativeFreshness,
  resolveQuoteFreshness,
  toBrokerQuote
} from "../../../../src/services/broker/ctrader/liveQuote";

describe("liveQuote freshness + mid", () => {
  it("computes mid as (bid+ask)/2 without mixing sides", () => {
    expect(computeMid(4264.66, 4265.43)).toBeCloseTo(4265.045, 5);
    expect(computeSpread(4264.66, 4265.43)).toBeCloseTo(0.77, 5);
  });

  it("rejects reversed bid/ask", () => {
    expect(() => assertBidAskOrder(100, 99)).toThrow(/BID_ASK_REVERSED/);
  });

  it("BUY uses ask and SELL uses bid", () => {
    const q = { bid: 10, ask: 12 };
    expect(executableEntryPrice("BUY", q)).toBe(12);
    expect(executableEntryPrice("SELL", q)).toBe(10);
  });

  it("labels LIVE / DELAYED / STALE / MARKET_CLOSED / UNAVAILABLE", () => {
    expect(
      resolveQuoteFreshness({ ageMs: 1_000, marketStatus: "OPEN", hasQuote: true })
    ).toBe("LIVE");
    expect(
      resolveQuoteFreshness({ ageMs: 10_000, marketStatus: "OPEN", hasQuote: true })
    ).toBe("DELAYED");
    expect(
      resolveQuoteFreshness({ ageMs: 60_000, marketStatus: "OPEN", hasQuote: true })
    ).toBe("STALE");
    expect(
      resolveQuoteFreshness({ ageMs: 1_000, marketStatus: "CLOSED", hasQuote: true })
    ).toBe("MARKET_CLOSED");
    expect(
      resolveQuoteFreshness({ ageMs: 0, marketStatus: "OPEN", hasQuote: false })
    ).toBe("UNAVAILABLE");
  });

  it("only LIVE+OPEN quotes are executable for AutoTrade", () => {
    expect(isQuoteExecutableForAutoTrade("LIVE", "OPEN")).toBe(true);
    expect(isQuoteExecutableForAutoTrade("DELAYED", "OPEN")).toBe(false);
    expect(isQuoteExecutableForAutoTrade("STALE", "OPEN")).toBe(false);
    expect(isQuoteExecutableForAutoTrade("LIVE", "CLOSED")).toBe(false);
    expect(isQuoteExecutableForAutoTrade("MARKET_CLOSED", "CLOSED")).toBe(false);
  });

  it("builds authoritative quote with sequence and refreshes freshness over time", () => {
    const now = Date.parse("2026-08-06T12:00:00.000Z");
    const q = buildAuthoritativeQuote({
      symbolId: "41",
      symbolName: "XAUUSD",
      digits: 2,
      pipPosition: 1,
      bid: 4264.66,
      ask: 4265.43,
      brokerTimestamp: new Date(now).toISOString(),
      quoteSequence: 7,
      marketStatus: "OPEN",
      environment: "LIVE",
      nowMs: now
    });
    expect(q.mid).toBeCloseTo(4265.045, 5);
    expect(q.freshness).toBe("LIVE");
    expect(q.executable).toBe(true);
    expect(q.quoteSequence).toBe(7);
    expect(q.symbolId).toBe("41");

    const delayed = refreshAuthoritativeFreshness(q, now + 8_000);
    expect(delayed.freshness).toBe("DELAYED");
    expect(delayed.executable).toBe(false);

    const stale = refreshAuthoritativeFreshness(q, now + 45_000);
    expect(stale.freshness).toBe("STALE");
    expect(toBrokerQuote(stale).stale).toBe(true);
  });

  it("loads configurable freshness thresholds from env", () => {
    const t = loadLiveQuoteThresholds({
      CTRADER_QUOTE_LIVE_MAX_AGE_MS: "2000",
      CTRADER_QUOTE_DELAYED_MAX_AGE_MS: "20000"
    } as NodeJS.ProcessEnv);
    expect(t.liveMaxAgeMs).toBe(2000);
    expect(t.delayedMaxAgeMs).toBe(20000);
  });
});
