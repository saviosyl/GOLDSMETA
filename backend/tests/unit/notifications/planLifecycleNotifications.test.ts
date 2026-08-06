import { beforeEach, describe, expect, it } from "vitest";
import {
  __constantsForTests,
  mapPlanLifecycleNotificationEvent,
  sendPlanLifecycleNotifications,
  type PlanLifecycleNotificationEvent
} from "../../../src/services/notifications/planLifecycleNotifications";
import { InMemoryStore } from "../../../src/services/storage/inMemoryStore";
import type { DecisionRecord } from "../../../src/models/types";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../../src/models/types";
import type { SessionPlanRecord } from "../../../src/services/decision/sessionPlanTypes";
import {
  InMemoryUserProfileStore,
  resetInMemoryUserProfiles,
  setUserProfileStoreForTests
} from "../../../src/services/auth/userProfileStore";
import { buildPendingProfile } from "../../../src/services/auth/userProfile";

const userId = "approved-user";

const decision = (overrides: Partial<DecisionRecord> = {}): DecisionRecord =>
  ({
    schemaVersion: "1.0",
    decisionId: "decision-1",
    userId: "shared-market-feed",
    symbol: "XAUUSD",
    timeframe: "15",
    barTime: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    marketDataTime: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
    decision: "BUY",
    confidence: 70,
    confidenceLabel: "HIGH",
    marketRegime: "TRENDING_UP",
    dataQuality: "GOOD",
    isProvisional: false,
    setupScore: 70,
    entry: { type: "ENTRY_ZONE", price: 2416.5, zoneLow: 2412, zoneHigh: 2418, condition: null },
    stopLoss: { price: 2408.6, reason: null },
    takeProfits: [{ label: "TP1", price: 2422.1, reason: "target" }],
    riskReward: { tp1: 0.7, tp2: null, tp3: null },
    breakeven: { state: "HOLD_ORIGINAL_STOP", trigger: null, newStop: null, reason: null },
    earlyExit: { exitNow: false, conditions: [] },
    bullishEvidence: [],
    bearishEvidence: [],
    reasonCodes: [],
    reasonSummary: [],
    warnings: [],
    missingInputs: [],
    invalidation: "Invalid below stop",
    disclaimer: "Analysis only",
    lifecycleState: "ACTIVE",
    snapshotId: null,
    ruleConfigVersion: "rules-1.1.0",
    pineScriptVersion: "3.0.0",
    backendVersion: "1.4.0-v5-intelligence",
    aiModelId: null,
    aiPromptVersion: null,
    aiSafetyDowngraded: false,
    notificationSent: false,
    currentSession: "OVERLAP",
    higherTimeframeBias: "BULLISH",
    lastKnownPrice: 2420,
    ohlcv: { open: 2417, high: 2422, low: 2415, close: 2420, volume: 100 },
    marketStructure: null,
    dataSourceLabel: "LIVE",
    environment: "LIVE",
    isTestDecision: false,
    ...overrides
  }) as DecisionRecord;

const plan = (overrides: Partial<SessionPlanRecord> = {}): SessionPlanRecord => {
  const now = new Date().toISOString();
  return {
    planId: "plan-1",
    planSourceKey: "source-1",
    userId: "shared-market-feed",
    symbol: "XAUUSD",
    schemaVersion: "1.1",
    pineScriptVersion: "3.0.0",
    alertRole: "PLAN_15M",
    lifecycleState: "WAITING_FOR_ENTRY_ZONE",
    planMutation: "CREATED",
    planStabilityLabel: "PLAN CREATED",
    direction: "BUY",
    entry: { type: "ENTRY_ZONE", price: 2416.5, zoneLow: 2412, zoneHigh: 2418, condition: null },
    stopLoss: { price: 2408.6, reason: null },
    takeProfits: [{ label: "TP1", price: 2422.1, reason: "target" }],
    riskReward: { tp1: 0.7, tp2: null, tp3: null },
    confirmationState: "OUTSIDE_ZONE",
    fourHourContext: null,
    chartMatchesRole: true,
    testMode: false,
    currentPrice: 2420,
    distanceToEntryPoints: 6,
    distanceToStopPoints: 11.4,
    distanceToTp1Points: 2.1,
    quoteAgeSeconds: null,
    signalAgeSeconds: null,
    lastQuoteAt: null,
    lastPlanAt: now,
    lastConfirmAt: null,
    planQuality: { grade: "B", reasons: [] },
    quickTarget: {
      enabled: true,
      tp1: 2422.1,
      tp1Label: "TP1",
      tp1Reason: "target",
      roomPoints: 5.6,
      roomOk: true,
      riskReward: 0.7,
      rrOk: true,
      structuralLevelUsed: 2422.1
    },
    sourceDecisionId: "decision-1",
    marketStructureMode: "COMPLETE",
    session: "OVERLAP",
    higherTimeframeBias: "BULLISH",
    invalidation: "Invalid below stop",
    geometryValid: true,
    geometryReasonCodes: [],
    geometryMessage: null,
    createdAt: now,
    updatedAt: now,
    validUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
    environment: "LIVE",
    isTestPlan: false,
    safety: {
      autoTrade: "OFF",
      demoOrderSubmission: false,
      liveTrading: false,
      analysisOnly: true,
      brokerOrders: "NONE"
    },
    disclaimer: "Analysis only",
    ...overrides
  };
};

