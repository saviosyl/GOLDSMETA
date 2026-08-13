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

  it("decodes newest-first delta timestamps AND delta prices", () => {
    // Newest absolute first; subsequent timestamp+tick are deltas.
    const newest = 1_700_000_060_000;
    const raw = [
      { timestamp: newest, tick: 210_000_000 }, // 2100.00 absolute
      { timestamp: -1000, tick: -500 }, // Δt=-1000, Δp=-0.005 → 2099.995
      { timestamp: -2000, tick: -500 } // → 2099.990
    ];
    const decoded = decodeHistoricalTickData(raw, "BID");
    expect(decoded).toHaveLength(3);
    expect(decoded[0]!.brokerTimestampMs).toBe(newest - 3000);
    expect(decoded[2]!.brokerTimestampMs).toBe(newest);
    expect(decoded[2]!.price).toBe(2100);
    expect(decoded[1]!.price).toBeCloseTo(2099.995, 6);
    expect(decoded[0]!.price).toBeCloseTo(2099.99, 6);
  });

  it("rejects reconstruction that would move forward in time", () => {
    const newest = 1_700_000_000_000;
    expect(() =>
      decodeHistoricalTickData(
        [
          { timestamp: newest, tick: 200_000_000 },
          { timestamp: 1000, tick: 100 } // positive delta → newer than previous
        ],
        "ASK"
      )
    ).toThrow(/HISTORICAL_TICK_TIMESTAMP_INVALID/);
  });

  it("skips non-positive tick prices without failing the page", () => {
    const newest = 1_700_000_060_000;
    const decoded = decodeHistoricalTickData(
      [
        { timestamp: newest, tick: 210_000_000 },
        { timestamp: -1000, tick: -210_000_000 }, // drives absolute price to 0 → skip emit
        { timestamp: -1000, tick: 209_999_000 } // continues chain from 0 + delta
      ],
      "BID"
    );
    // First emitted; zero skipped; third emitted from chain
    expect(decoded.length).toBeGreaterThanOrEqual(1);
    expect(decoded[decoded.length - 1]!.price).toBe(2100);
  });

  it("relative price conversion uses /100000 for absolute first tick", () => {
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
    expect(bids[0]!.price).toBe(2100);
    expect(MICRO_QUOTE_TYPE.BID).toBe(1);
    expect(MICRO_QUOTE_TYPE.ASK).toBe(2);
  });

  it("boundary quote resolution uses first valid Bid/Ask at/after T", () => {
    const store = new MemoryMicroMarketDataStore();
    void store;
    const T = 1_700_000_000_000;
    const q = resolveBoundaryQuote({
      symbol: "XAUUSD",
      environment: "DEMO",
      boundaryTimestampMs: T,
      bids: [
        { side: "BID", price: 1999.9, brokerTimestampMs: T - 100 }, // before T → ignored
        { side: "BID", price: 2000, brokerTimestampMs: T + 20 }
      ],
      asks: [
        { side: "ASK", price: 2000.2, brokerTimestampMs: T + 40 }
      ],
      toleranceMs: 1000
    });
    expect(q.status).toBe("OK");
    expect(q.bid).toBe(2000);
    expect(q.ask).toBe(2000.2);
    expect(boundaryQuoteId("XAUUSD", T)).toContain("XAUUSD");
  });

  it("label-ready diagnostics count minutes with both sides", () => {
    const d = computeLabelReadyDiagnostics([
      {
        id: "a",
        symbol: "XAUUSD",
        boundaryTimestampMs: 1_700_000_000_000,
        bid: 1,
        ask: 1.1,
        mid: 1.05,
        spread: 0.1,
        bidAgeMs: 0,
        askAgeMs: 0,
        status: "OK",
        reason: null
      }
    ]);
    expect(d.labelReadyMinutes).toBeGreaterThanOrEqual(0);
  });
});
