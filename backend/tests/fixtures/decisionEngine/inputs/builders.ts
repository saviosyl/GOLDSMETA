import type { MarketAnalysisInput, OpenPositionInput } from "../../src/services/decisionEngine";

const base = (
  overrides: Partial<MarketAnalysisInput> & {
    candle?: Partial<MarketAnalysisInput["candle"]>;
    trendMeter?: Partial<MarketAnalysisInput["trendMeter"]>;
    confirmationCandle?: Partial<MarketAnalysisInput["confirmationCandle"]>;
  } = {}
): MarketAnalysisInput => {
  const {
    candle: candleOverride,
    trendMeter: trendOverride,
    confirmationCandle: confOverride,
    ...rest
  } = overrides;
  return {
    symbol: "XAUUSD",
    timeframe: "15",
    currentPrice: 2412,
    candle: {
      open: 2408,
      high: 2414,
      low: 2406,
      close: 2412,
      ...candleOverride
    },
    poc: 2409,
    vah: 2418,
    val: 2404,
    hvnLevels: [2416, 2422, 2430],
    trendMeter: {
      state: "BULLISH",
      strength: 80,
      ...trendOverride
    },
    confirmationCandle: {
      state: "BULLISH_BREAKOUT",
      confirmed: true,
      ...confOverride
    },
    volume: 1200,
    relativeVolume: 1.5,
    vwap: 2407,
    ema21: 2408,
    ema50: 2402,
    ema200: 2388,
    rsi: 58,
    atr: 4.2,
    spread: 0.25,
    session: "London",
    nearbySupport: 2405,
    nearbyResistance: 2420,
    highImpactNewsActive: false,
    marketDataTime: "2026-07-20T10:00:00.000Z",
    evaluatedAt: "2026-07-20T10:01:00.000Z",
    missingFields: [],
    isStale: false,
    ...rest
  };
};

export const fixtures = {
  strongBullishBreakout: base({
    currentPrice: 2421,
    candle: { open: 2412, high: 2422, low: 2418.5, close: 2421 },
    confirmationCandle: { state: "BULLISH_BREAKOUT", confirmed: true },
    nearbyResistance: 2418,
    nearbySupport: 2406,
    relativeVolume: 1.8,
    rsi: 61,
    hvnLevels: [2430, 2440, 2455],
    atr: 5
  }),
  bullishPullbackRetest: base({
    currentPrice: 2410,
    candle: { open: 2408, high: 2411, low: 2405, close: 2410 },
    trendMeter: { state: "BULLISH", strength: 88 },
    confirmationCandle: { state: "BULLISH_RETEST", confirmed: true },
    poc: 2406,
    val: 2405,
    vah: 2420,
    nearbySupport: 2405,
    nearbyResistance: 2424,
    relativeVolume: 1.55,
    rsi: 46,
    hvnLevels: [2416, 2422, 2430]
  }),
  strongBearishBreakdown: base({
    currentPrice: 2398,
    candle: { open: 2408, high: 2403, low: 2397, close: 2398 },
    trendMeter: { state: "BEARISH", strength: 86 },
    confirmationCandle: { state: "BEARISH_BREAKOUT", confirmed: true },
    poc: 2408,
    vah: 2415,
    val: 2402,
    vwap: 2409,
    ema21: 2406,
    ema50: 2410,
    ema200: 2420,
    nearbySupport: 2402,
    nearbyResistance: 2416,
    hvnLevels: [2388, 2375, 2360],
    relativeVolume: 1.7,
    rsi: 38,
    atr: 5
  }),
  bearishRetest: base({
    currentPrice: 2414,
    candle: { open: 2416, high: 2418, low: 2412, close: 2413 },
    trendMeter: { state: "BEARISH", strength: 90 },
    confirmationCandle: { state: "BEARISH_RETEST", confirmed: true },
    poc: 2420,
    vah: 2418,
    val: 2400,
    vwap: 2416,
    ema21: 2415,
    ema50: 2418,
    ema200: 2425,
    nearbyResistance: 2417,
    nearbySupport: 2398,
    hvnLevels: [2405, 2396, 2388],
    relativeVolume: 1.6,
    rsi: 38
  }),
  rangeMarket: base({
    currentPrice: 2410,
    trendMeter: { state: "NEUTRAL", strength: 35 },
    confirmationCandle: { state: "NONE", confirmed: false },
    relativeVolume: 0.8,
    rsi: 50,
    nearbySupport: 2406,
    nearbyResistance: 2414
  }),
  priceBelowResistance: base({
    currentPrice: 2417.6,
    nearbyResistance: 2418,
    nearbySupport: 2400,
    trendMeter: { state: "NEUTRAL", strength: 40 },
    confirmationCandle: { state: "NONE", confirmed: false },
    vah: 2418,
    relativeVolume: 0.9
  }),
  priceAboveSupport: base({
    currentPrice: 2405.2,
    nearbySupport: 2405,
    nearbyResistance: 2425,
    trendMeter: { state: "NEUTRAL", strength: 42 },
    confirmationCandle: { state: "NONE", confirmed: false },
    val: 2405,
    relativeVolume: 0.85
  }),
  conflictingIndicators: base({
    trendMeter: { state: "BULLISH", strength: 70 },
    confirmationCandle: { state: "BEARISH_REJECTION", confirmed: true },
    vwap: 2415,
    ema21: 2416,
    ema50: 2418,
    ema200: 2422,
    relativeVolume: 1.5,
    rsi: 68
  }),
  missingIndicators: base({
    poc: null,
    vah: null,
    val: null,
    vwap: null,
    ema21: null,
    ema50: null,
    ema200: null,
    rsi: null,
    atr: null,
    spread: null,
    relativeVolume: null,
    nearbySupport: null,
    nearbyResistance: null,
    missingFields: ["poc", "vah", "val", "vwap", "ema21", "ema50", "ema200", "rsi", "atr", "spread"]
  }),
  staleData: base({
    isStale: true,
    marketDataTime: "2026-07-20T09:00:00.000Z",
    evaluatedAt: "2026-07-20T10:00:00.000Z"
  }),
  excessiveSpread: base({
    spread: 2.5
  }),
  highImpactNews: base({
    highImpactNewsActive: true
  }),
  poorRiskReward: base({
    currentPrice: 2410,
    candle: { open: 2408, high: 2411, low: 2355, close: 2410 },
    trendMeter: { state: "BULLISH", strength: 85 },
    confirmationCandle: { state: "BULLISH_BREAKOUT", confirmed: true },
    atr: 6,
    poc: 2360,
    vah: 2370,
    val: 2340,
    vwap: 2405,
    nearbySupport: 2350,
    // Resistance above price so breakout stop uses deep structure (poor RR), not a tight flip level.
    nearbyResistance: 2425,
    hvnLevels: [2411.1, 2411.3],
    relativeVolume: 1.7,
    rsi: 60
  })
};

