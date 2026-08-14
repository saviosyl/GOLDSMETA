import { afterEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../../../../src/models/types";
import {
  buildFastAutoTradeInput,
  detectFastTrigger,
  mapDecisionToFastInput,
  ohlcFromTrendbar,
  oneMinuteMarketFromBars,
  useCompletedM1LoaderForTests
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";

const fiveMinOhlcv = {
  open: 3370,
  high: 3410,
  low: 3365,
  close: 3408,
  volume: 9000
};

const priorBar = {
  time: 1_787_000_000,
  open: 3386.2,
  high: 3386.8,
  low: 3384.4,
  close: 3385.1,
  volume: 800
};

const latestBar = {
  time: 1_787_000_060,
  open: 3385.0,
  high: 3388.2,
  low: 3384.6,
  close: 3387.4,
  volume: 1200
};

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    schemaVersion: "1.0",
    decisionId: "dec_5m",
    userId: "uid",
    symbol: "XAUUSD",
    timeframe: "5",
    barTime: "2026-08-14T09:00:00.000Z",
    generatedAt: "2026-08-14T09:00:00.000Z",
    marketDataTime: "2026-08-14T09:00:00.000Z",
    validUntil: "2026-08-14T09:15:00.000Z",
    decision: "WAIT",
    confidence: 64,
    confidenceLabel: "MODERATE",
    marketRegime: "TRENDING_UP",
    dataQuality: "GOOD",
    isProvisional: false,
    setupScore: 64,
    entry: { price: 3387.4 },
    stopLoss: { price: 3384.8 },
    takeProfits: [],
    riskReward: { tp1: 1, tp2: null, tp3: null },
    breakeven: null,
    earlyExit: null,
    bullishEvidence: ["structure"],
    bearishEvidence: [],
    reasonCodes: ["TREND_BULLISH"],
    reasonSummary: [],
    warnings: [],
    missingInputs: [],
    invalidation: "",
    disclaimer: "",
    lifecycleState: "ACTIVE",
    snapshotId: null,
    ruleConfigVersion: "1",
    pineScriptVersion: null,
    backendVersion: "1",
    aiModelId: null,
    aiPromptVersion: null,
    aiSafetyDowngraded: false,
    notificationSent: false,
    currentSession: "LONDON",
    higherTimeframeBias: "BULLISH",
    lastKnownPrice: 3408,
    ohlcv: fiveMinOhlcv,
    marketStructure: {
      trend: "BULLISH",
      trendStrength: 62,
      poc: 3385.2,
      vah: 3392.0,
      val: 3383.8,
      confirmationClassification: "CONTINUATION",
      confirmationDirection: "BULLISH"
    },
    dataSourceLabel: "TEST",
    environment: "TEST",
    isTestDecision: true,
    ...over
  } as DecisionRecord;
}

const safety = {
  accountIsLive: false,
  accountEnvironment: "DEMO" as const,
  spreadLimit: 2,
  maxQuoteAgeSeconds: 15
};

describe("FAST 1-minute market input", () => {
  afterEach(() => {
    useCompletedM1LoaderForTests(null);
  });

  it("does not use the 5m DecisionRecord OHLC when completed 1m bars exist", async () => {
    useCompletedM1LoaderForTests(async () => [priorBar, latestBar]);
    const input = await buildFastAutoTradeInput({
      uid: "uid",
      decision: decision(),
      nowMs: Date.parse("2026-08-14T09:02:00.000Z"),
      bid: 3387.35,
      ask: 3387.45,
      spread: 0.1,
      quoteAgeSeconds: 1,
      ...safety
    });

    expect(input.timeframe).toBe("1");
    expect(input.ohlcv).toEqual(ohlcFromTrendbar(latestBar));
    expect(input.priorOhlcv).toEqual(ohlcFromTrendbar(priorBar));
    expect(input.ohlcv).not.toEqual(fiveMinOhlcv);
    expect(input.ohlcv?.close).not.toBe(fiveMinOhlcv.close);
    expect(input.htfBias).toBe("BULLISH");
    expect(input.poc).toBe(3385.2);
    expect(input.v3Decision).toBe("WAIT");
  });

  it("populates priorOhlcv only when a previous completed 1m bar exists", () => {
    expect(oneMinuteMarketFromBars([latestBar]).priorOhlcv).toBeNull();
    expect(oneMinuteMarketFromBars([priorBar, latestBar]).priorOhlcv).toEqual(
      ohlcFromTrendbar(priorBar)
    );
  });

  it("uses the 1m prior candle for microstructure triggers", () => {
    const mapped = mapDecisionToFastInput({
      decision: decision({
        marketStructure: {
          trend: "BULLISH",
          trendStrength: 62,
          poc: 3385.2,
          vah: 3392,
          val: 3383.8,
          confirmationClassification: "NONE",
          confirmationDirection: "NEUTRAL"
        } as DecisionRecord["marketStructure"]
      }),
      ...safety,
      ohlcv: ohlcFromTrendbar(latestBar),
      priorOhlcv: ohlcFromTrendbar(priorBar),
      timeframe: "1"
    });
    const trigger = detectFastTrigger(mapped, "BULLISH");
    expect(trigger.trigger).toBe("BULLISH_ENGULFING");

    const withoutPrior = mapDecisionToFastInput({
      decision: decision({
        marketStructure: {
          trend: "BULLISH",
          trendStrength: 62,
          poc: 3385.2,
          vah: 3392,
          val: 3383.8,
          confirmationClassification: "NONE",
          confirmationDirection: "NEUTRAL"
        } as DecisionRecord["marketStructure"]
      }),
      ...safety,
      ohlcv: ohlcFromTrendbar(latestBar),
      priorOhlcv: null,
      timeframe: "1"
    });
    expect(detectFastTrigger(withoutPrior, "BULLISH").trigger).not.toBe(
      "BULLISH_ENGULFING"
    );
  });
});
