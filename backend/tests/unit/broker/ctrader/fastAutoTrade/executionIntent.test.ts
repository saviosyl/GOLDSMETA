import { describe, expect, it } from "vitest";
import { buildFastExecutionIntent } from "../../../../../src/services/broker/ctrader/fastAutoTrade/executionIntent";
import { FAST_AUTOTRADE_STRATEGY_ID } from "../../../../../src/services/broker/ctrader/fastAutoTrade/types";
import type { FastAutoTradeDecision } from "../../../../../src/services/broker/ctrader/fastAutoTrade/types";

function buy(over: Partial<FastAutoTradeDecision> = {}): FastAutoTradeDecision {
  return {
    strategyId: FAST_AUTOTRADE_STRATEGY_ID,
    action: "BUY",
    regime: "FAST",
    bias: "BULLISH",
    setupType: "BREAKOUT",
    trigger: "BREAK_HOLD",
    qualityScore: 74,
    grade: "B+",
    waitReason: null,
    hardVeto: null,
    accepted: [],
    rejected: [],
    missing: [],
    supporting: [],
    identity: {
      direction: "BUY",
      setupType: "BREAKOUT",
      structureAnchor: "res:3398",
      triggerCandle: "c1",
      timestamp: "2026-08-16T22:10:00.000Z"
    },
    geometry: {
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      takeProfit2: null,
      riskReward: 1.5
    },
    lifecycleState: "ENTRY_PENDING",
    signalId: "fast_BUY_74",
    telemetry: {
      direction: "BUY",
      setupType: "BREAKOUT",
      score: 74,
      grade: "B+",
      regime: "FAST",
      price: 3400,
      timestamp: "2026-08-16T22:10:00.000Z",
      rejectionReason: null,
      supportingEvidence: [],
      missingEvidence: [],
      hardVeto: null,
      tradeSpaceOk: true,
      extended: false,
      extensionAnchorType: "BROKEN_RESISTANCE",
      extensionAnchorPrice: 3398,
      extensionDistance: 2,
      extensionAtr: 1.2,
      extensionAtrSource: "M1_ATR14",
      extensionDistanceAtr: 1.67,
      extensionLimitAtr: 2.2
    },
    tradeSpaceOk: true,
    extended: false,
    extension: {
      extensionAnchorType: "BROKEN_RESISTANCE",
      extensionAnchorPrice: 3398,
      extensionDistance: 2,
      extensionAtr: 1.2,
      extensionAtrSource: "M1_ATR14",
      extensionDistanceAtr: 1.67,
      extensionLimitAtr: 2.2
    },
    ...over
  };
}

describe("buildFastExecutionIntent", () => {
  it("builds an authoritative FAST BUY object", () => {
    const intent = buildFastExecutionIntent(buy());
    expect(intent).toEqual({
      direction: "BUY",
      signalId: "fast_BUY_74",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      qualityScore: 74,
      grade: "B+",
      identity: expect.objectContaining({ direction: "BUY" }),
      strategyId: FAST_AUTOTRADE_STRATEGY_ID
    });
  });

  it("returns null for WAIT or missing geometry", () => {
    expect(buildFastExecutionIntent(buy({ action: "WAIT", geometry: null }))).toBeNull();
    expect(buildFastExecutionIntent(buy({ signalId: null }))).toBeNull();
  });
});
