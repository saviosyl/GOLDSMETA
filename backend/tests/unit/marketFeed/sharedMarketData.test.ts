import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/broker/ctrader/candleService", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/services/broker/ctrader/candleService")
  >("../../../src/services/broker/ctrader/candleService");
  return {
    ...actual,
    getXauusdCandles: vi.fn()
  };
});

vi.mock("../../../src/services/broker/ctrader/quoteService", () => ({
  getLiveQuoteSnapshot: vi.fn()
}));

import { getXauusdCandles } from "../../../src/services/broker/ctrader/candleService";
import { getLiveQuoteSnapshot } from "../../../src/services/broker/ctrader/quoteService";
import {
  getSharedXauusdCandles,
  getSharedXauusdQuote,
  resolvePinnedMarketOwnerUid
} from "../../../src/services/marketFeed/sharedMarketData";

describe("sharedMarketData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOLDMETA_PINNED_OWNER_UID = "owner-uid-abc";
    delete process.env.CTRADER_QUOTE_OWNER_UID;
  });

  it("resolvePinnedMarketOwnerUid prefers CTRADER_QUOTE_OWNER_UID then pin", () => {
    expect(resolvePinnedMarketOwnerUid({ GOLDMETA_PINNED_OWNER_UID: "pin" })).toBe(
      "pin"
    );
    expect(
      resolvePinnedMarketOwnerUid({
        CTRADER_QUOTE_OWNER_UID: "quote-owner",
        GOLDMETA_PINNED_OWNER_UID: "pin"
      })
    ).toBe("quote-owner");
  });

  it("getSharedXauusdCandles uses pinned owner and shared cache scope", async () => {
    vi.mocked(getXauusdCandles).mockResolvedValue({
      symbol: "XAUUSD",
      timeframe: "M15",
      bars: [
        {
          time: 1_720_000_000,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 10
        }
      ],
      source: "CTRADER_TRENDBARS",
      environment: "LIVE",
      cached: false,
      marketStatus: "CLOSED"
    });

    const out = await getSharedXauusdCandles({ timeframe: "M15", count: 120 });
    expect(getXauusdCandles).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: "owner-uid-abc",
        timeframe: "M15",
        count: 120,
        cacheScope: "shared"
      })
    );
    expect(out.source).toBe("SHARED_CTRADER_TRENDBARS");
    expect(out.bars).toHaveLength(1);
    expect(out.planIndependent).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/owner-uid|accessToken|accountId/i);
  });

  it("getSharedXauusdQuote strips broker account fields", async () => {
    vi.mocked(getLiveQuoteSnapshot).mockResolvedValue({
      available: true,
      quote: {
        symbolId: "41",
        symbolName: "XAUUSD",
        digits: 2,
        pipPosition: 1,
        bid: 2400,
        ask: 2401,
        mid: 2400.5,
        spread: 1,
        brokerTimestamp: "2026-08-08T12:00:00.000Z",
        receivedAt: "2026-08-08T12:00:00.100Z",
        quoteSequence: 9,
        freshness: "MARKET_CLOSED",
        marketStatus: "CLOSED",
        ageMs: 1000,
        executable: false,
        environment: "LIVE"
      },
      label: "Pepperstone cTrader live quote",
      livePriceHealth: "MARKET_CLOSED",
      thresholds: {
        liveMaxAgeMs: 5000,
        delayedMaxAgeMs: 30000
      }
    } as Awaited<ReturnType<typeof getLiveQuoteSnapshot>>);

    const out = await getSharedXauusdQuote();
    expect(getLiveQuoteSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUid: "owner-uid-abc" })
    );
    expect(out.available).toBe(true);
    expect(out.quote?.bid).toBe(2400);
    expect(out.quote?.ask).toBe(2401);
    expect(out.freshness).toBe("MARKET_CLOSED");
    expect(out.marketStatus).toBe("CLOSED");
    expect(out.source).toBe("SHARED_MARKET_QUOTE");
    const raw = JSON.stringify(out);
    expect(raw).not.toMatch(/owner-uid|symbolId|environment|executable/i);
  });
});
