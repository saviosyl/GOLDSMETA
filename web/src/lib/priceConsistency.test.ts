import { describe, expect, it } from "vitest";
import {
  detectLadderPriceMismatch,
  livePriceLabel,
  pricesAreConsistent,
  relativePriceDiff,
  XAUUSD_PRICE_CONSISTENCY_TOLERANCE
} from "./priceConsistency";
import {
  buildMarketLevelLadderDetailed,
  nearestLevels
} from "./marketLadder";

describe("priceConsistency (web)", () => {
  it("accepts matching ~4050 TradingView and stored levels", () => {
    expect(
      pricesAreConsistent(4045.165, 4050.951, XAUUSD_PRICE_CONSISTENCY_TOLERANCE)
    ).toBe(true);
    const mismatch = detectLadderPriceMismatch({
      livePrice: 4045.165,
      alertClose: 4045.165,
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193,
      barHigh: 4048,
      barLow: 4042
    });
    expect(mismatch).toBeNull();
  });

  it("detects large mismatch between ~4050 levels and ~2408 live price", () => {
    const mismatch = detectLadderPriceMismatch({
      livePrice: 2408,
      alertClose: 4045.165,
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193,
      barHigh: 2412,
      barLow: 2396
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch!.alertClose).toBeCloseTo(4045.165, 2);
    expect(mismatch!.comparisonPrice).toBeCloseTo(2408, 2);
    expect(mismatch!.relativeDiff).toBeGreaterThan(0.3);
    expect(mismatch!.message).toContain("Market data mismatch");
  });

  it("ladder returns empty rows and mismatch state on conflict", () => {
    const result = buildMarketLevelLadderDetailed({
      livePrice: 2408,
      alertClose: 4045.165,
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193,
      barHigh: 2412,
      barLow: 2396,
      dataSourceLabel: "LIVE"
    });
    expect(result.rows).toEqual([]);
    expect(result.mismatch).not.toBeNull();
  });

  it("does not label LIVE PRICE for test fixtures", () => {
    expect(
      livePriceLabel({ dataSourceLabel: "TEST", isTestDecision: true })
    ).toBe("Test fixture price");
    expect(livePriceLabel({ dataSourceLabel: "MOCK" })).toBe("Test fixture price");
  });

  it("labels Last stored price when stale or market closed", () => {
    expect(livePriceLabel({ dataSourceLabel: "STALE" })).toBe("Last stored price");
    expect(
      livePriceLabel({ dataSourceLabel: "LIVE", marketStatus: "CLOSED" })
    ).toBe("Last stored price");
    expect(
      livePriceLabel({
        dataSourceLabel: "LIVE",
        marketDataTime: "2020-01-01T00:00:00.000Z"
      })
    ).toBe("Last stored price");
  });

  it("labels Unavailable when source is unknown", () => {
    expect(livePriceLabel({})).toBe("Unavailable");
  });

  it("labels LIVE PRICE only for verified fresh LIVE source", () => {
    expect(
      livePriceLabel({
        dataSourceLabel: "LIVE",
        marketDataTime: new Date().toISOString(),
        brokerQuoteVerified: true,
        marketStatus: "OPEN"
      })
    ).toBe("LIVE PRICE");
  });

  it("allows LIVE PRICE on labelled UI-review fixture only", () => {
    expect(livePriceLabel({ isUiReviewFixture: true, dataSourceLabel: "TEST" })).toBe(
      "LIVE PRICE"
    );
  });

  it("does not silently combine fixture OHLC with live alert levels in ladder", () => {
    const result = buildMarketLevelLadderDetailed({
      livePrice: 2408,
      barHigh: 2412,
      barLow: 2396,
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193,
      dataSourceLabel: "LIVE",
      isTestDecision: false
    });
    expect(result.mismatch).not.toBeNull();
    expect(result.rows.length).toBe(0);
  });

  it("builds consistent ladder for same-regime prices", () => {
    const result = buildMarketLevelLadderDetailed({
      livePrice: 4045.165,
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193,
      barHigh: 4048,
      barLow: 4042,
      dataSourceLabel: "LIVE",
      marketDataTime: new Date().toISOString(),
      brokerQuoteVerified: true
    });
    expect(result.mismatch).toBeNull();
    expect(result.rows.some((r) => r.kind === "live")).toBe(true);
    expect(result.liveLabel).toBe("LIVE PRICE");
    const { resistance, support } = nearestLevels(result.rows);
    expect(resistance?.price).toBeGreaterThan(4045);
    expect(support?.price).toBeLessThan(4045);
  });

  it("relative diff between 4045 and 2408 exceeds tolerance", () => {
    expect(relativePriceDiff(4045.165, 2408)).toBeGreaterThan(
      XAUUSD_PRICE_CONSISTENCY_TOLERANCE
    );
  });
});
