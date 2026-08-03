import { describe, expect, it } from "vitest";
import {
  buildChartExampleIntradayFixture,
  buildExpectedRange,
  buildIntradayPlan,
  validatePlanOrdering,
  valueLocationOf
} from "../../src/services/decision/intradayPlan";
import type { DecisionRecord } from "../../src/models/types";

function baseDecision(over: Partial<DecisionRecord> & { atr?: number } = {}): DecisionRecord {
  const { atr, ...rest } = over;
  return {
    decisionId: "d1",
    userId: "u1",
    decision: "WAIT",
    lastKnownPrice: 4040,
    ohlcv: { open: 4036, high: 4048, low: 4032, close: 4040, volume: 10 },
    currentSession: "LONDON",
    dataSourceLabel: "LIVE",
    isTestDecision: false,
    environment: "LIVE",
    generatedAt: new Date().toISOString(),
    marketDataTime: new Date().toISOString(),
    confidence: 0.62,
    timeframe: "15",
    dataQuality: "GOOD",
    reasonCodes: [],
    marketStructure: {
      trend: "RANGE",
      poc: 4045,
      vah: 4050,
      val: 4038,
      confirmationClassification: "NONE"
    },
    entry: { price: null },
    stopLoss: { price: null },
    takeProfits: [],
    ...(atr != null ? { atr } : {}),
    ...rest
  } as DecisionRecord;
}

function assertRangeAroundCurrent(plan: ReturnType<typeof buildIntradayPlan>) {
  const r = plan.expectedRange;
  if (!r.rangeAvailable) return;
  expect(r.probableLow).not.toBeNull();
  expect(r.probableHigh).not.toBeNull();
  expect(r.stretchLow).not.toBeNull();
  expect(r.stretchHigh).not.toBeNull();
  expect(r.currentPrice).not.toBeNull();
  expect(r.stretchLow!).toBeLessThanOrEqual(r.probableLow!);
  expect(r.probableLow!).toBeLessThanOrEqual(r.currentPrice!);
  expect(r.currentPrice!).toBeLessThanOrEqual(r.probableHigh!);
  expect(r.probableHigh!).toBeLessThanOrEqual(r.stretchHigh!);
}

