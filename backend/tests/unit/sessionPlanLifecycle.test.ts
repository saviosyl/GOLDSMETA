import { beforeEach, describe, expect, it } from "vitest";
import strategyFixture from "../fixtures/intradayStrategyPayload.json";
import quoteFixture from "../fixtures/intradayQuotePayload.json";
import plan15Fixture from "../fixtures/pine3Plan15mPayload.json";
import confirm5Fixture from "../fixtures/pine3Confirm5mPayload.json";
import quote1Fixture from "../fixtures/pine3Quote1mPayload.json";
import { tradingViewPayloadSchema, type DecisionRecord, type TradingViewPayload } from "../../src/models/types";
import {
  isConfirmAlert,
  isPlanSourceAlert,
  isQuoteAlert,
  resolveAlertRole
} from "../../src/services/decision/alertRole";
import { evaluatePlanQuality } from "../../src/services/decision/planQuality";
import { selectQuickTargetTp1, MIN_QUICK_TARGET_RR } from "../../src/services/decision/quickTargetTp";
import { processSessionPlanLifecycle } from "../../src/services/decision/sessionPlanLifecycle";
import { processDecisionPipeline } from "../../src/services/decision/decisionPipeline";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { isCTraderLiveEnabled } from "../../src/services/broker/ctrader/flags";
import { buildStableEventId } from "../../src/services/webhook/eventId";
import { freshPayload } from "../helpers";

const baseDecision = (
  over: Partial<DecisionRecord> = {},
  payloadHints: { price?: number } = {}
): DecisionRecord => {
  const price = payloadHints.price ?? 2420.48;
  return {
    schemaVersion: "1.0",
    decisionId: "dec-plan-1",
    userId: "default-user",
    symbol: "XAUUSD",
    timeframe: "15",
    barTime: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    marketDataTime: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
    decision: "BUY",
    confidence: 72,
    confidenceLabel: "HIGH",
    marketRegime: "TRENDING_UP",
    dataQuality: "GOOD",
    isProvisional: false,
    setupScore: 75,
    entry: {
      type: "ENTRY_ZONE",
      price: 2416.5,
      zoneLow: 2412.0,
      zoneHigh: 2418.0,
      condition: "Buy pullback into value"
    },
    stopLoss: { price: 2408.6, reason: "Below opening range / structure" },
    takeProfits: [
      { label: "TP1", price: 2422.1, reason: "Day high / resistance" },
      { label: "TP2", price: 2435.0, reason: "Prev day high" }
    ],
    riskReward: { tp1: 0.7, tp2: 2.3, tp3: null },
    breakeven: {
      state: "HOLD_ORIGINAL_STOP",
      trigger: null,
      newStop: null,
      reason: null
    },
    earlyExit: { exitNow: false, conditions: [] },
    bullishEvidence: ["TREND_BULLISH"],
    bearishEvidence: [],
    reasonCodes: [],
    reasonSummary: ["Buy setup"],
    warnings: [],
    missingInputs: [],
    invalidation: "Accept below stop",
    disclaimer: "Analysis only",
    lifecycleState: "ACTIVE",
    snapshotId: "snap1",
    ruleConfigVersion: "rules-1.1.0",
    pineScriptVersion: "3.0.0",
    backendVersion: "1.4.0-v5-intelligence",
    aiModelId: null,
    aiPromptVersion: null,
    aiSafetyDowngraded: false,
    notificationSent: false,
    currentSession: "OVERLAP",
    higherTimeframeBias: "BULLISH",
    lastKnownPrice: price,
    ohlcv: { open: 2417, high: 2422, low: 2415, close: price, volume: 100 },
    marketStructure: {
      trend: "BULLISH",
      trendStrength: 72,
      poc: 2416.5,
      vah: 2420.0,
      val: 2412.0,
      confirmationClassification: "CONTINUATION",
      confirmationDirection: "BULLISH",
      confirmationCandleType: null
    },
    dataSourceLabel: "LIVE",
    environment: "LIVE",
    isTestDecision: false,
    ...over
  } as DecisionRecord;
};