const preferenceFor = (
  event: PlanLifecycleNotificationEvent
): keyof typeof DEFAULT_NOTIFICATION_PREFERENCES => {
  if (event === "CONFIRM_5M_PASSED" || event === "CONFIRM_5M_FAILED") return "CONFIRM_5M";
  if (event === "PLAN_EXPIRED") return "PLAN_INVALIDATED";
  if (event === "TP1_REACHED" || event === "TP2_REACHED") return "TARGETS_REACHED";
  return event;
};

describe("plan lifecycle notifications", () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    resetInMemoryUserProfiles();
    const profiles = new InMemoryUserProfileStore();
    setUserProfileStoreForTests(profiles);
    await profiles.upsertProfile({
      ...buildPendingProfile({
        uid: userId,
        email: "approved@example.com",
        firstName: "Approved",
        lastName: "User",
        countryOfResidence: "DE"
      }),
      role: "USER_APPROVED",
      approvalStatus: "APPROVED",
      approvedAt: new Date().toISOString()
    });
    store = new InMemoryStore();
  });

  const enable = async (event: PlanLifecycleNotificationEvent): Promise<void> => {
    await store.updateSettings(userId, {
      notificationPreferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        [preferenceFor(event)]: true
      }
    });
  };

  it("maps meaningful lifecycle changes and ignores repeated wait/no-plan states", () => {
    expect(mapPlanLifecycleNotificationEvent(null, plan())).toBe("VALID_PLAN_CREATED");
    expect(
      mapPlanLifecycleNotificationEvent(
        plan({ confirmationState: "OUTSIDE_ZONE", planMutation: "PLAN_UNCHANGED" }),
        plan({
          planMutation: "STATUS_UPDATED",
          planStabilityLabel: "STATUS UPDATED",
          confirmationState: "REJECTION_CONFIRMED"
        })
      )
    ).toBe("CONFIRM_5M_PASSED");
    expect(
      mapPlanLifecycleNotificationEvent(
        plan({ confirmationState: "REJECTION_CONFIRMED", planMutation: "PLAN_UNCHANGED" }),
        plan({
          planMutation: "STATUS_UPDATED",
          planStabilityLabel: "STATUS UPDATED",
          confirmationState: "REJECTION_CONFIRMED"
        })
      )
    ).toBeNull();
    expect(
      mapPlanLifecycleNotificationEvent(
        plan({ lifecycleState: "NO_VALID_PLAN", direction: null, planQuality: { grade: "NO_PLAN", reasons: [] } }),
        plan({
          lifecycleState: "NO_VALID_PLAN",
          planMutation: "PLAN_UNCHANGED",
          planStabilityLabel: "PLAN UNCHANGED",
          direction: null,
          planQuality: { grade: "NO_PLAN", reasons: [] }
        })
      )
    ).toBeNull();
  });

  it("writes one in-app notification per uid/plan/event/source dedupe key", async () => {
    await enable("VALID_PLAN_CREATED");
    const current = plan();

    const first = await sendPlanLifecycleNotifications({
      store,
      previousPlan: null,
      plan: current,
      decision: decision(),
      sourceEventId: "source-event-1"
    });
    const second = await sendPlanLifecycleNotifications({
      store,
      previousPlan: null,
      plan: current,
      decision: decision(),
      sourceEventId: "source-event-1"
    });

    expect(first.event).toBe("VALID_PLAN_CREATED");
    expect(first.inAppWritten).toBe(1);
    expect(second.inAppWritten).toBe(0);
    expect(await store.listInAppNotifications(userId)).toHaveLength(1);
  });

  it("does not fan out when the user has not opted in", async () => {
    const result = await sendPlanLifecycleNotifications({
      store,
      previousPlan: null,
      plan: plan(),
      decision: decision(),
      sourceEventId: "source-event-1"
    });

    expect(result.event).toBe("VALID_PLAN_CREATED");
    expect(result.recipients).toBe(0);
    expect(await store.listInAppNotifications(userId)).toHaveLength(0);
  });

  it("enforces ENTRY_ZONE_APPROACHING cooldown across different source events", async () => {
    await enable("ENTRY_ZONE_APPROACHING");
    const now = Date.now();
    const previous = plan({
      planMutation: "PLAN_UNCHANGED",
      planStabilityLabel: "PLAN UNCHANGED",
      lifecycleState: "WAITING_FOR_ENTRY_ZONE",
      distanceToEntryPoints: 7
    });
    const approaching = plan({
      planMutation: "PLAN_UNCHANGED",
      planStabilityLabel: "PLAN UNCHANGED",
      lifecycleState: "WAITING_FOR_ENTRY_ZONE",
      distanceToEntryPoints: 4
    });

    const first = await sendPlanLifecycleNotifications({
      store,
      previousPlan: previous,
      plan: approaching,
      decision: decision(),
      sourceEventId: "quote-1",
      now
    });
    const second = await sendPlanLifecycleNotifications({
      store,
      previousPlan: previous,
      plan: approaching,
      decision: decision(),
      sourceEventId: "quote-2",
      now: now + 60_000
    });
    const third = await sendPlanLifecycleNotifications({
      store,
      previousPlan: previous,
      plan: approaching,
      decision: decision(),
      sourceEventId: "quote-3",
      now: now + __constantsForTests.APPROACHING_COOLDOWN_MS + 1_000
    });

    expect(first.inAppWritten).toBe(1);
    expect(second.inAppWritten).toBe(0);
    expect(third.inAppWritten).toBe(1);
    expect(await store.listInAppNotifications(userId)).toHaveLength(2);
  });
});
