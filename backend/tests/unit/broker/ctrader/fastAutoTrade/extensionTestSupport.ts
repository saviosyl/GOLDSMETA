import type { DecisionRecord } from "../../../../../src/models/types";
import type { TrendbarCandle } from "../../../../../src/services/broker/ctrader/openApiClient";

export const EXT_POC = 4349.022;
export const EXT_VAH = 4374.4;
export const EXT_VAL = 4342.6;
export const EXT_TYPICAL_TR = 5.0;

export function buildCompletedM1Series(args: {
  nowMs: number;
  last: { open: number; high: number; low: number; close: number; volume?: number };
  count?: number;
  typicalTr?: number;
}): TrendbarCandle[] {
  const count = args.count ?? 20;
  const typicalTr = args.typicalTr ?? EXT_TYPICAL_TR;
  const nowSec = Math.floor(args.nowMs / 1000);
  const lastTime = nowSec - 90;
  const bars: TrendbarCandle[] = [];
  let close = args.last.close - typicalTr * (count - 1) * 0.15;
  for (let i = 0; i < count - 1; i++) {
    const open = close;
    const high = open + typicalTr * 0.65;
    const low = open - typicalTr * 0.35;
    const next = open + typicalTr * 0.15;
    bars.push({
      time: lastTime - (count - 1 - i) * 60,
      open,
      high,
      low,
      close: next,
      volume: 800
    });
    close = next;
  }
  bars.push({
    time: lastTime,
    open: args.last.open,
    high: args.last.high,
    low: args.last.low,
    close: args.last.close,
    volume: args.last.volume ?? 1400
  });
  return bars;
}

export function productionLikeDecision(
  over: Partial<DecisionRecord> = {}
): DecisionRecord {
  return {
    schemaVersion: "1.0",
    decisionId: "dec_ext",
    userId: "uid-ext",
    symbol: "XAUUSD",
    timeframe: "15",
    barTime: "2026-08-14T12:30:00.000Z",
    generatedAt: "2026-08-14T12:30:00.000Z",
    marketDataTime: "2026-08-14T12:30:00.000Z",
    validUntil: "2026-08-14T12:45:00.000Z",
    decision: "BUY",
    confidence: 84,
    confidenceLabel: "HIGH",
    marketRegime: "TRENDING_UP",
    dataQuality: "GOOD",
    isProvisional: false,
    setupScore: 84,
    entry: { price: 4374.43 },
    stopLoss: { price: 4370.0 },
    takeProfits: [],
    riskReward: { tp1: 1, tp2: null, tp3: null },
    breakeven: null,
    earlyExit: null,
    bullishEvidence: ["breakout", "impulse"],
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
    lastKnownPrice: 4374.43,
    ohlcv: {
      open: 4368.0,
      high: 4376.0,
      low: 4366.0,
      close: 4374.43,
      volume: 9000
    },
    marketStructure: {
      trend: "BULLISH",
      trendStrength: 62,
      poc: EXT_POC,
      vah: EXT_VAH,
      val: EXT_VAL,
      confirmationClassification: "BREAKOUT",
      confirmationDirection: "BULLISH",
      confirmationCandleType: null,
      nearbyResistance: EXT_VAH,
      nearbySupport: EXT_VAL
    },
    dataSourceLabel: "TEST",
    environment: "TEST",
    isTestDecision: true,
    ...over
  } as DecisionRecord;
}