describe("Pine Bridge contracts (schema 1.0 + 1.1)", () => {
  it("accepts Pine 2.1.0 STRATEGY and QUOTE fixtures (schemaVersion 1.0)", () => {
    expect(tradingViewPayloadSchema.safeParse(strategyFixture).success).toBe(true);
    expect(tradingViewPayloadSchema.safeParse(quoteFixture).success).toBe(true);
    expect(resolveAlertRole(strategyFixture as TradingViewPayload)).toBe("LEGACY_STRATEGY");
    expect(resolveAlertRole(quoteFixture as TradingViewPayload)).toBe("LEGACY_QUOTE");
    expect(isPlanSourceAlert(resolveAlertRole(strategyFixture as TradingViewPayload))).toBe(true);
    expect(isQuoteAlert(resolveAlertRole(quoteFixture as TradingViewPayload))).toBe(true);
  });

  it("accepts Pine 3.0.0 PLAN_15M / CONFIRM_5M / QUOTE_1M (schemaVersion 1.1)", () => {
    for (const fixture of [plan15Fixture, confirm5Fixture, quote1Fixture]) {
      const parsed = tradingViewPayloadSchema.safeParse(fixture);
      expect(parsed.success).toBe(true);
    }
    expect(resolveAlertRole(plan15Fixture as TradingViewPayload)).toBe("PLAN_15M");
    expect(resolveAlertRole(confirm5Fixture as TradingViewPayload)).toBe("CONFIRM_5M");
    expect(resolveAlertRole(quote1Fixture as TradingViewPayload)).toBe("QUOTE_1M");
    expect(isConfirmAlert("CONFIRM_5M")).toBe(true);
  });

  it("keeps event ids distinct across roles", () => {
    const planId = buildStableEventId(plan15Fixture as TradingViewPayload);
    const confirmId = buildStableEventId(confirm5Fixture as TradingViewPayload);
    const quoteId = buildStableEventId(quote1Fixture as TradingViewPayload);
    expect(new Set([planId, confirmId, quoteId]).size).toBe(3);
  });
});

