import { describe, expect, it } from "vitest";
import {
  buildChartExampleIntradayFixture,
  buildIntradayPlan
} from "../../src/services/decision/intradayPlan";
import type { DecisionRecord } from "../../src/models/types";

function baseDecision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: "d1",
    userId: "u1",
    decision: "WAIT",
    lastKnownPrice: 4034.8,
    ohlcv: { open: 4036, high: 4041, low: 4031, close: 4034.8, volume: 10 },
    currentSession: "LONDON",
    dataSourceLabel: "LIVE",
    isTestDecision: false,
    environment: "LIVE",
    generatedAt: new Date().toISOString(),
    marketDataTime: new Date().toISOString(),
    confidence: 0.62,
    atr: 11,
    timeframe: "15",
    dataQuality: "GOOD",
    reasonCodes: [],
    marketStructure: {
      trend: "RANGE",
      poc: 4040,
      vah: 4045,
      val: 4035,
      confirmationClassification: "NONE"
    },
    entry: { price: null },
    stopLoss: { price: null },
    takeProfits: [],
    ...over
  } as DecisionRecord;
}

describe("buildIntradayPlan", () => {
  it("never returns an important level without at least one structured reason", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision(),
      structure: baseDecision()
    });
    expect(plan.importantLevels.length).toBeGreaterThan(0);
    for (const level of plan.importantLevels) {
      expect(level.reasons.length).toBeGreaterThan(0);
      expect(level.simpleExplanation.length).toBeGreaterThan(10);
      expect(level.ifHolds.length).toBeGreaterThan(5);
      expect(level.ifBreaks.length).toBeGreaterThan(5);
    }
  });

  it("orders probable and stretch ranges correctly", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision(),
      structure: baseDecision()
    });
    const r = plan.expectedRange;
    expect(r.stretchLow).not.toBeNull();
    expect(r.probableLow).not.toBeNull();
    expect(r.probableHigh).not.toBeNull();
    expect(r.stretchHigh).not.toBeNull();
    expect(r.stretchLow!).toBeLessThanOrEqual(r.probableLow!);
    expect(r.probableLow!).toBeLessThanOrEqual(r.probableHigh!);
    expect(r.probableHigh!).toBeLessThanOrEqual(r.stretchHigh!);
    expect(r.estimateDisclaimer).toMatch(/estimates only/i);
  });

  it("maps incomplete WAIT into PREPARE / RANGE with trigger + confirmation", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({ decision: "WAIT" }),
      structure: baseDecision({ decision: "WAIT" })
    });
    expect(["PREPARE", "RANGE_TRADE", "BUY_ON_PULLBACK", "BUY_ABOVE", "SELL_ON_REJECTION", "SELL_BELOW"]).toContain(
      plan.action
    );
    expect(plan.trigger).toBeTruthy();
    expect(plan.entryConfirmation.length).toBeGreaterThan(0);
    expect(plan.setupProgress.total).toBe(6);
    expect(plan.setupProgress.label).toMatch(/of 6 conditions complete/);
  });

  it("keeps actionable BUY plans with entry, stop, targets and invalidation", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({ decision: "BUY", lastKnownPrice: 4036 }),
      structure: baseDecision({
        decision: "BUY",
        lastKnownPrice: 4036,
        marketStructure: {
          trend: "BULLISH",
          poc: 4038,
          vah: 4042,
          val: 4032,
          confirmationClassification: "RETEST"
        },
        entry: { price: 4035 },
        stopLoss: { price: 4028 },
        takeProfits: [
          { label: "TP1", price: 4042 },
          { label: "TP2", price: 4048 },
          { label: "TP3", price: 4054 }
        ],
        riskReward: { tp1: 1.2, tp2: 2, tp3: 3 }
      } as Partial<DecisionRecord>)
    });
    expect(plan.action).toBe("BUY_NOW");
    expect(plan.tradePlan.actionable).toBe(true);
    expect(plan.tradePlan.entryZone).toBeTruthy();
    expect(plan.tradePlan.stopLoss).toBe(4028);
    expect(plan.tradePlan.tp1).toBe(4042);
    expect(plan.invalidation.length).toBeGreaterThan(5);
    expect(plan.safety.autoTrade).toBe("OFF");
    expect(plan.safety.liveTrading).toBe(false);
  });

  it("OHLC-only / LIVE_RANGE_ONLY does not invent POC/VAH/VAL important levels", () => {
    const plan = buildIntradayPlan({
      mode: "LIVE_RANGE_ONLY",
      quote: baseDecision({
        marketStructure: { trend: "NEUTRAL", poc: null, vah: null, val: null }
      } as Partial<DecisionRecord>),
      structure: null
    });
    expect(plan.action).toBe("PREPARE");
    expect(plan.importantLevels.every((l) => !["lvl-poc", "lvl-vah", "lvl-val"].includes(l.id))).toBe(
      true
    );
    expect(plan.whyNotReady).toMatch(/OHLC-only|structure/i);
  });

  it("MISMATCH yields NO_TRADE and zero important levels", () => {
    const plan = buildIntradayPlan({
      mode: "MISMATCH",
      quote: baseDecision({ lastKnownPrice: 4045 }),
      structure: baseDecision({ lastKnownPrice: 2408 })
    });
    expect(plan.action).toBe("NO_TRADE");
    expect(plan.importantLevels).toHaveLength(0);
    expect(plan.oneSentence).toMatch(/mismatch|disagree/i);
  });

  it("chart example fixture is labelled TEST and still has reasoned levels", () => {
    const fixture = buildChartExampleIntradayFixture(4034.815);
    expect(fixture.freshness.sourceLabel).toBe("TEST_FIXTURE");
    expect(fixture.disclaimer).toMatch(/fixture/i);
    expect(fixture.importantLevels.every((l) => l.reasons.length > 0)).toBe(true);
  });
});