export const managementFixtures = {
  breakevenTrigger: {
    side: "BUY",
    entryPrice: 2400,
    stopLoss: 2392,
    currentPrice: 2407.5,
    takeProfits: { tp1: 2410, tp2: 2418, tp3: 2428 },
    tp1Hit: false,
    trendMeter: { state: "BULLISH", strength: 70 },
    confirmationCandle: { state: "BULLISH_CONTINUATION", confirmed: true },
    poc: 2402,
    vwap: 2401,
    relativeVolume: 1.1,
    spread: 0.2,
    isStale: false,
    highImpactNewsActive: false
  } satisfies OpenPositionInput,
  partialProfitTrigger: {
    side: "BUY",
    entryPrice: 2400,
    stopLoss: 2392,
    currentPrice: 2411,
    takeProfits: { tp1: 2410, tp2: 2418, tp3: 2428 },
    tp1Hit: true,
    trendMeter: { state: "BULLISH", strength: 72 },
    confirmationCandle: { state: "BULLISH_CONTINUATION", confirmed: true },
    poc: 2404,
    vwap: 2403,
    relativeVolume: 1.2,
    spread: 0.2,
    isStale: false,
    highImpactNewsActive: false
  } satisfies OpenPositionInput,
  earlyExitTrigger: {
    side: "BUY",
    entryPrice: 2400,
    stopLoss: 2392,
    currentPrice: 2394,
    takeProfits: { tp1: 2410, tp2: 2418, tp3: 2428 },
    tp1Hit: false,
    trendMeter: { state: "BEARISH", strength: 70 },
    confirmationCandle: { state: "BEARISH_BREAKOUT", confirmed: true },
    poc: 2398,
    vwap: 2399,
    relativeVolume: 1.6,
    spread: 0.3,
    isStale: false,
    highImpactNewsActive: false
  } satisfies OpenPositionInput
};

export { base as baseAnalysisInput };
