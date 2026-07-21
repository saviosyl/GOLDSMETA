import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../services/storage/inMemoryStore.js";
import type { DecisionRecord } from "../../models/types.js";
import { SETUP_RULES_VERSION } from "../../config/setupLifecycleConfig.js";
import { createSetupFromDecision } from "./createSetup.js";
import { updateSetupsFromBar } from "./updateSetupsFromBar.js";
import { computeSetupAnalytics } from "./analytics.js";
import { IG_DEMO_ADAPTER_PLAN, MockBrokerAdapter } from "../brokers/mockBrokerAdapter.js";
import type { SetupRecord } from "../../models/setup.js";

const BAR0 = "2026-07-20T10:00:00.000Z";

function baseDecision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  const now = "2026-07-20T10:00:05.000Z";
  return {
    schemaVersion: "1.0",
    decisionId: "dec-buy-1",
    userId: "user-1",
    symbol: "XAUUSD",
    timeframe: "15",
    barTime: BAR0,
    generatedAt: now,
    marketDataTime: BAR0,
    validUntil: "2026-07-20T10:15:05.000Z",
    decision: "BUY",
    confidence: 72,
    confidenceLabel: "HIGH",
    marketRegime: "TRENDING_UP",
    dataQuality: "GOOD",
    isProvisional: false,
    setupScore: 78,
    entry: {
      type: "LIMIT",
      price: 2645,
      zoneLow: 2644,
      zoneHigh: 2646,
      condition: "retest"
    },
    stopLoss: { price: 2640, reason: "below VAL" },
    takeProfits: [
      { label: "TP1", price: 2652, reason: "t1" },
      { label: "TP2", price: 2658, reason: "t2" },
      { label: "TP3", price: 2665, reason: "t3" }
    ],
    riskReward: { tp1: 1.4, tp2: 2.6, tp3: 4 },
    breakeven: {
      state: "MOVE_TO_BREAKEVEN",
      trigger: "TP1",
      newStop: 2645,
      reason: "model"
    },
    earlyExit: { exitNow: false, conditions: [] },
    bullishEvidence: ["trend", "breakout"],
    bearishEvidence: [],
    reasonCodes: ["TREND_BULLISH", "BREAKOUT_OR_RETEST"],
    reasonSummary: ["Bullish breakout"],
    warnings: [],
    missingInputs: [],
    invalidation: "Below stop",
    disclaimer: "Analysis only",
    lifecycleState: "ACTIVE",
    snapshotId: "snap-1",
    ruleConfigVersion: "rules-1.1.0",
    pineScriptVersion: "2.0.4",
    backendVersion: "1.4.0-v5-intelligence",
    aiModelId: null,
    aiPromptVersion: null,
    aiSafetyDowngraded: false,
    notificationSent: false,
    currentSession: "LONDON",
    higherTimeframeBias: "BULLISH",
    lastKnownPrice: 2648,
    ohlcv: { open: 2647, high: 2650, low: 2645, close: 2648, volume: 100 },
    marketStructure: {
      trend: "BULLISH",
      trendStrength: 0.7,
      poc: 2648,
      vah: 2655,
      val: 2640,
      confirmationClassification: "BREAKOUT",
      confirmationDirection: "BULLISH",
      confirmationCandleType: "ENGULFING"
    },
    dataSourceLabel: "TEST",
    environment: "TEST",
    isTestDecision: true,
    ...over
  };
}

function bar(
  eventId: string,
  o: number,
  h: number,
  l: number,
  c: number,
  timeIso: string
) {
  return {
    eventId,
    barTime: timeIso,
    open: o,
    high: h,
    low: l,
    close: c,
    isConfirmedBar: true
  };
}

