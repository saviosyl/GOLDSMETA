import { describe, expect, it } from "vitest";
import {
  assertTickWindowWithinLimit,
  computeLabelReadyDiagnostics,
  decodeHistoricalTickData,
  resolveBoundaryQuote,
  splitIntoTickWindows,
  fetchHistoricalTicksWindow,
  boundaryQuoteId
} from "../../../src/services/microEdge/marketData/historicalTicks";
import { FakeMicroCTraderTransport } from "../../../src/services/microEdge/marketData/microCTraderTransport";
import { MemoryMicroMarketDataStore } from "../../../src/services/microEdge/marketData/marketDataStore";
import { MICRO_QUOTE_TYPE } from "../../../src/services/microEdge/marketData/microCTraderProtocol";
import { MICRO_TRENDBAR_PERIOD } from "../../../src/services/microEdge/marketData/microCTraderProtocol";

describe("Micro historical ticks + boundary quotes", () => {
  it("enforces 7-day max window", () => {
    expect(() =>
      assertTickWindowWithinLimit(0, 604_800_000)
    ).not.toThrow();
    expect(() =>
      assertTickWindowWithinLimit(0, 604_800_001)
    ).toThrow(/7_DAYS|TOO_LARGE/i);
  });

  it("splits ranges into <=1 week windows", () => {
    const wins = splitIntoTickWindows(0, 604_800_000 * 2 + 1000);
    expect(wins.length).toBe(3);
    for (const w of wins) {
      expect(w.toMs - w.fromMs).toBeLessThanOrEqual(604_800_000);
    }
  });

  it("decodes newest-first delta timestamps deterministically", () => {
    // Newest absolute first, then negative deltas toward older ticks.
    const newest = 1_700_000_060_000;
    const raw = [
      { timestamp: newest, tick: 210_000_000 }, // 2100.00
      { timestamp: -1000, tick: 209_999_500 },
      { timestamp: -2000, tick: 209_999_000 }
    ];
    const decoded = decodeHistoricalTickData(raw, "BID");
    expect(decoded).toHaveLength(3);
    expect(decoded[0]!.brokerTimestampMs).toBe(newest - 3000);
    expect(decoded[2]!.brokerTimestampMs).toBe(newest);
    expect(decoded[2]!.price).toBe(2100);
  });

  it("rejects non-newest-first reconstruction that would move forward", () => {
    // After first absolute, a zero-delta same-ms tick is allowed; positive
    // reconstruction that increases time is impossible with abs-subtraction.
    const newest = 1_700_000_000_000;
    const decoded = decodeHistoricalTickData(
      [
        { timestamp: newest, tick: 200_000_000 },
        { timestamp: 1000, tick: 200_000_100 }
      ],
      "ASK"
    );
    expect(decoded[0]!.brokerTimestampMs).toBe(newest - 1000);
    expect(decoded[1]!.brokerTimestampMs).toBe(newest);
  });

  it("relative price conversion uses /100000", () => {
    const decoded = decodeHistoricalTickData(
      [{ timestamp: 1000, tick: 234_567_890 }],
      "BID"
    );
    expect(decoded[0]!.price).toBeCloseTo(2345.6789, 6);
  });

  it("BID/ASK request types and hasMore pagination via fake transport", async () => {
    const fake = new FakeMicroCTraderTransport();
    fake.tickDataBySide.set("BID", [{ timestamp: 1_700_000_000_000, tick: 210_000_000 }]);
    fake.tickDataBySide.set("ASK", [{ timestamp: 1_700_000_000_000, tick: 210_015_000 }]);
    await fake.connect();

    const bids = await fetchHistoricalTicksWindow({
      transport: fake,
      accountId: "123",
      symbolId: "41",
      side: "BID",
      fromMs: 1_700_000_000_000,
      toMs: 1_700_000_000_000 + 60_000
    });
    expect(bids[0]!.side).toBe("BID");
    expect(fake.getTickDataCallCount).toBe(1);

    fake.tickHasMore = false;
    fake.tickDataBySide.set("ASK", [
      { timestamp: 1_700_000_050_000, tick: 210_020_000 },
      { timestamp: 1000, tick: 210_010_000 }
    ]);
    const asks = await fetchHistoricalTicksWindow({
      transport: fake,
      accountId: "123",
      symbolId: "41",
      side: "ASK",
      fromMs: 1_700_000_000_000,
      toMs: 1_700_000_100_000
    });
    expect(asks.length).toBeGreaterThan(0);
    expect(MICRO_QUOTE_TYPE.BID).toBe(1);
    expect(MICRO_QUOTE_TYPE.ASK).toBe(2);
  });

  it("boundary quote: exact / +1s / +5s OK; >5s and missing sides UNSCORABLE", () => {
    const T = 1_700_000_000_000;
    const mk = (side: "BID" | "ASK", ts: number, price: number) => ({
      side,
      price,
      brokerTimestampMs: ts
    });

    const exact = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: T,
      bids: [mk("BID", T, 2100)],
      asks: [mk("ASK", T, 2100.2)],
      environment: "DEMO"
    });
    expect(exact.status).toBe("OK");
    expect(exact.maxSideDelayMs).toBe(0);
    expect(exact.id).toBe(boundaryQuoteId("XAUUSD", T));

    const plus1 = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: T,
      bids: [mk("BID", T + 1000, 2100)],
      asks: [mk("ASK", T + 1000, 2100.2)],
      environment: "DEMO"
    });
    expect(plus1.status).toBe("OK");
    expect(plus1.maxSideDelayMs).toBe(1000);

    const plus5 = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: T,
      bids: [mk("BID", T + 5000, 2100)],
      asks: [mk("ASK", T + 5000, 2100.2)],
      environment: "DEMO"
    });
    expect(plus5.status).toBe("OK");

    const tooLate = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: T,
      bids: [mk("BID", T + 5001, 2100)],
      asks: [mk("ASK", T + 5001, 2100.2)],
      environment: "DEMO"
    });
    expect(tooLate.status).toBe("UNSCORABLE_DATA_GAP");

    // Never use quote BEFORE T
    const before = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: T,
      bids: [mk("BID", T - 1, 2100)],
      asks: [mk("ASK", T, 2100.2)],
      environment: "DEMO"
    });
    expect(before.status).toBe("UNSCORABLE_DATA_GAP");

    const missingAsk = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: T,
      bids: [mk("BID", T, 2100)],
      asks: [],
      environment: "DEMO"
    });
    expect(missingAsk.status).toBe("UNSCORABLE_DATA_GAP");
    // No interpolation fields
    expect(missingAsk.mid).toBeNull();
  });

  it("idempotent boundary quote writes", async () => {
    const store = new MemoryMicroMarketDataStore();
    const q = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: 1_700_000_060_000,
      bids: [{ side: "BID", price: 1, brokerTimestampMs: 1_700_000_060_000 }],
      asks: [{ side: "ASK", price: 1.1, brokerTimestampMs: 1_700_000_060_000 }],
      environment: "DEMO"
    });
    expect(await store.saveBoundaryQuote(q)).toBe("created");
    expect(await store.saveBoundaryQuote(q)).toBe("skipped");
    expect(await store.countBoundaryQuotes()).toBe(1);
  });

  it("label-ready diagnostics", () => {
    const T = 1_700_000_000_000;
    const ok = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: T,
      bids: [{ side: "BID", price: 1, brokerTimestampMs: T + 100 }],
      asks: [{ side: "ASK", price: 1.1, brokerTimestampMs: T + 200 }],
      environment: "DEMO"
    });
    const gap = resolveBoundaryQuote({
      symbol: "XAUUSD",
      boundaryTimestampMs: T + 60_000,
      bids: [],
      asks: [],
      environment: "DEMO"
    });
    const d = computeLabelReadyDiagnostics([ok, gap]);
    expect(d.labelReadyMinutes).toBe(1);
    expect(d.unscorableBoundaryMinutes).toBe(1);
    expect(d.coveragePercent).toBe(50);
    expect(d.medianBoundaryDelayMs).toBe(200);
  });

  it("trendbar period enums remain M1=1 M5=5 M15=7", () => {
    expect(MICRO_TRENDBAR_PERIOD.M1).toBe(1);
    expect(MICRO_TRENDBAR_PERIOD.M5).toBe(5);
    expect(MICRO_TRENDBAR_PERIOD.M15).toBe(7);
  });
});