describe("session plan stability", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it("creates a plan from PLAN_15M and keeps planId stable across QUOTE_1M", async () => {
    const planPayload = tradingViewPayloadSchema.parse(plan15Fixture);
    const created = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: planPayload,
      decision: baseDecision(),
      store,
      marketStructureMode: "COMPLETE"
    });
    expect(created.planMutation).toMatch(/CREATED|REPLACED|PLAN_UNCHANGED/);
    expect(created.lifecycleState).not.toBe("NO_VALID_PLAN");
    expect(created.direction).toBe("BUY");
    expect(created.entry?.price).toBe(2416.5);
    expect(created.safety.autoTrade).toBe("OFF");
    expect(created.safety.brokerOrders).toBe("NONE");

    const quotePayload = tradingViewPayloadSchema.parse(quote1Fixture);
    const afterQuote = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: quotePayload,
      decision: baseDecision({
        decisionId: "dec-quote",
        timeframe: "1",
        lastKnownPrice: 2420.55,
        decision: "WAIT",
        entry: { type: "NONE", price: null, zoneLow: null, zoneHigh: null, condition: null },
        stopLoss: { price: null, reason: null },
        takeProfits: [],
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
      }),
      store,
      marketStructureMode: "COMPLETE"
    });

    expect(afterQuote.planId).toBe(created.planId);
    expect(afterQuote.planMutation).toBe("PLAN_UNCHANGED");
    expect(afterQuote.planStabilityLabel).toBe("PLAN UNCHANGED");
    expect(afterQuote.direction).toBe("BUY");
    expect(afterQuote.entry?.price).toBe(2416.5);
    expect(afterQuote.stopLoss?.price).toBe(2408.6);
    expect(afterQuote.takeProfits.map((t) => t.price)).toEqual(created.takeProfits.map((t) => t.price));
    expect(afterQuote.currentPrice).toBe(2420.55);
    expect(afterQuote.distanceToEntryPoints).not.toBeNull();
  });

  it("CONFIRM_5M updates status only and never replaces entry/stop/TP", async () => {
    const planPayload = tradingViewPayloadSchema.parse(plan15Fixture);
    const created = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: planPayload,
      decision: baseDecision(),
      store,
      marketStructureMode: "COMPLETE"
    });

    const confirmPayload = tradingViewPayloadSchema.parse(confirm5Fixture);
    const afterConfirm = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: confirmPayload,
      decision: baseDecision({
        decisionId: "dec-confirm",
        timeframe: "5",
        decision: "SELL",
        entry: { type: "MARKET", price: 9999, zoneLow: null, zoneHigh: null, condition: null },
        stopLoss: { price: 1, reason: "should not apply" },
        takeProfits: [{ label: "TP1", price: 2, reason: "should not apply" }]
      }),
      store,
      marketStructureMode: "COMPLETE"
    });

    expect(afterConfirm.planId).toBe(created.planId);
    // Bearish rejection must not confirm a BUY plan — authoritative state fails closed.
    expect(afterConfirm.confirmationState).toBe("CONFIRMATION_FAILED");
    if (created.geometryValid !== false && created.lifecycleState !== "NO_VALID_PLAN") {
      expect(afterConfirm.planMutation).toBe("STATUS_UPDATED");
      expect(afterConfirm.direction).toBe("BUY");
      expect(afterConfirm.entry?.price).toBe(created.entry?.price);
      expect(afterConfirm.stopLoss?.price).toBe(created.stopLoss?.price);
      expect(afterConfirm.takeProfits).toEqual(created.takeProfits);
    }
  });

  it("missing 15M plan → NO_VALID_PLAN for quote/confirm alone", async () => {
    const quoteOnly = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: tradingViewPayloadSchema.parse(quote1Fixture),
      decision: baseDecision({ decision: "WAIT" }),
      store,
      marketStructureMode: "LIVE_RANGE_ONLY"
    });
    expect(quoteOnly.lifecycleState).toBe("NO_VALID_PLAN");
    expect(quoteOnly.planQuality.grade).toBe("NO_PLAN");

    const confirmOnly = await processSessionPlanLifecycle({
      userId: "u2",
      payload: tradingViewPayloadSchema.parse(confirm5Fixture),
      decision: baseDecision({ userId: "u2", decision: "WAIT" }),
      store,
      marketStructureMode: "LIVE_RANGE_ONLY"
    });
    expect(confirmOnly.lifecycleState).toBe("NO_VALID_PLAN");
    expect(confirmOnly.planQuality.reasons.join(" ")).toMatch(/CONFIRM_WITHOUT_PLAN|NO_VALID/);
  });

  it("MISMATCH → NO_TRADE and does not invent a tradeable plan", async () => {
    await processSessionPlanLifecycle({
      userId: "default-user",
      payload: tradingViewPayloadSchema.parse(plan15Fixture),
      decision: baseDecision(),
      store,
      marketStructureMode: "COMPLETE"
    });
    const mismatched = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: tradingViewPayloadSchema.parse(quote1Fixture),
      decision: baseDecision({ lastKnownPrice: 9999 }),
      store,
      marketStructureMode: "MISMATCH"
    });
    expect(mismatched.lifecycleState).toBe("NO_TRADE");
    expect(mismatched.planMutation).toBe("NO_TRADE");
    expect(mismatched.planQuality.grade).toBe("NO_PLAN");
  });

  it("handles duplicate PLAN_15M without flipping planId when planSourceKey matches", async () => {
    const payload = tradingViewPayloadSchema.parse(plan15Fixture);
    const first = await processSessionPlanLifecycle({
      userId: "default-user",
      payload,
      decision: baseDecision({ decisionId: "d1" }),
      store,
      marketStructureMode: "COMPLETE"
    });
    const second = await processSessionPlanLifecycle({
      userId: "default-user",
      payload,
      decision: baseDecision({ decisionId: "d2" }),
      store,
      marketStructureMode: "COMPLETE"
    });
    expect(second.planId).toBe(first.planId);
    expect(second.planSourceKey).toBe(first.planSourceKey);
  });

  it("out-of-order quote before plan does not create strategy levels", async () => {
    const earlyQuote = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: tradingViewPayloadSchema.parse(quote1Fixture),
      decision: baseDecision({ decision: "WAIT", timeframe: "1" }),
      store
    });
    expect(earlyQuote.direction).toBeNull();
    expect(earlyQuote.entry).toBeNull();

    const laterPlan = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: tradingViewPayloadSchema.parse(plan15Fixture),
      decision: baseDecision(),
      store,
      marketStructureMode: "COMPLETE"
    });
    expect(laterPlan.direction).toBe("BUY");
    expect(laterPlan.entry?.price).toBe(2416.5);
  });
});