describe("setup lifecycle", () => {
  let store: InMemoryStore;
  const userId = "user-1";

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it("WAIT creates no setup", async () => {
    const d = baseDecision({ decision: "WAIT", decisionId: "dec-wait", lifecycleState: "INCOMPLETE" });
    const setup = await createSetupFromDecision(store, d);
    expect(setup).toBeNull();
    expect(store.listSetups(userId)).toHaveLength(0);
  });

  it("BUY creates one setup with rule-config version", async () => {
    const setup = await createSetupFromDecision(store, baseDecision());
    expect(setup).not.toBeNull();
    expect(setup!.status).toBe("WAITING_FOR_ENTRY");
    expect(setup!.ruleConfigVersion).toBe(SETUP_RULES_VERSION);
    expect(setup!.direction).toBe("BUY");
    expect(setup!.environment).toBe("TEST");
  });

  it("idempotent: same decisionId does not duplicate setup", async () => {
    const d = baseDecision();
    await createSetupFromDecision(store, d);
    await createSetupFromDecision(store, d);
    expect(store.listSetups(userId)).toHaveLength(1);
  });

  it("rejects second active setup while one is open", async () => {
    await createSetupFromDecision(store, baseDecision());
    const second = await createSetupFromDecision(
      store,
      baseDecision({
        decisionId: "dec-buy-2",
        barTime: "2026-07-20T10:15:00.000Z",
        marketDataTime: "2026-07-20T10:15:00.000Z"
      })
    );
    expect(second).toBeNull();
    expect(store.listSetups(userId)).toHaveLength(1);
  });

  it("BUY: entry → TP1 → TP2 → TP3", async () => {
    const created = await createSetupFromDecision(store, baseDecision());
    expect(created).not.toBeNull();

    await updateSetupsFromBar(
      store,
      userId,
      bar("b1", 2648, 2650, 2644.5, 2647, "2026-07-20T10:15:00.000Z"),
      "TEST"
    );
    let s = store.getSetup(userId, created!.setupId)!;
    expect(s.status).toBe("ENTRY_TRIGGERED");
    expect(s.entryTriggeredAt).toBeTruthy();

    await updateSetupsFromBar(
      store,
      userId,
      bar("b2", 2647, 2652.5, 2646, 2651, "2026-07-20T10:30:00.000Z"),
      "TEST"
    );
    s = store.getSetup(userId, created!.setupId)!;
    expect(s.statusHistory.some((h) => h.to === "TP1_HIT")).toBe(true);
    expect(s.status).toBe("BREAKEVEN");

    await updateSetupsFromBar(
      store,
      userId,
      bar("b3", 2651, 2658.5, 2650, 2657, "2026-07-20T10:45:00.000Z"),
      "TEST"
    );
    s = store.getSetup(userId, created!.setupId)!;
    expect(s.status).toBe("TP2_HIT");

    await updateSetupsFromBar(
      store,
      userId,
      bar("b4", 2657, 2666, 2656, 2664, "2026-07-20T11:00:00.000Z"),
      "TEST"
    );
    s = store.getSetup(userId, created!.setupId)!;
    expect(s.status).toBe("CLOSED");
    expect(s.resolution).toBe("WIN_TP3");
    expect(s.outcome.rawRealisedR).toBeGreaterThan(0);
    expect(s.outcome.modelledRealisedR).not.toBeNull();
    expect(s.outcome.modelledRealisedR).not.toBe(s.outcome.rawRealisedR);
    expect(s.outcome.managementNotes.length).toBeGreaterThan(0);
  });

  it("SELL lifecycle entry then SL", async () => {
    const d = baseDecision({
      decisionId: "dec-sell-1",
      decision: "SELL",
      entry: { type: "LIMIT", price: 2651, zoneLow: 2650, zoneHigh: 2652, condition: "retest" },
      stopLoss: { price: 2658, reason: "sl" },
      takeProfits: [
        { label: "TP1", price: 2645, reason: "t1" },
        { label: "TP2", price: 2640, reason: "t2" },
        { label: "TP3", price: 2635, reason: "t3" }
      ],
      riskReward: { tp1: 1.0, tp2: 1.8, tp3: 2.5 },
      marketStructure: {
        trend: "BEARISH",
        trendStrength: 0.6,
        poc: 2648,
        vah: 2655,
        val: 2640,
        confirmationClassification: "BREAKOUT",
        confirmationDirection: "BEARISH",
        confirmationCandleType: "ENGULFING"
      }
    });
    const created = await createSetupFromDecision(store, d);
    expect(created).not.toBeNull();

    await updateSetupsFromBar(
      store,
      userId,
      bar("s1", 2648, 2651.5, 2647, 2650.5, "2026-07-20T10:15:00.000Z"),
      "TEST"
    );
    let s = store.getSetup(userId, created!.setupId)!;
    expect(s.status).toBe("ENTRY_TRIGGERED");

    await updateSetupsFromBar(
      store,
      userId,
      bar("s2", 2650, 2659, 2649, 2657, "2026-07-20T10:30:00.000Z"),
      "TEST"
    );
    s = store.getSetup(userId, created!.setupId)!;
    expect(s.resolution).toBe("LOSS_SL");
    expect(s.outcome.rawRealisedR).toBe(-1);
  });

  it("duplicate bar eventId does not update twice", async () => {
    const created = await createSetupFromDecision(store, baseDecision());
    const b = bar("dup", 2648, 2650, 2644.5, 2647, "2026-07-20T10:15:00.000Z");
    await updateSetupsFromBar(store, userId, b, "TEST");
    await updateSetupsFromBar(store, userId, b, "TEST");
    const s = store.getSetup(userId, created!.setupId)!;
    expect(s.appliedBarEventIds.filter((id) => id === "dup")).toHaveLength(1);
    expect(s.statusHistory.filter((h) => h.to === "ENTRY_TRIGGERED")).toHaveLength(1);
  });

  it("same-candle SL+TP → AMBIGUOUS_INTRABAR worst-case SL", async () => {
    const created = await createSetupFromDecision(store, baseDecision());
    await updateSetupsFromBar(
      store,
      userId,
      bar("e1", 2648, 2650, 2644.5, 2647, "2026-07-20T10:15:00.000Z"),
      "TEST"
    );
    await updateSetupsFromBar(
      store,
      userId,
      bar("amb", 2645, 2653, 2639, 2648, "2026-07-20T10:30:00.000Z"),
      "TEST"
    );
    const s = store.getSetup(userId, created!.setupId)!;
    expect(s.statusHistory.some((h) => h.to === "AMBIGUOUS_INTRABAR")).toBe(true);
    expect(s.resolution).toBe("AMBIGUOUS_WORST_CASE_SL");
    expect(s.outcome.rawRealisedR).toBe(-1);
    expect(s.statusHistory.some((h) => h.reason.includes("WORST_CASE"))).toBe(true);
  });

  it("expires when bars exceed maxBarsToEntry without fill", async () => {
    const created = await createSetupFromDecision(store, baseDecision());
    // Stay above entry (2645) and below TP1 (2652) and above SL (2640).
    for (let i = 1; i <= 9; i++) {
      const t = new Date(Date.UTC(2026, 6, 20, 10, i * 15)).toISOString();
      await updateSetupsFromBar(
        store,
        userId,
        bar(`exp${i}`, 2648, 2650, 2646.5, 2649, t),
        "TEST"
      );
    }
    const s = store.getSetup(userId, created!.setupId)!;
    expect(s.resolution).toBe("EXPIRED");
    expect(s.statusHistory.some((h) => h.to === "EXPIRED")).toBe(true);
  });

  it("invalidates when SL touched before entry (BUY)", async () => {
    const created = await createSetupFromDecision(store, baseDecision());
    // High stays below entry 2645 so entry is not filled; low pierces SL 2640.
    await updateSetupsFromBar(
      store,
      userId,
      bar("inv", 2644, 2644.5, 2639, 2641, "2026-07-20T10:15:00.000Z"),
      "TEST"
    );
    const s = store.getSetup(userId, created!.setupId)!;
    expect(s.resolution).toBe("INVALIDATED");
  });

  it("analytics never mixes TEST and LIVE", async () => {
    const created = await createSetupFromDecision(store, baseDecision());
    await updateSetupsFromBar(
      store,
      userId,
      bar("t1", 2648, 2650, 2644.5, 2647, "2026-07-20T10:15:00.000Z"),
      "TEST"
    );
    await updateSetupsFromBar(
      store,
      userId,
      bar("t2", 2647, 2666, 2646, 2664, "2026-07-20T10:30:00.000Z"),
      "TEST"
    );

    const testClosed = store.getSetup(userId, created!.setupId)!;
    const liveSetup: SetupRecord = {
      ...testClosed,
      setupId: "setup-live-1",
      decisionId: "dec-live",
      environment: "LIVE",
      isTestSetup: false,
      status: "CLOSED",
      resolution: "WIN_TP3",
      outcome: {
        rawResolution: "WIN_TP3",
        rawRealisedR: 3,
        modelledResolution: "WIN_TP3",
        modelledRealisedR: 2.5,
        managementNotes: []
      },
      resolvedAt: "2026-07-20T12:00:00.000Z"
    };
    store.saveSetup(liveSetup);

    const liveA = computeSetupAnalytics([liveSetup], "LIVE");
    const testA = computeSetupAnalytics(store.listSetups(userId, 50), "TEST");
    expect(liveA.environment).toBe("LIVE");
    expect(testA.environment).toBe("TEST");
    expect(liveA.totalSetups).toBe(1);
    expect(testA.totalSetups).toBeGreaterThanOrEqual(1);
    expect(testA.sampleSizeWarning).toMatch(/Extremely small sample|Small sample/);
  });

  it("malformed OHLC is rejected by bar updater", async () => {
    const created = await createSetupFromDecision(store, baseDecision());
    const before = store.getSetup(userId, created!.setupId)!;
    await updateSetupsFromBar(
      store,
      userId,
      bar("bad", 10, 5, 8, 7, "2026-07-20T10:15:00.000Z"),
      "TEST"
    );
    const after = store.getSetup(userId, created!.setupId)!;
    expect(after.status).toBe(before.status);
    expect(after.appliedBarEventIds).not.toContain("bad");
  });

  it("out-of-order / same-or-earlier barTime is ignored", async () => {
    const created = await createSetupFromDecision(store, baseDecision());
    await updateSetupsFromBar(
      store,
      userId,
      bar("early", 2648, 2650, 2644.5, 2647, BAR0),
      "TEST"
    );
    const s = store.getSetup(userId, created!.setupId)!;
    expect(s.status).toBe("WAITING_FOR_ENTRY");
    expect(s.appliedBarEventIds).not.toContain("early");
  });
});

describe("mock broker safety", () => {
  it("rejects when live execution flag is consulted and demo place still mock-only", async () => {
    const broker = new MockBrokerAdapter();
    expect(IG_DEMO_ADAPTER_PLAN.liveExecutionHardDisabled).toBe(true);
    expect(IG_DEMO_ADAPTER_PLAN.safety.some((s) => s.includes("brokerLiveExecutionEnabled"))).toBe(
      true
    );
    // Stage 2: BROKER_MODE=DISABLED → placeDemoOrder must fail closed
    const blocked = await broker.placeDemoOrder({
      symbol: "XAUUSD",
      direction: "BUY",
      size: 1,
      idempotencyKey: "k1"
    });
    expect(blocked.accepted).toBe(false);
    expect(blocked.reason).toMatch(/DEMO_BROKER_DISABLED|LIVE_EXECUTION/);
    const preview = await broker.previewOrder({
      symbol: "XAUUSD",
      direction: "BUY",
      size: 1,
      idempotencyKey: "k2"
    });
    expect(preview.accepted).toBe(true);
    expect(preview.reason).toMatch(/Preview only|no order/i);
  });
});
