import { describe, expect, it } from "vitest";
import {
  evaluatePriceConsistency,
  pricesAreConsistent,
  relativePriceDiff,
  XAUUSD_PRICE_CONSISTENCY_TOLERANCE
} from "../../src/services/snapshot/priceConsistency";
import { evaluateDataQuality } from "../../src/services/snapshot/dataQuality";
import { mergeSnapshot } from "../../src/services/snapshot/mergeSnapshot";
import { evaluateHardGuards } from "../../src/services/decision/hardGuards";
import { freshPayload } from "../helpers";
import strongBuyFixture from "../fixtures/strongBuy.json";
import type { TradePlan } from "../../src/models/types";
import { normalizeSymbolAlias } from "../../src/services/tradingview/standardTemplate";

const emptyPlan: TradePlan = {
  entry: { type: "NONE", price: null, zoneLow: null, zoneHigh: null, condition: null },
  stopLoss: { price: null, reason: null },
  takeProfits: [],
  riskReward: { tp1: null, tp2: null, tp3: null },
  breakeven: {
    state: "NOT_APPLICABLE",
    trigger: null,
    newStop: null,
    reason: null
  },
  earlyExit: { exitNow: false, conditions: [] }
};

describe("priceConsistency", () => {
  it("accepts matching TradingView alert and profile levels (~4050)", () => {
    const result = evaluatePriceConsistency({
      alertClose: 4045.165,
      ohlc: { open: 4044, high: 4048, low: 4042, close: 4045.165 },
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193,
      brokerMid: 4046.1
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("OK");
  });

  it("flags large mismatch between ~4050 alert levels and ~2408 live/OHLC", () => {
    const result = evaluatePriceConsistency({
      alertClose: 4045.165,
      ohlc: { open: 2400, high: 2412, low: 2396, close: 2408 },
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PRICE_SOURCE_MISMATCH");
    expect(result.relativeDiff ?? 0).toBeGreaterThan(XAUUSD_PRICE_CONSISTENCY_TOLERANCE);
  });

  it("flags alertClose vs brokerMid mismatch", () => {
    const result = evaluatePriceConsistency({
      alertClose: 4045.165,
      brokerMid: 2408,
      poc: 4050.951
    });
    expect(result.ok).toBe(false);
    expect(result.mismatchedLevels.some((m) => m.name === "brokerMid")).toBe(true);
  });

  it("allows missing broker mid (optional) when alert/levels agree", () => {
    const result = evaluatePriceConsistency({
      alertClose: 4045.165,
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193,
      brokerMid: null
    });
    expect(result.ok).toBe(true);
    expect(result.brokerMid).toBeNull();
  });

  it("treats missing peer as consistent for pricesAreConsistent", () => {
    expect(pricesAreConsistent(4045, null)).toBe(true);
    expect(relativePriceDiff(4045, 2408)).toBeGreaterThan(0.3);
  });

  it("marks snapshot data quality CONFLICTED on price-source mismatch", () => {
    const payload = freshPayload({
      ...strongBuyFixture,
      exchange: "OANDA",
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 },
      levels: { pocAll: 4050.951, vahAll: 4052.975, valAll: 4047.193 },
      sessionVolumeProfile: {
        ...(strongBuyFixture as { sessionVolumeProfile: Record<string, unknown> }).sessionVolumeProfile,
        poc: 4050.951,
        vah: 4052.975,
        val: 4047.193
      }
    });
    const snapshot = mergeSnapshot(payload);
    const dq = evaluateDataQuality(snapshot);
    expect(dq.quality).toBe("CONFLICTED");
    expect(dq.warnings.some((w) => /PRICE_SOURCE_MISMATCH/i.test(w))).toBe(true);
  });

  it("hard guards block BUY on PRICE_SOURCE_MISMATCH", () => {
    const payload = freshPayload({
      ...strongBuyFixture,
      exchange: "OANDA",
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 },
      levels: { pocAll: 4050.951, vahAll: 4052.975, valAll: 4047.193 },
      sessionVolumeProfile: {
        ...(strongBuyFixture as { sessionVolumeProfile: Record<string, unknown> }).sessionVolumeProfile,
        poc: 4050.951,
        vah: 4052.975,
        val: 4047.193
      }
    });
    const snapshot = mergeSnapshot(payload);
    const dq = evaluateDataQuality(snapshot);
    const guards = evaluateHardGuards(snapshot, "BUY", emptyPlan, dq, 90);
    expect(guards.passed).toBe(false);
    expect(guards.reasonCodes).toContain("PRICE_SOURCE_MISMATCH");
    expect(guards.reasonCodes).toContain("CONFLICTED_DATA");
  });

  it("hard guards block SELL on PRICE_SOURCE_MISMATCH", () => {
    const payload = freshPayload({
      ...strongBuyFixture,
      exchange: "OANDA",
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 },
      levels: { pocAll: 4050.951, vahAll: 4052.975, valAll: 4047.193 },
      sessionVolumeProfile: {
        ...(strongBuyFixture as { sessionVolumeProfile: Record<string, unknown> }).sessionVolumeProfile,
        poc: 4050.951,
        vah: 4052.975,
        val: 4047.193
      }
    });
    const snapshot = mergeSnapshot(payload);
    const dq = evaluateDataQuality(snapshot);
    const guards = evaluateHardGuards(snapshot, "SELL", emptyPlan, dq, 90);
    expect(guards.passed).toBe(false);
    expect(guards.reasonCodes).toContain("PRICE_SOURCE_MISMATCH");
  });

  it("does not treat same-regime test fixture OHLC+levels as mismatch", () => {
    const result = evaluatePriceConsistency({
      alertClose: 2408,
      ohlc: { open: 2400, high: 2412, low: 2396, close: 2408 },
      poc: 2408,
      vah: 2415,
      val: 2400
    });
    expect(result.ok).toBe(true);
  });

  it("marks stale market data as STALE (blocks trading via STALE_DATA)", () => {
    const payload = freshPayload({
      ...strongBuyFixture,
      exchange: "OANDA"
    });
    const snapshot = mergeSnapshot(payload);
    // Force an old marketDataTime
    snapshot.marketDataTime = "2020-01-01T00:00:00.000Z";
    const dq = evaluateDataQuality(snapshot, Date.now());
    expect(dq.quality).toBe("STALE");
    const guards = evaluateHardGuards(snapshot, "BUY", emptyPlan, dq, 90);
    expect(guards.passed).toBe(false);
    expect(guards.reasonCodes).toContain("STALE_DATA");
  });

  it("rejects unsupported symbol aliases (wrong symbol)", () => {
    expect(normalizeSymbolAlias("EURUSD")).toBeNull();
    expect(normalizeSymbolAlias("OANDA:XAUUSD")).toBe("XAUUSD");
    expect(normalizeSymbolAlias("GOLD")).toBe("XAUUSD");
  });

  it("flags wrong exchange feed when TEST_FIXTURE leaks into non-TEST alert", () => {
    const payload = freshPayload({
      ...strongBuyFixture,
      eventType: "BAR_CLOSE",
      exchange: "TEST_FIXTURE",
      metadata: {
        source: "goldmeta-api-test-fixture",
        fixtureLabel: "TEST FIXTURE — NOT LIVE BROKER DATA"
      }
    });
    const snapshot = mergeSnapshot(payload);
    const dq = evaluateDataQuality(snapshot);
    expect(dq.quality).toBe("CONFLICTED");
    expect(dq.warnings).toContain("TEST_FIXTURE_LEAK");
    const guards = evaluateHardGuards(snapshot, "BUY", emptyPlan, dq, 90);
    expect(guards.passed).toBe(false);
    expect(guards.reasonCodes).toContain("CONFLICTED_DATA");
  });

  it("allows labelled TEST fixture exchange on TEST eventType", () => {
    const payload = freshPayload({
      ...strongBuyFixture,
      eventType: "TEST",
      exchange: "TEST_FIXTURE",
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 },
      levels: { pocAll: 2408, vahAll: 2415, valAll: 2400 },
      sessionVolumeProfile: {
        ...(strongBuyFixture as { sessionVolumeProfile: Record<string, unknown> }).sessionVolumeProfile,
        poc: 2408,
        vah: 2415,
        val: 2400
      },
      metadata: {
        source: "goldmeta-api-test-fixture",
        fixtureLabel: "TEST FIXTURE — NOT LIVE BROKER DATA"
      }
    });
    const snapshot = mergeSnapshot(payload);
    const dq = evaluateDataQuality(snapshot);
    expect(dq.quality).not.toBe("CONFLICTED");
    expect(dq.warnings).toContain("TEST_FIXTURE_EXCHANGE");
  });

  it("stores exchange on snapshot for canonical identity", () => {
    const payload = freshPayload({
      ...strongBuyFixture,
      exchange: "OANDA"
    });
    const snapshot = mergeSnapshot(payload);
    expect(snapshot.symbol).toBe("XAUUSD");
    expect(snapshot.exchange).toBe("OANDA");
    expect(snapshot.metadata?.eventType).toBe("BAR_CLOSE");
  });
});