describe("quick-target TP1 + plan quality", () => {
  it("selects nearest structural level with room and RR validation", () => {
    const decision = baseDecision();
    const qt = selectQuickTargetTp1({
      direction: "BUY",
      entry: 2416.5,
      stop: 2408.6,
      decision,
      optionalIndicators: plan15Fixture.optionalIndicators as Record<string, unknown>
    });
    expect(qt.enabled).toBe(true);
    expect(qt.tp1).not.toBeNull();
    expect(qt.tp1!).toBeGreaterThan(2416.5);
    expect(qt.roomOk).toBe(true);
    expect(qt.rrOk).toBe(true);
    expect(qt.riskReward!).toBeGreaterThanOrEqual(MIN_QUICK_TARGET_RR);
  });

  it("grades A/B/NO_PLAN with reasons (C/STRUCTURE_ONLY is never tradeable)", () => {
    const a = evaluatePlanQuality({
      decision: baseDecision(),
      marketStructureMode: "COMPLETE",
      confirmationState: "BREAKOUT_CONFIRMED",
      chartMatchesRole: true,
      quickTargetRrOk: true,
      hasFourHourContext: true
    });
    expect(a.grade).toBe("A");

    const b = evaluatePlanQuality({
      decision: baseDecision(),
      marketStructureMode: "COMPLETE",
      confirmationState: "OUTSIDE_ZONE",
      chartMatchesRole: true,
      quickTargetRrOk: true,
      hasFourHourContext: false
    });
    expect(["B", "NO_PLAN"]).toContain(b.grade);

    const structureOnly = evaluatePlanQuality({
      decision: baseDecision({
        decision: "WAIT",
        entry: { type: "LIMIT", price: null, zoneLow: null, zoneHigh: null, condition: null },
        stopLoss: { price: null, reason: null },
        takeProfits: []
      }),
      marketStructureMode: "COMPLETE",
      confirmationState: null,
      chartMatchesRole: true,
      quickTargetRrOk: false,
      hasFourHourContext: false
    });
    expect(structureOnly.grade).toBe("NO_PLAN");
    expect(structureOnly.reasons.join(" ")).toMatch(/STRUCTURE_ONLY|WAIT_NO_VALID|INCOMPLETE/);

    const none = evaluatePlanQuality({
      decision: null,
      marketStructureMode: "UNAVAILABLE",
      confirmationState: null,
      chartMatchesRole: null,
      quickTargetRrOk: false,
      hasFourHourContext: false
    });
    expect(none.grade).toBe("NO_PLAN");
  });
});

describe("2.1.0 compat + pipeline + no broker orders", () => {
  it("legacy STRATEGY creates a session plan; legacy QUOTE marks PLAN UNCHANGED", async () => {
    const store = new InMemoryStore();
    const strategy = await processDecisionPipeline(
      "default-user",
      freshPayload(strategyFixture),
      "evt-strategy-1",
      store,
      new AiExplainer(),
      { environment: "LIVE", isTestDecision: false }
    );
    expect(strategy).toBeDefined();
    const plan = await store.getActiveSessionPlan("default-user");
    expect(plan).toBeDefined();

    const lockedDirection = plan!.direction;
    const lockedEntry = plan!.entry?.price;
    const lockedPlanId = plan!.planId;

    await processDecisionPipeline(
      "default-user",
      freshPayload(quoteFixture),
      "evt-quote-1",
      store,
      new AiExplainer(),
      { environment: "LIVE", isTestDecision: false }
    );
    const after = await store.getActiveSessionPlan("default-user");
    expect(after?.planId).toBe(lockedPlanId);
    expect(after?.planMutation).toBe("PLAN_UNCHANGED");
    expect(after?.direction).toBe(lockedDirection);
    expect(after?.entry?.price).toBe(lockedEntry);
  });

  it("Pine 3.0 pipeline keeps trading locks OFF", async () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    const store = new InMemoryStore();
    await processDecisionPipeline(
      "default-user",
      freshPayload(plan15Fixture),
      "evt-p15",
      store,
      new AiExplainer()
    );
    await processDecisionPipeline(
      "default-user",
      freshPayload(confirm5Fixture),
      "evt-c5",
      store,
      new AiExplainer()
    );
    await processDecisionPipeline(
      "default-user",
      freshPayload(quote1Fixture),
      "evt-q1",
      store,
      new AiExplainer()
    );
    const plan = await store.getActiveSessionPlan("default-user");
    expect(plan?.safety).toEqual({
      autoTrade: "OFF",
      demoOrderSubmission: false,
      liveTrading: false,
      analysisOnly: true,
      brokerOrders: "NONE"
    });
    // No setups created from quote/confirm path alone beyond analysis — WAIT confirms skip.
    const setups = await store.listSetups("default-user", 50);
    for (const s of setups) {
      expect(s.manualExecution).toBeUndefined();
    }
  });

  it("4H context is stored and never used as entry trigger flag", async () => {
    const store = new InMemoryStore();
    const plan = await processSessionPlanLifecycle({
      userId: "default-user",
      payload: tradingViewPayloadSchema.parse(plan15Fixture),
      decision: baseDecision(),
      store,
      marketStructureMode: "COMPLETE"
    });
    expect(plan.fourHourContext).not.toBeNull();
    expect(plan.fourHourContext?.neverTriggersEntry).toBe(true);
  });
});
