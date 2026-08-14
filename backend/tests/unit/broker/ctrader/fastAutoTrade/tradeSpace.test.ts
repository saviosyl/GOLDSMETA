import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  buildFastGeometry,
  evaluateFastAutoTrade,
  forwardTradeBarrier,
  tradeSpaceOk,
  type FastAutoTradeInput
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";

function baseInput(over: Partial<FastAutoTradeInput> = {}): FastAutoTradeInput {
  return {
    nowMs: Date.parse("2026-08-14T11:40:00.000Z"),
    price: 3391.2,
    bid: 3391.15,
    ask: 3391.25,
    spread: 0.1,
    quoteAgeSeconds: 1,
    quoteStale: false,
    marketStatus: "OPEN",
    timeframe: "1",
    ohlcv: {
      open: 3388.4,
      high: 3391.6,
      low: 3388.0,
      close: 3391.2,
      volume: 1400
    },
    priorOhlcv: {
      open: 3387.6,
      high: 3388.8,
      low: 3387.2,
      close: 3388.3,
      volume: 900
    },
    trendDirection: "BULLISH",
    trendStrength: 62,
    htfBias: "BULLISH",
    vwap: 3390.3,
    ema21: 3390.1,
    ema50: 3389.4,
    atr: 2.4,
    poc: 3390.4,
    vah: 3390.0,
    val: 3384.0,
    nearbyResistance: 3390.0,
    nearbySupport: 3384.0,
    marketRegimeHint: "TRENDING_UP",
    setupScore: 84,
    v3Decision: "BUY",
    bullishEvidence: ["breakout", "impulse"],
    bearishEvidence: [],
    reasonCodes: ["TREND_BULLISH"],
    confirmationClassification: "BREAKOUT",
    confirmationDirection: "BULLISH",
    dataQuality: "GOOD",
    sessionPlanState: null,
    safety: {
      accountIsLive: false,
      accountEnvironment: "DEMO",
      spreadLimit: 2,
      maxQuoteAgeSeconds: 15,
      dailyLossBreached: false,
      maxOpenReached: false,
      newsBlocked: false,
      disconnected: false,
      duplicateActiveOrder: false,
      riskLimitBreached: false
    },
    reentry: {
      lastSetup: null,
      lastExitAtMs: null,
      lastSignalKey: null,
      currentCandleKey: null,
      lastAction: null,
      lastActionAtMs: null
    },
    lifecycle: { state: "SCANNING", stateEnteredAtMs: Date.parse("2026-08-14T11:40:00.000Z") },
    requireCompletedM1: true,
    m1Availability: "OK",
    m1CompletedAtMs: Date.parse("2026-08-14T11:39:00.000Z"),
    ...over
  };
}

