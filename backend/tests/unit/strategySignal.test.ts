import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../src/models/types";
import { buildIntradayPlan } from "../../src/services/decision/intradayPlan";
import {
  isCompleteStrategySignal,
  resolveMarketStructureView,
  selectLatestCompleteStrategySignal,
  selectLatestConfirmationDecision
} from "../../src/services/decision/strategySignal";

function decision(partial: Partial<DecisionRecord> & { decisionId: string }): DecisionRecord {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 15 * 60_000).toISOString();
  return {
    schemaVersion: "1.0",
    userId: "u1",
    symbol: "XAUUSD",
    timeframe: "15",
    barTime: now,
    generatedAt: now,
    marketDataTime: now,
    validUntil: later,
    decision: "WAIT",
    confidence: 50,
    confidenceLabel: "MODERATE",
    marketRegime: "RANGING",
    dataQuality: "GOOD",
    isProvisional: false,
    setupScore: 40,
    entry: { type: "NONE", price: null, zoneLow: null, zoneHigh: null, condition: null },
    stopLoss: { price: null, reason: null },
    takeProfits: [],
    riskReward: { tp1: null, tp2: null, tp3: null },
    breakeven: { state: "NOT_APPLICABLE", trigger: null, newStop: null, reason: null },
    earlyExit: { exitNow: false, conditions: [] },
    bullishEvidence: [],
    bearishEvidence: [],
    reasonCodes: [],
    reasonSummary: [],
    warnings: [],
    missingInputs: [],
    invalidation: "—",
    disclaimer: "—",
    lifecycleState: "INCOMPLETE",
    snapshotId: null,
    ruleConfigVersion: "rules-1.1.0",
    pineScriptVersion: null,
    backendVersion: "1.4.0-v5-intelligence",
    aiModelId: null,
    aiPromptVersion: null,
    aiSafetyDowngraded: false,
    notificationSent: false,
    currentSession: "NEWYORK",
    higherTimeframeBias: "BULLISH",
    lastKnownPrice: 4076.56,
    ohlcv: { open: 4075, high: 4078.78, low: 4073.97, close: 4076.56, volume: 1 },
    marketStructure: {
      trend: "BULLISH",
      trendStrength: 60,
      poc: 4075,
      vah: 4080,
      val: 4070,
      confirmationClassification: "CONTINUATION",
      confirmationDirection: "BULLISH",
      confirmationCandleType: "BULLISH"
    },
    dataSourceLabel: "LIVE",
    environment: "LIVE",
    isTestDecision: false,
    ...partial
  } as DecisionRecord;
}