describe("value location + expected range", () => {
  it("detects below / inside / above value", () => {
    expect(valueLocationOf(4034, 4037, 4049)).toBe("BELOW_VALUE");
    expect(valueLocationOf(4040, 4037, 4049)).toBe("INSIDE_VALUE");
    expect(valueLocationOf(4055, 4037, 4049)).toBe("ABOVE_VALUE");
  });

  it("1) current price below VAL — reclaim language, range around price", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({
        lastKnownPrice: 4034.815,
        ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1 },
        atr: 12.5,
        marketStructure: {
          trend: "RANGE",
          poc: 4045.087,
          vah: 4049.633,
          val: 4037.308,
          confirmationClassification: "NONE"
        }
      }),
      structure: baseDecision({
        lastKnownPrice: 4034.815,
        ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1 },
        atr: 12.5,
        marketStructure: {
          trend: "RANGE",
          poc: 4045.087,
          vah: 4049.633,
          val: 4037.308,
          confirmationClassification: "NONE"
        },
        stopLoss: { price: 4028.6 },
        takeProfits: [
          { label: "TP1", price: 4045.1 },
          { label: "TP2", price: 4049.8 }
        ]
      })
    });
    expect(plan.valueLocation).toBe("BELOW_VALUE");
    expect(plan.oneSentence).toMatch(/below value/i);
    expect(plan.oneSentence).toMatch(/reclaim/i);
    assertRangeAroundCurrent(plan);
    expect(plan.expectedRange.probableLow!).toBeLessThanOrEqual(4034.815);
    expect(plan.expectedRange.probableHigh!).toBeGreaterThanOrEqual(4034.815);
    const val = plan.importantLevels.find((l) => l.id === "lvl-val");
    expect(val?.roleAtCurrentPrice).toBe("RECLAIM_LEVEL");
    expect(val?.shortMeaning).not.toMatch(/floor under value/i);
    expect(val?.proximity).toBe("ABOVE");
    expect(plan.zones.bestBuyImmediate).toBe(false);
    expect(plan.zones.bestBuyZone).toMatch(/reclaim/i);
    expect(plan.tradePlan.cardKind).not.toBe("ACTIVE_PLAN");
    expect(plan.tradePlan.stopLoss).toBeNull();
    expect(plan.tradePlan.tp1).toBeNull();
  });

  it("2) current price above VAH — VAH as potential support after retest", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({
        lastKnownPrice: 4055,
        ohlcv: { open: 4052, high: 4058, low: 4048, close: 4055, volume: 1 },
        atr: 10,
        marketStructure: { trend: "BULL", poc: 4045, vah: 4050, val: 4038, confirmationClassification: "BREAKOUT" }
      }),
      structure: baseDecision({
        lastKnownPrice: 4055,
        ohlcv: { open: 4052, high: 4058, low: 4048, close: 4055, volume: 1 },
        atr: 10,
        marketStructure: { trend: "BULL", poc: 4045, vah: 4050, val: 4038, confirmationClassification: "BREAKOUT" }
      })
    });
    expect(plan.valueLocation).toBe("ABOVE_VALUE");
    assertRangeAroundCurrent(plan);
    const vah = plan.importantLevels.find((l) => l.id === "lvl-vah");
    expect(vah?.roleAtCurrentPrice).toBe("PREVIOUS_RESISTANCE_NOW_SUPPORT");
    expect(vah?.proximity).toBe("BELOW");
    expect(plan.zones.bestSellImmediate).toBe(false);
    expect(plan.zones.bestSellZone).toMatch(/breakdown/i);
  });

  it("3) current price inside value — VAL floor / VAH ceiling", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({
        lastKnownPrice: 4042,
        atr: 10,
        marketStructure: { trend: "RANGE", poc: 4045, vah: 4050, val: 4038, confirmationClassification: "NONE" }
      }),
      structure: baseDecision({
        lastKnownPrice: 4042,
        atr: 10,
        marketStructure: { trend: "RANGE", poc: 4045, vah: 4050, val: 4038, confirmationClassification: "NONE" }
      })
    });
    expect(plan.valueLocation).toBe("INSIDE_VALUE");
    assertRangeAroundCurrent(plan);
    expect(plan.expectedRange.probableLow).toBe(4038);
    expect(plan.expectedRange.probableHigh).toBe(4050);
    const val = plan.importantLevels.find((l) => l.id === "lvl-val");
    const vah = plan.importantLevels.find((l) => l.id === "lvl-vah");
    expect(val?.roleAtCurrentPrice).toBe("SUPPORT");
    expect(vah?.roleAtCurrentPrice).toBe("RESISTANCE");
    expect(plan.zones.bestBuyZone).toMatch(/VAL/i);
    expect(plan.zones.bestSellZone).toMatch(/VAH/i);
  });

  it("9–11) probable/stretch ordering invariants when available", () => {
    const r = buildExpectedRange({
      live: 4042,
      val: 4038,
      vah: 4050,
      barHigh: 4048,
      barLow: 4032,
      atr: 10,
      mode: "COMPLETE",
      location: "INSIDE_VALUE"
    });
    expect(r.rangeAvailable).toBe(true);
    expect(r.probableLow!).toBeLessThanOrEqual(4042);
    expect(4042).toBeLessThanOrEqual(r.probableHigh!);
    expect(r.stretchLow!).toBeLessThanOrEqual(r.probableLow!);
    expect(r.probableHigh!).toBeLessThanOrEqual(r.stretchHigh!);
  });
});

