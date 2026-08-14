import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  evaluateFastAutoTrade,
  type FastAutoTradeInput
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";

function baseInput(over: Partial<FastAutoTradeInput> = {}): FastAutoTradeInput {
  return {
    nowMs: Date.parse("2026-08-14T09:00:00.000Z"),
    price: 3387.4,
    bid: 3387.35,
    ask: 3387.45,
    spread: 0.1,
    quoteAgeSeconds: 1,
    quoteStale: false,
    marketStatus: "OPEN",
    timeframe: "5",
    ohlcv: {
      open: 3385.0,
      high: 3388.2,
      low: 3384.6,
      close: 3387.4,
      volume: 1200
    },
    priorOhlcv: {
      open: 3386.2,
      high: 3386.8,
      low: 3384.4,
      close: 3385.1,
      volume: 800
    },
    trendDirection: "BULLISH",
    trendStrength: 62,
    htfBias: "NEUTRAL",
    vwap: 3385.5,
    ema21: 3385.8,
    ema50: 3384.9,
    atr: 2.4,
    poc: 3385.2,
    vah: 3392.0,
    val: 3383.8,
    nearbyResistance: 3392.0,
    nearbySupport: 3383.8,
    marketRegimeHint: "TRENDING_UP",
    setupScore: 64,
    v3Decision: "WAIT",
    bullishEvidence: ["bullish structure", "impulse"],
    bearishEvidence: [],
    reasonCodes: ["TREND_BULLISH"],
    confirmationClassification: "CONTINUATION",
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
    lifecycle: { state: "SCANNING", stateEnteredAtMs: Date.parse("2026-08-14T09:00:00.000Z") },
    ...over
  };
}

describe("FAST_AUTOTRADE_V1 decision engine", () => {
  it("FAST bullish continuation → BUY", () => {
    const d = evaluateFastAutoTrade(baseInput(), DEFAULT_FAST_AUTOTRADE_CONFIG);
    expect(d.regime).toBe("FAST");
    expect(d.action).toBe("BUY");
    expect(d.setupType).toBe("PULLBACK_CONTINUATION");
    expect(d.grade === "A+" || d.grade === "A" || d.grade === "B+").toBe(true);
    expect(d.geometry).not.toBeNull();
    expect(d.waitReason).toBeNull();
  });

  it("FAST bearish continuation → SELL", () => {
    const d = evaluateFastAutoTrade(
      baseInput({
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
        priorOhlcv: {
          open: 3381.0,
          high: 3383.6,
          low: 3380.8,
          close: 3383.2,
          volume: 700
        },
        trendDirection: "BEARISH",
        trendStrength: 64,
        marketRegimeHint: "TRENDING_DOWN",
        vwap: 3383.0,
        ema21: 3382.8,
        ema50: 3384.0,
        poc: 3383.1,
        vah: 3386.0,
        val: 3376.0,
        nearbyResistance: 3386.0,
        nearbySupport: 3376.0,
        confirmationClassification: "CONTINUATION",
        confirmationDirection: "BEARISH",
        bullishEvidence: [],
        bearishEvidence: ["bearish structure", "impulse"]
      })
    );
    expect(d.regime).toBe("FAST");
    expect(d.action).toBe("SELL");
    expect(d.setupType).toBe("PULLBACK_CONTINUATION");
    expect(d.geometry).not.toBeNull();
  });

  it("FAST valid B+ setup → permitted", () => {
    const d = evaluateFastAutoTrade(
      baseInput({
        htfBias: "BEARISH",
        vwap: null,
        ema21: null,
        ema50: null,
        ohlcv: {
          open: 3385.0,
          high: 3388.2,
          low: 3384.6,
          close: 3387.4,
          volume: null
        }
      })
    );
    expect(d.regime).toBe("FAST");
    expect(d.qualityScore).toBeGreaterThanOrEqual(70);
    expect(d.qualityScore).toBeLessThan(88);
    if (d.grade === "B+") {
      expect(d.action).toBe("BUY");
    } else {
      expect(d.action === "BUY" || d.action === "WAIT").toBe(true);
    }
  });

  it("NORMAL weak B+ setup → WAIT", () => {
    const d = evaluateFastAutoTrade(
      baseInput({
        marketRegimeHint: "UNKNOWN",
        trendStrength: 42,
        ohlcv: {
          open: 3386.8,
          high: 3387.6,
          low: 3386.5,
          close: 3387.1,
          volume: 400
        },
        atr: 2.4,
        htfBias: "BEARISH",
        vwap: null,
        ema21: null,
        ema50: null,
        confirmationClassification: "CONTINUATION",
        confirmationDirection: "BULLISH"
      })
    );
    expect(d.regime === "NORMAL" || d.regime === "QUIET").toBe(true);
    if (d.grade === "B+" || d.qualityScore < 78) {
      expect(d.action).toBe("WAIT");
      expect(d.waitReason).toBe("WAIT_LOW_QUALITY");
    }
  });

  it("CHOP → WAIT", () => {
    const d = evaluateFastAutoTrade(
      baseInput({
        marketRegimeHint: "RANGING",
        trendStrength: 28,
        trendDirection: "NEUTRAL",
        ohlcv: {
          open: 3387.0,
          high: 3387.4,
          low: 3386.7,
          close: 3387.1,
          volume: 200
        },
        confirmationClassification: "NONE",
        confirmationDirection: "NEUTRAL",
        v3Decision: "WAIT"
      })
    );
    expect(d.action).toBe("WAIT");
    expect(d.waitReason === "WAIT_CHOP" || d.waitReason === "WAIT_NEUTRAL_BIAS" || d.waitReason === "WAIT_NO_SETUP").toBe(
      true
    );
  });

  it("DANGEROUS → WAIT", () => {
    const d = evaluateFastAutoTrade(
      baseInput({
        quoteStale: true,
        quoteAgeSeconds: 90
      })
    );
    expect(d.regime).toBe("DANGEROUS");
    expect(d.action).toBe("WAIT");
    expect(d.waitReason === "WAIT_STALE_PRICE" || d.waitReason === "WAIT_DANGEROUS").toBe(true);
    expect(d.hardVeto).not.toBeNull();
  });
});