describe("strategySignal role alignment", () => {
  it("treats a 15M OHLC-only decision as incomplete", () => {
    const ohlcOnly = decision({
      decisionId: "ohlc",
      marketStructure: {
        trend: null,
        trendStrength: null,
        poc: null,
        vah: null,
        val: null,
        confirmationClassification: null,
        confirmationDirection: null,
        confirmationCandleType: null
      },
      missingInputs: ["volumeProfile", "trend.direction"]
    });
    expect(isCompleteStrategySignal(ohlcOnly)).toBe(false);
  });

  it("never promotes a newer 1M diagnostic profile over the confirmed 15M structure", () => {
    const plan15m = decision({
      decisionId: "plan-15m",
      timeframe: "15",
      generatedAt: new Date(Date.now() - 60_000).toISOString(),
      marketDataTime: new Date(Date.now() - 60_000).toISOString(),
      lastKnownPrice: 4606,
      marketStructure: {
        trend: "BULLISH",
        trendStrength: 64,
        poc: 4582,
        vah: 4632,
        val: 4564,
        confirmationClassification: "CONTINUATION",
        confirmationDirection: "BULLISH",
        confirmationCandleType: "BULLISH"
      }
    });
    const quote1m = decision({
      decisionId: "quote-1m",
      timeframe: "1",
      generatedAt: new Date().toISOString(),
      marketDataTime: new Date().toISOString(),
      lastKnownPrice: 4608.07,
      marketStructure: {
        trend: "BEARISH",
        trendStrength: 40,
        poc: 4621.63,
        vah: 4625.85,
        val: 4616.85,
        confirmationClassification: "REJECTION",
        confirmationDirection: "BEARISH",
        confirmationCandleType: "BEARISH"
      }
    });

    const view = resolveMarketStructureView([quote1m, plan15m]);
    expect(view.latestQuote?.decisionId).toBe("quote-1m");
    expect(view.latestCompleteStrategySignal?.decisionId).toBe("plan-15m");
    expect(view.structureDecision?.decisionId).toBe("plan-15m");
    expect(view.structureDecision?.marketStructure?.poc).toBe(4582);
    expect(view.marketStructureMode).toBe("COMPLETE");
    expect(view.diagnostics.quoteTimeframe).toBe("1");
    expect(view.diagnostics.structureTimeframe).toBe("15");
    expect(view.diagnostics.fieldsMissing).not.toContain("poc");
  });

  it("selects a fresh confirmed 5M event only as confirmation", () => {
    const plan15m = decision({ decisionId: "plan-15m", timeframe: "15" });
    const confirm5m = decision({
      decisionId: "confirm-5m",
      timeframe: "5",
      marketStructure: {
        trend: "BULLISH",
        trendStrength: 62,
        poc: 4619,
        vah: 4624,
        val: 4614,
        confirmationClassification: "BREAKOUT",
        confirmationDirection: "BULLISH",
        confirmationCandleType: "BULLISH"
      }
    });
    const quote1m = decision({ decisionId: "quote-1m", timeframe: "1", lastKnownPrice: 4076.7 });

    const view = resolveMarketStructureView([quote1m, confirm5m, plan15m]);
    expect(view.latestConfirmation?.decisionId).toBe("confirm-5m");
    expect(view.confirmationDecision?.decisionId).toBe("confirm-5m");
    expect(view.structureDecision?.decisionId).toBe("plan-15m");
    expect(view.diagnostics.confirmationTimeframe).toBe("5");
    expect(view.diagnostics.shortTermDataReady).toBe(true);
    expect(selectLatestConfirmationDecision([confirm5m], plan15m)?.decisionId).toBe("confirm-5m");
  });

  it("does not treat a complete-looking 5M event as the 15M strategy structure", () => {
    const only5m = decision({ decisionId: "five", timeframe: "5" });
    expect(isCompleteStrategySignal(only5m)).toBe(false);
    expect(selectLatestCompleteStrategySignal([only5m])).toBeNull();
  });

  it("ignores stale 5M confirmation", () => {
    const now = Date.now();
    const plan15m = decision({ decisionId: "plan", timeframe: "15" });
    const stale5m = decision({
      decisionId: "stale-confirm",
      timeframe: "5",
      generatedAt: new Date(now - 13 * 60_000).toISOString(),
      marketDataTime: new Date(now - 13 * 60_000).toISOString()
    });
    const view = resolveMarketStructureView([stale5m, plan15m], now);
    expect(view.latestConfirmation).toBeNull();
    expect(view.diagnostics.rejectionReasons.join(" ")).toContain("CONFIRM_5M_MISSING_OR_STALE");
  });

  it("returns LIVE_RANGE_ONLY when no confirmed 15M structure exists", () => {
    const quote1m = decision({
      decisionId: "quote",
      timeframe: "1",
      marketStructure: {
        trend: null,
        trendStrength: null,
        poc: null,
        vah: null,
        val: null,
        confirmationClassification: null,
        confirmationDirection: null,
        confirmationCandleType: null
      }
    });
    const view = resolveMarketStructureView([quote1m]);
    expect(view.marketStructureMode).toBe("LIVE_RANGE_ONLY");
    expect(view.structureDecision).toBeNull();
  });

  it("flags MISMATCH when the 1M quote and 15M signal are in different price regimes", () => {
    const plan15m = decision({
      decisionId: "plan",
      timeframe: "15",
      generatedAt: new Date(Date.now() - 30_000).toISOString(),
      marketDataTime: new Date(Date.now() - 30_000).toISOString(),
      lastKnownPrice: 4050,
      ohlcv: { open: 4048, high: 4052, low: 4045, close: 4050, volume: 1 },
      marketStructure: {
        trend: "BULLISH",
        trendStrength: 60,
        poc: 4050.9,
        vah: 4053,
        val: 4047,
        confirmationClassification: "CONTINUATION",
        confirmationDirection: "BULLISH",
        confirmationCandleType: "BULLISH"
      }
    });
    const quote1m = decision({
      decisionId: "quote",
      timeframe: "1",
      lastKnownPrice: 2408,
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 }
    });
    const view = resolveMarketStructureView([quote1m, plan15m]);
    expect(view.marketStructureMode).toBe("MISMATCH");
    expect(view.structureDecision).toBeNull();
  });


  it("uses market-data time so a delayed old 15M bar cannot become a fresh plan", () => {
    const now = Date.now();
    const delayedPlan = decision({
      decisionId: "delayed-plan",
      timeframe: "15",
      generatedAt: new Date(now).toISOString(),
      marketDataTime: new Date(now - 21 * 60_000).toISOString(),
      validUntil: new Date(now + 15 * 60_000).toISOString()
    });
    expect(selectLatestCompleteStrategySignal([delayedPlan], now)).toBeNull();
  });

  it("does not let a 5M event from before the active 15M bar confirm the newer plan", () => {
    const now = Date.now();
    const plan15m = decision({
      decisionId: "new-plan",
      timeframe: "15",
      marketDataTime: new Date(now - 60_000).toISOString()
    });
    const older5m = decision({
      decisionId: "old-confirm",
      timeframe: "5",
      marketDataTime: new Date(now - 2 * 60_000).toISOString(),
      marketStructure: {
        trend: "BULLISH",
        trendStrength: 60,
        poc: 4075,
        vah: 4080,
        val: 4070,
        confirmationClassification: "BREAKOUT",
        confirmationDirection: "BULLISH",
        confirmationCandleType: "BULLISH"
      }
    });
    expect(selectLatestConfirmationDecision([older5m], plan15m, now)).toBeNull();
  });

  it("activates a BUY only from a bullish 5M confirmation and blocks the bearish mirror", () => {
    const quote1m = decision({ decisionId: "quote-buy", timeframe: "1" });
    const buyPlan = decision({
      decisionId: "buy-plan",
      timeframe: "15",
      decision: "BUY",
      entry: { type: "ENTRY_ZONE", price: 4076, zoneLow: 4075.5, zoneHigh: 4076.5, condition: "Buy zone" },
      stopLoss: { price: 4072, reason: "Below support" },
      takeProfits: [
        { label: "TP1", price: 4084, reason: "First resistance" },
        { label: "TP2", price: 4088, reason: "Second resistance" }
      ],
      marketStructure: {
        trend: "BULLISH",
        trendStrength: 64,
        poc: 4075,
        vah: 4080,
        val: 4070,
        confirmationClassification: "BREAKOUT",
        confirmationDirection: "BULLISH",
        confirmationCandleType: "BULLISH"
      }
    });
    const supported = buildIntradayPlan({ quote: quote1m, structure: buyPlan, mode: "COMPLETE" });
    expect(supported.action).toBe("BUY_NOW");
    expect(supported.tradePlan.actionable).toBe(true);

    const opposed = buildIntradayPlan({
      quote: quote1m,
      structure: {
        ...buyPlan,
        marketStructure: { ...buyPlan.marketStructure!, confirmationDirection: "BEARISH" }
      },
      mode: "COMPLETE"
    });
    expect(opposed.action).not.toBe("BUY_NOW");
    expect(opposed.tradePlan.actionable).toBe(false);
  });

  it("activates a SELL only from a bearish 5M confirmation and blocks the bullish mirror", () => {
    const quote1m = decision({ decisionId: "quote-sell", timeframe: "1" });
    const sellPlan = decision({
      decisionId: "sell-plan",
      timeframe: "15",
      decision: "SELL",
      entry: { type: "ENTRY_ZONE", price: 4076, zoneLow: 4075.5, zoneHigh: 4076.5, condition: "Sell zone" },
      stopLoss: { price: 4080, reason: "Above resistance" },
      takeProfits: [
        { label: "TP1", price: 4068, reason: "First support" },
        { label: "TP2", price: 4064, reason: "Second support" }
      ],
      marketStructure: {
        trend: "BEARISH",
        trendStrength: 64,
        poc: 4075,
        vah: 4080,
        val: 4070,
        confirmationClassification: "REJECTION",
        confirmationDirection: "BEARISH",
        confirmationCandleType: "BEARISH"
      }
    });
    const supported = buildIntradayPlan({ quote: quote1m, structure: sellPlan, mode: "COMPLETE" });
    expect(supported.action).toBe("SELL_ON_REJECTION");
    expect(supported.tradePlan.actionable).toBe(true);

    const opposed = buildIntradayPlan({
      quote: quote1m,
      structure: {
        ...sellPlan,
        marketStructure: { ...sellPlan.marketStructure!, confirmationDirection: "BULLISH" }
      },
      mode: "COMPLETE"
    });
    expect(opposed.action).not.toBe("SELL_ON_REJECTION");
    expect(opposed.tradePlan.actionable).toBe(false);
  });

  it("ignores TEST fixture when selecting complete signal", () => {
    const testDec = decision({
      decisionId: "test",
      timeframe: "15",
      isTestDecision: true,
      environment: "TEST",
      dataSourceLabel: "TEST",
      lastKnownPrice: 2408,
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 }
    });
    expect(selectLatestCompleteStrategySignal([testDec])).toBeNull();
  });
});