describe("plan ordering", () => {
  it("4) BUY plan ordering valid", () => {
    expect(
      validatePlanOrdering({ direction: "BUY", entry: 4040, stop: 4030, tp1: 4050, tp2: 4055, tp3: 4060 })
        .valid
    ).toBe(true);
  });

  it("5) SELL plan ordering valid", () => {
    expect(
      validatePlanOrdering({ direction: "SELL", entry: 4040, stop: 4050, tp1: 4030, tp2: 4025, tp3: 4020 })
        .valid
    ).toBe(true);
  });

  it("6) invalid/mixed plan ordering rejected", () => {
    expect(
      validatePlanOrdering({ direction: "BUY", entry: 4040, stop: 4050, tp1: 4055 }).valid
    ).toBe(false);
    expect(
      validatePlanOrdering({ direction: "SELL", entry: 4040, stop: 4030, tp1: 4020 }).valid
    ).toBe(false);
    const buyBad = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({
        decision: "BUY",
        lastKnownPrice: 4042,
        marketStructure: {
          trend: "BULL",
          poc: 4045,
          vah: 4050,
          val: 4038,
          confirmationClassification: "BREAKOUT"
        }
      }),
      structure: baseDecision({
        decision: "BUY",
        lastKnownPrice: 4042,
        marketStructure: {
          trend: "BULL",
          poc: 4045,
          vah: 4050,
          val: 4038,
          confirmationClassification: "BREAKOUT"
        },
        entry: { price: 4040 },
        stopLoss: { price: 4055 },
        takeProfits: [{ label: "TP1", price: 4060 }]
      })
    });
    expect(buyBad.tradePlan.actionable).toBe(false);
    expect(buyBad.tradePlan.orderingValid).toBe(false);
  });
});

describe("level roles vs current price", () => {
  it("7) support above current cannot remain plain SUPPORT", () => {
    const plan = buildChartExampleIntradayFixture();
    for (const level of plan.importantLevels) {
      if (level.roleAtCurrentPrice === "SUPPORT") {
        expect(level.proximity).not.toBe("ABOVE");
      }
    }
    const val = plan.importantLevels.find((l) => l.id === "lvl-val");
    expect(val?.roleAtCurrentPrice).toBe("RECLAIM_LEVEL");
  });

  it("8) resistance below current cannot remain plain RESISTANCE", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({
        lastKnownPrice: 4055,
        ohlcv: { open: 4052, high: 4058, low: 4048, close: 4055, volume: 1 },
        atr: 10,
        marketStructure: { trend: "BULL", poc: 4045, vah: 4050, val: 4038, confirmationClassification: "NONE" }
      }),
      structure: baseDecision({
        lastKnownPrice: 4055,
        atr: 10,
        marketStructure: { trend: "BULL", poc: 4045, vah: 4050, val: 4038, confirmationClassification: "NONE" }
      })
    });
    for (const level of plan.importantLevels) {
      if (level.roleAtCurrentPrice === "RESISTANCE") {
        expect(level.proximity).not.toBe("BELOW");
      }
    }
  });

  it("never returns an important level without a structured reason", () => {
    const plan = buildChartExampleIntradayFixture();
    expect(plan.importantLevels.length).toBeGreaterThan(0);
    for (const level of plan.importantLevels) {
      expect(level.reasons.length).toBeGreaterThan(0);
      expect(level.roleAtCurrentPrice).toBeTruthy();
    }
  });
});

