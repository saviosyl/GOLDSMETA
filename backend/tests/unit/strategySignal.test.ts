import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../src/models/types";
import {
  isCompleteStrategySignal,
  resolveMarketStructureView,
  selectLatestCompleteStrategySignal
} from "../../src/services/decision/strategySignal";

function decision(partial: Partial<DecisionRecord> & { decisionId: string }): DecisionRecord {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 15 * 60_000).toISOString();
  return {
    schemaVersion: "1.0",
    userId: "u1",
    symbol: "XAUUSD",
    timeframe: "5",
    barTime: now,
    generatedAt: now,
    marketDataTime: now,
    validUntil: later,
    decision: "WAIT",
    confidence: 50,
    confidenceLabel: "MODERATE",
    marketRegime: "RANGING",
    dataQuality: "PARTIAL",
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

describe("strategySignal selection", () => {
  it("treats OHLC-only decision as incomplete", () => {
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
      missingInputs: ["volumeProfile", "trend.direction", "confirmationCandle"]
    });
    expect(isCompleteStrategySignal(ohlcOnly)).toBe(false);
  });

  it("keeps prior complete signal when a newer OHLC-only event arrives", () => {
    const olderComplete = decision({
      decisionId: "complete",
      generatedAt: new Date(Date.now() - 60_000).toISOString(),
      marketDataTime: new Date(Date.now() - 60_000).toISOString(),
      dataQuality: "GOOD",
      lifecycleState: "ACTIVE"
    });
    const newerOhlc = decision({
      decisionId: "ohlc",
      generatedAt: new Date().toISOString(),
      lastKnownPrice: 4076.56,
      ohlcv: { open: 4075, high: 4078.78, low: 4073.97, close: 4076.56, volume: 1 },
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
      missingInputs: ["volumeProfile"]
    });
    const view = resolveMarketStructureView([newerOhlc, olderComplete]);
    expect(view.latestQuote?.decisionId).toBe("ohlc");
    expect(view.latestCompleteStrategySignal?.decisionId).toBe("complete");
    expect(view.marketStructureMode).toBe("COMPLETE");
    expect(view.structureDecision?.decisionId).toBe("complete");
    expect(view.diagnostics.fieldsMissing).toContain("poc");
  });

  it("returns LIVE_RANGE_ONLY when no complete signal exists", () => {
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
      }
    });
    const view = resolveMarketStructureView([ohlcOnly]);
    expect(view.marketStructureMode).toBe("LIVE_RANGE_ONLY");
    expect(view.structureDecision).toBeNull();
  });

  it("flags MISMATCH when quote and complete signal disagree", () => {
    const complete = decision({
      decisionId: "complete",
      generatedAt: new Date(Date.now() - 30_000).toISOString(),
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
    const quote = decision({
      decisionId: "quote",
      lastKnownPrice: 2408,
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 },
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
    const view = resolveMarketStructureView([quote, complete]);
    expect(view.marketStructureMode).toBe("MISMATCH");
    expect(view.structureDecision).toBeNull();
  });

  it("ignores TEST fixture when selecting complete signal", () => {
    const testDec = decision({
      decisionId: "test",
      isTestDecision: true,
      environment: "TEST",
      dataSourceLabel: "TEST",
      lastKnownPrice: 2408,
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 },
      marketStructure: {
        trend: "NEUTRAL",
        trendStrength: 50,
        poc: 2408,
        vah: 2415,
        val: 2400,
        confirmationClassification: "NONE",
        confirmationDirection: "NEUTRAL",
        confirmationCandleType: null
      }
    });
    expect(selectLatestCompleteStrategySignal([testDec])).toBeNull();
  });
});