describe("FAST_AUTOTRADE_V1 forward trade-space", () => {
  it("BUY breakout above VAH does not fail solely because old VAH is behind price", () => {
    const input = baseInput();
    expect(forwardTradeBarrier(input, "BUY")).toBeNull();
    expect(tradeSpaceOk(input, "BUY", 2.4, DEFAULT_FAST_AUTOTRADE_CONFIG)).toBe(true);

    const d = evaluateFastAutoTrade(input);
    expect(d.waitReason).not.toBe("WAIT_NO_TRADE_SPACE");
    expect(d.extended).toBe(false);
    expect(d.tradeSpaceOk).toBe(true);
    expect(d.regime).toBe("FAST");
    expect(d.bias).toBe("BULLISH");
    expect(d.setupType).toBe("BREAKOUT");
    expect(d.trigger).toBe("BULLISH_BREAKOUT");
    expect(d.action).toBe("BUY");
    expect(d.geometry).not.toBeNull();
    expect(d.geometry!.takeProfit).toBeGreaterThan(d.geometry!.entry);
  });

  it("SELL breakout below VAL does not fail solely because old VAL is behind price", () => {
    const input = baseInput({
      price: 3378.8,
      bid: 3378.75,
      ask: 3378.85,
      ohlcv: {
        open: 3381.6,
        high: 3382.0,
        low: 3378.4,
        close: 3378.8,
        volume: 1300
      },
      priorOhlcv: {
        open: 3382.2,
        high: 3383.0,
        low: 3381.4,
        close: 3381.7,
        volume: 800
      },
      trendDirection: "BEARISH",
      htfBias: "BEARISH",
      marketRegimeHint: "TRENDING_DOWN",
      vwap: 3379.7,
      ema21: 3379.9,
      ema50: 3380.6,
      poc: 3379.6,
      vah: 3386.0,
      val: 3380.0,
      nearbyResistance: 3386.0,
      nearbySupport: 3380.0,
      v3Decision: "SELL",
      bullishEvidence: [],
      bearishEvidence: ["breakout", "impulse"],
      confirmationDirection: "BEARISH"
    });
    expect(forwardTradeBarrier(input, "SELL")).toBeNull();
    expect(tradeSpaceOk(input, "SELL", 2.4, DEFAULT_FAST_AUTOTRADE_CONFIG)).toBe(true);

    const d = evaluateFastAutoTrade(input);
    expect(d.waitReason).not.toBe("WAIT_NO_TRADE_SPACE");
    expect(d.extended).toBe(false);
    expect(d.tradeSpaceOk).toBe(true);
    expect(d.action).toBe("SELL");
    expect(d.setupType).toBe("BREAKOUT");
    expect(d.trigger).toBe("BEARISH_BREAKOUT");
    expect(d.geometry).not.toBeNull();
    expect(d.geometry!.takeProfit).toBeLessThan(d.geometry!.entry);
  });

  it("genuine resistance ahead too close → WAIT_NO_TRADE_SPACE", () => {
    const input = baseInput({
      price: 3387.4,
      bid: 3387.35,
      ask: 3387.45,
      ohlcv: {
        open: 3385.0,
        high: 3388.2,
        low: 3384.6,
        close: 3387.4,
        volume: 1200
      },
      vwap: 3386.8,
      ema21: 3386.6,
      ema50: 3385.9,
      poc: 3386.9,
      vah: 3398.0,
      nearbyResistance: 3388.0,
      nearbySupport: 3383.8,
      val: 3383.8
    });
    expect(forwardTradeBarrier(input, "BUY")).toBe(3388.0);
    expect(tradeSpaceOk(input, "BUY", 2.4, DEFAULT_FAST_AUTOTRADE_CONFIG)).toBe(false);

    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_NO_TRADE_SPACE");
    expect(d.extended).toBe(false);
    expect(d.tradeSpaceOk).toBe(false);
  });

  it("genuine support ahead too close on SELL → WAIT_NO_TRADE_SPACE", () => {
    const input = baseInput({
      price: 3380.2,
      bid: 3380.15,
      ask: 3380.25,
      ohlcv: {
        open: 3383.4,
        high: 3383.8,
        low: 3379.6,
        close: 3380.2,
        volume: 1100
      },
      trendDirection: "BEARISH",
      htfBias: "BEARISH",
      marketRegimeHint: "TRENDING_DOWN",
      vwap: 3381.0,
      ema21: 3381.2,
      ema50: 3382.0,
      poc: 3381.1,
      vah: 3386.0,
      val: 3370.0,
      nearbyResistance: 3386.0,
      nearbySupport: 3379.6,
      v3Decision: "SELL",
      bullishEvidence: [],
      bearishEvidence: ["breakout"],
      confirmationDirection: "BEARISH"
    });
    expect(forwardTradeBarrier(input, "SELL")).toBe(3379.6);
    expect(tradeSpaceOk(input, "SELL", 2.4, DEFAULT_FAST_AUTOTRADE_CONFIG)).toBe(false);

    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_NO_TRADE_SPACE");
    expect(d.extended).toBe(false);
    expect(d.tradeSpaceOk).toBe(false);
  });

  it("breakout above VAH but excessively extended → WAIT_EXTENDED", () => {
    const input = baseInput({
      price: 3369.2,
      bid: 3369.15,
      ask: 3369.25,
      atr: 5.2,
      ohlcv: {
        open: 3364.0,
        high: 3370.0,
        low: 3363.4,
        close: 3369.2,
        volume: 1600
      },
      vwap: 3349.0,
      ema21: 3349.0,
      ema50: 3348.2,
      poc: 3349.0,
      vah: 3356.0,
      val: 3342.7,
      nearbyResistance: 3356.0,
      nearbySupport: 3342.7
    });
    expect(forwardTradeBarrier(input, "BUY")).toBeNull();
    expect(tradeSpaceOk(input, "BUY", 5.2, DEFAULT_FAST_AUTOTRADE_CONFIG)).toBe(true);

    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_EXTENDED");
    expect(d.extended).toBe(true);
    expect(d.tradeSpaceOk).toBe(true);
    expect(d.setupType).toBe("BREAKOUT");
  });

  it("no next forward barrier → ATR-based target remains valid", () => {
    const input = baseInput();
    const geometry = buildFastGeometry(input, "BUY", "FAST", DEFAULT_FAST_AUTOTRADE_CONFIG);
    expect(geometry).not.toBeNull();
    expect(geometry!.takeProfit).toBeGreaterThan(geometry!.entry);
    expect(geometry!.takeProfit).not.toBe(input.vah);
    expect(geometry!.riskReward).toBeGreaterThanOrEqual(
      DEFAULT_FAST_AUTOTRADE_CONFIG.minRiskReward
    );

    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("BUY");
    expect(d.geometry).not.toBeNull();
    expect(d.geometry!.takeProfit).toBeGreaterThan(d.geometry!.entry);
  });

  it("BUY breakout above VAH does not use a distant VAL for SL when broken VAH is the relevant structure", () => {
    const input = baseInput({
      nearbySupport: 3384.0,
      val: 3384.0,
      vah: 3390.0,
      nearbyResistance: null
    });
    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("BUY");
    expect(d.setupType).toBe("BREAKOUT");
    expect(d.geometry).not.toBeNull();
    expect(d.geometry!.stopLoss).toBeLessThan(d.geometry!.entry);
    expect(d.geometry!.stopLoss).toBeCloseTo(3390.0, 2);
    expect(d.geometry!.stopLoss).toBeGreaterThan(input.val!);
    expect(d.geometry!.entry - d.geometry!.stopLoss).toBeGreaterThanOrEqual(
      input.atr! * 0.35 - 1e-9
    );
  });

  it("SELL breakout below VAL does not use a distant VAH for SL when broken VAL is the relevant structure", () => {
    const input = baseInput({
      price: 3378.8,
      bid: 3378.75,
      ask: 3378.85,
      ohlcv: {
        open: 3381.6,
        high: 3382.0,
        low: 3378.4,
        close: 3378.8,
        volume: 1300
      },
      priorOhlcv: {
        open: 3382.2,
        high: 3383.0,
        low: 3381.4,
        close: 3381.7,
        volume: 800
      },
      trendDirection: "BEARISH",
      htfBias: "BEARISH",
      marketRegimeHint: "TRENDING_DOWN",
      vwap: 3379.7,
      ema21: 3379.9,
      ema50: 3380.6,
      poc: 3379.6,
      vah: 3386.0,
      val: 3380.0,
      nearbyResistance: 3386.0,
      nearbySupport: null,
      v3Decision: "SELL",
      bullishEvidence: [],
      bearishEvidence: ["breakout", "impulse"],
      confirmationDirection: "BEARISH"
    });
    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("SELL");
    expect(d.setupType).toBe("BREAKOUT");
    expect(d.geometry).not.toBeNull();
    expect(d.geometry!.stopLoss).toBeGreaterThan(d.geometry!.entry);
    expect(d.geometry!.stopLoss).toBeCloseTo(3380.0, 2);
    expect(d.geometry!.stopLoss).toBeLessThan(input.vah!);
    expect(d.geometry!.stopLoss - d.geometry!.entry).toBeGreaterThanOrEqual(
      input.atr! * 0.35 - 1e-9
    );
  });
});