describe("scenarios + zones + trade plan", () => {
  it("12) bullish and bearish triggers are not contradictory", () => {
    const plan = buildChartExampleIntradayFixture();
    expect(plan.bullishScenario.trigger).toMatch(/reclaim/i);
    expect(plan.bearishScenario.trigger).toMatch(/breakdown|failed reclaim/i);
    expect(plan.bullishScenario.triggerPrice).not.toBeNull();
    expect(plan.bullishScenario.triggerPrice!).toBeGreaterThan(plan.expectedRange.currentPrice!);
    if (plan.bearishScenario.triggerPrice != null) {
      expect(plan.bearishScenario.triggerPrice).toBeLessThanOrEqual(
        plan.expectedRange.currentPrice! + 0.01
      );
    }
  });

  it("13) best zones adapt when price is outside value", () => {
    const below = buildChartExampleIntradayFixture();
    expect(below.zones.valueLocation).toBe("BELOW_VALUE");
    expect(below.zones.bestBuyZone).not.toMatch(/^4037.*4045/);
    expect(below.zones.bestBuyImmediate).toBe(false);
  });

  it("14) PREPARE with direction NONE does not show an active stop/TP plan", () => {
    const plan = buildChartExampleIntradayFixture();
    expect(plan.action).toBe("PREPARE");
    expect(plan.tradePlan.direction).toBe("NONE");
    expect(plan.tradePlan.cardKind).toBe("CONDITIONAL_REFERENCE");
    expect(plan.tradePlan.stopLoss).toBeNull();
    expect(plan.tradePlan.tp1).toBeNull();
    expect(plan.tradePlan.bullishConditional).not.toBeNull();
    expect(plan.tradePlan.bearishConditional).not.toBeNull();
  });

  it("15) MISMATCH remains NO_TRADE", () => {
    const plan = buildIntradayPlan({
      mode: "MISMATCH",
      quote: baseDecision(),
      structure: baseDecision()
    });
    expect(plan.action).toBe("NO_TRADE");
    expect(plan.importantLevels).toHaveLength(0);
    expect(plan.expectedRange.rangeAvailable).toBe(false);
  });

  it("BUY_NOW actionable plan when ordering + confirmation present", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({
        decision: "BUY",
        lastKnownPrice: 4042,
        atr: 10,
        marketStructure: {
          trend: "BULL",
          poc: 4045,
          vah: 4050,
          val: 4038,
          confirmationClassification: "BREAKOUT"
        }
      }),
      structure: baseDecision({
        decision: "BUY",
        lastKnownPrice: 4042,
        atr: 10,
        marketStructure: {
          trend: "BULL",
          poc: 4045,
          vah: 4050,
          val: 4038,
          confirmationClassification: "BREAKOUT"
        },
        entry: { price: 4040 },
        stopLoss: { price: 4030 },
        takeProfits: [
          { label: "TP1", price: 4050 },
          { label: "TP2", price: 4055 },
          { label: "TP3", price: 4060 }
        ],
        riskReward: { tp1: 1, tp2: 1.5, tp3: 2 }
      })
    });
    expect(plan.action).toBe("BUY_NOW");
    expect(plan.tradePlan.cardKind).toBe("ACTIVE_PLAN");
    expect(plan.tradePlan.direction).toBe("BUY");
    expect(plan.tradePlan.stopLoss!).toBeLessThan(Number(plan.tradePlan.entryZone));
    expect(Number(plan.tradePlan.entryZone)).toBeLessThan(plan.tradePlan.tp1!);
  });

  it("SELL_NOW actionable plan orders targets downward", () => {
    const plan = buildIntradayPlan({
      mode: "COMPLETE",
      quote: baseDecision({
        decision: "SELL",
        lastKnownPrice: 4042,
        atr: 10,
        marketStructure: {
          trend: "BEAR",
          poc: 4045,
          vah: 4050,
          val: 4038,
          confirmationClassification: "REJECTION"
        }
      }),
      structure: baseDecision({
        decision: "SELL",
        lastKnownPrice: 4042,
        atr: 10,
        marketStructure: {
          trend: "BEAR",
          poc: 4045,
          vah: 4050,
          val: 4038,
          confirmationClassification: "REJECTION"
        },
        entry: { price: 4042 },
        stopLoss: { price: 4052 },
        takeProfits: [
          { label: "TP1", price: 4032 },
          { label: "TP2", price: 4026 },
          { label: "TP3", price: 4020 }
        ]
      })
    });
    expect(["SELL_NOW", "SELL_ON_REJECTION"]).toContain(plan.action);
    expect(plan.tradePlan.cardKind).toBe("ACTIVE_PLAN");
    expect(plan.tradePlan.direction).toBe("SELL");
    expect(plan.tradePlan.tp1!).toBeLessThan(Number(plan.tradePlan.entryZone));
    expect(Number(plan.tradePlan.entryZone)).toBeLessThan(plan.tradePlan.stopLoss!);
    const tp1 = plan.importantLevels.find((l) => l.id === "lvl-tp1");
    expect(tp1?.side).toBe("DOWNSIDE");
  });
});

describe("PR #47 OHLC-only separation (16)", () => {
  it("LIVE_RANGE_ONLY prepares without POC/VAH/VAL important levels", () => {
    const plan = buildIntradayPlan({
      mode: "LIVE_RANGE_ONLY",
      quote: baseDecision({
        lastKnownPrice: 4034.8,
        marketStructure: null
      }),
      structure: null
    });
    expect(plan.action).toBe("PREPARE");
    expect(plan.importantLevels.every((l) => !["lvl-poc", "lvl-vah", "lvl-val"].includes(l.id))).toBe(
      true
    );
    expect(plan.whyNotReady).toMatch(/OHLC-only|structure/i);
  });
});
