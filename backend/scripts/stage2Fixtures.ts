/**
 * Phase 3 Stage 2 controlled fixtures — TEST tracking only.
 * Uses production Firestore via Admin SDK + same setup services as Cloud Functions.
 * Does not call IG. Does not merge PRs. Does not alter Pine/webhook config.
 */
import { randomUUID } from "crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SETUP_RULES_VERSION, setupLifecycleConfig } from "../src/config/setupLifecycleConfig.js";
import type { DecisionRecord } from "../src/models/types.js";
import { createSetupFromDecision } from "../src/services/setup/createSetup.js";
import { updateSetupsFromBar } from "../src/services/setup/updateSetupsFromBar.js";
import { computeSetupAnalytics } from "../src/services/setup/analytics.js";
import { FirestoreGoldMetaStore } from "../src/services/storage/firestoreStore.js";
import { MockBrokerAdapter } from "../src/services/brokers/mockBrokerAdapter.js";

const USER_ID = process.env.STAGE2_USER_ID ?? "iuayfBpUkZYEAlYlsTFxulSC4Ye2";
const WEBHOOK_ID = process.env.STAGE2_WEBHOOK_ID ?? "2HBnvhqE6XQPJF4roWCQUx6E";
const API_BASE =
  process.env.STAGE2_API_BASE ?? "https://us-central1-goldmeta-web.cloudfunctions.net/api";
const RUN_TAG = `phase3-s2-${Date.now()}`;

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: "goldmeta-web" });
}

const store = new FirestoreGoldMetaStore(getFirestore());

type Result = { scenario: string; ok: boolean; detail: Record<string, unknown> };
const results: Result[] = [];

const record = (scenario: string, ok: boolean, detail: Record<string, unknown>) => {
  results.push({ scenario, ok, detail });
  console.log(JSON.stringify({ scenario, ok, ...detail }));
};

function baseDecision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  const now = new Date().toISOString();
  const barTime = over.barTime ?? "2026-07-21T12:00:00.000Z";
  return {
    schemaVersion: "1.0",
    decisionId: `dec-${RUN_TAG}-${randomUUID().slice(0, 8)}`,
    userId: USER_ID,
    symbol: "XAUUSD",
    timeframe: "15",
    barTime,
    generatedAt: now,
    marketDataTime: barTime,
    validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
    reasonSummary: ["Stage2 fixture BUY"],
    warnings: [],
    missingInputs: [],
    invalidation: "Below stop",
    disclaimer: "Analysis only — Stage 2 fixture",
    lifecycleState: "ACTIVE",
    snapshotId: null,
    ruleConfigVersion: "rules-1.1.0",
    pineScriptVersion: "2.0.4",
    backendVersion: "1.2.0-phase3",
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

const bar = (
  eventId: string,
  o: number,
  h: number,
  l: number,
  c: number,
  timeIso: string
) => ({
  eventId,
  barTime: timeIso,
  open: o,
  high: h,
  low: l,
  close: c,
  isConfirmedBar: true
});

async function closeAnyActiveTestSetups(reason: string): Promise<void> {
  const active = await store.listActiveSetups(USER_ID, "TEST");
  for (const s of active) {
    s.status = "CANCELLED";
    s.resolution = "CANCELLED";
    s.resolvedAt = new Date().toISOString();
    s.outcome.rawResolution = "CANCELLED";
    s.outcome.modelledResolution = "CANCELLED";
    s.statusHistory.push({
      at: new Date().toISOString(),
      from: s.status,
      to: "CANCELLED",
      barTime: null,
      eventId: null,
      reason
    });
    s.updatedAt = new Date().toISOString();
    await store.saveSetup(s);
  }
}

async function scenarioA(): Promise<void> {
  await closeAnyActiveTestSetups("Stage2 reset before A");
  const decision = baseDecision({ decisionId: `dec-${RUN_TAG}-A` });
  await store.saveDecision(decision);
  const setup = await createSetupFromDecision(store, decision);
  if (!setup) {
    record("A_BUY_lifecycle", false, { error: "no setup created" });
    return;
  }
  const sid = setup.setupId;
  await updateSetupsFromBar(
    store,
    USER_ID,
    bar(`${RUN_TAG}-A-e`, 2648, 2650, 2644.5, 2647, "2026-07-21T12:15:00.000Z"),
    "TEST"
  );
  await updateSetupsFromBar(
    store,
    USER_ID,
    bar(`${RUN_TAG}-A-tp1`, 2647, 2652.5, 2646, 2651, "2026-07-21T12:30:00.000Z"),
    "TEST"
  );
  await updateSetupsFromBar(
    store,
    USER_ID,
    bar(`${RUN_TAG}-A-tp2`, 2651, 2658.5, 2650, 2657, "2026-07-21T12:45:00.000Z"),
    "TEST"
  );
  await updateSetupsFromBar(
    store,
    USER_ID,
    bar(`${RUN_TAG}-A-tp3`, 2657, 2666, 2656, 2664, "2026-07-21T13:00:00.000Z"),
    "TEST"
  );
  const final = await store.getSetup(USER_ID, sid);
  const ok =
    !!final &&
    final.resolution === "WIN_TP3" &&
    final.outcome.rawRealisedR != null &&
    final.outcome.modelledRealisedR != null &&
    final.outcome.rawRealisedR !== final.outcome.modelledRealisedR &&
    final.ruleConfigVersion === SETUP_RULES_VERSION &&
    final.environment === "TEST";
  record("A_BUY_lifecycle", ok, {
    setupId: sid,
    status: final?.status,
    resolution: final?.resolution,
    rawR: final?.outcome.rawRealisedR,
    modelledR: final?.outcome.modelledRealisedR,
    ruleConfigVersion: final?.ruleConfigVersion,
    pine: final?.pineScriptVersion,
    appliedBars: final?.appliedBarEventIds.length
  });
}

async function scenarioB(): Promise<void> {
  await closeAnyActiveTestSetups("Stage2 reset before B");
  const decision = baseDecision({
    decisionId: `dec-${RUN_TAG}-B`,
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
  await store.saveDecision(decision);
  const setup = await createSetupFromDecision(store, decision);
  if (!setup) {
    record("B_SELL_SL", false, { error: "no setup" });
    return;
  }
  await updateSetupsFromBar(
    store,
    USER_ID,
    bar(`${RUN_TAG}-B-e`, 2648, 2651.5, 2647, 2650.5, "2026-07-21T12:15:00.000Z"),
    "TEST"
  );
  await updateSetupsFromBar(
    store,
    USER_ID,
    bar(`${RUN_TAG}-B-sl`, 2650, 2659, 2649, 2657, "2026-07-21T12:30:00.000Z"),
    "TEST"
  );
  const final = await store.getSetup(USER_ID, setup.setupId);
  record("B_SELL_SL", final?.resolution === "LOSS_SL" && final.outcome.rawRealisedR === -1, {
    setupId: setup.setupId,
    resolution: final?.resolution,
    rawR: final?.outcome.rawRealisedR
  });
}

async function scenarioC(): Promise<void> {
  const before = (await store.listSetups(USER_ID, 200)).length;
  const decision = baseDecision({
    decisionId: `dec-${RUN_TAG}-C`,
    decision: "WAIT",
    lifecycleState: "INCOMPLETE"
  });
  await store.saveDecision(decision);
  const setup = await createSetupFromDecision(store, decision);
  const after = (await store.listSetups(USER_ID, 200)).length;
  record("C_WAIT_no_setup", setup === null && after === before, {
    setupCreated: setup !== null,
    setupCountDelta: after - before
  });
}

async function scenarioD(): Promise<void> {
  await closeAnyActiveTestSetups("Stage2 reset before D");
  const decision = baseDecision({ decisionId: `dec-${RUN_TAG}-D` });
  await store.saveDecision(decision);
  const setup = await createSetupFromDecision(store, decision);
  if (!setup) {
    record("D_expiry", false, { error: "no setup" });
    return;
  }
  for (let i = 1; i <= 9; i++) {
    const t = new Date(Date.UTC(2026, 6, 21, 12, i * 15)).toISOString();
    await updateSetupsFromBar(
      store,
      USER_ID,
      bar(`${RUN_TAG}-D-${i}`, 2648, 2650, 2646.5, 2649, t),
      "TEST"
    );
  }
  const final = await store.getSetup(USER_ID, setup.setupId);
  record("D_expiry", final?.resolution === "EXPIRED", {
    setupId: setup.setupId,
    resolution: final?.resolution,
    statusHistoryHasExpired: final?.statusHistory.some((h) => h.to === "EXPIRED")
  });
}

async function scenarioE(): Promise<void> {
  await closeAnyActiveTestSetups("Stage2 reset before E");
  const decision = baseDecision({ decisionId: `dec-${RUN_TAG}-E` });
  await store.saveDecision(decision);
  const setup = await createSetupFromDecision(store, decision);
  if (!setup) {
    record("E_ambiguous", false, { error: "no setup" });
    return;
  }
  await updateSetupsFromBar(
    store,
    USER_ID,
    bar(`${RUN_TAG}-E-e`, 2648, 2650, 2644.5, 2647, "2026-07-21T12:15:00.000Z"),
    "TEST"
  );
  await updateSetupsFromBar(
    store,
    USER_ID,
    bar(`${RUN_TAG}-E-amb`, 2645, 2653, 2639, 2648, "2026-07-21T12:30:00.000Z"),
    "TEST"
  );
  const final = await store.getSetup(USER_ID, setup.setupId);
  const ambiguous = final?.statusHistory.some((h) => h.to === "AMBIGUOUS_INTRABAR");
  const worst = final?.resolution === "AMBIGUOUS_WORST_CASE_SL";
  const notWin = !(final?.resolution ?? "").startsWith("WIN_");
  record("E_ambiguous", !!ambiguous && !!worst && notWin && final?.outcome.rawRealisedR === -1, {
    setupId: setup.setupId,
    resolution: final?.resolution,
    rawR: final?.outcome.rawRealisedR,
    ambiguous,
    worstCase: worst
  });
}

async function scenarioF(): Promise<void> {
  await closeAnyActiveTestSetups("Stage2 reset before F");
  const decision = baseDecision({ decisionId: `dec-${RUN_TAG}-F` });
  await store.saveDecision(decision);
  const setup = await createSetupFromDecision(store, decision);
  if (!setup) {
    record("F_duplicate_bar", false, { error: "no setup" });
    return;
  }
  const b = bar(`${RUN_TAG}-F-dup`, 2648, 2650, 2644.5, 2647, "2026-07-21T12:15:00.000Z");
  await updateSetupsFromBar(store, USER_ID, b, "TEST");
  await updateSetupsFromBar(store, USER_ID, b, "TEST");
  const final = await store.getSetup(USER_ID, setup.setupId);
  const dupCount = final?.appliedBarEventIds.filter((id) => id === b.eventId).length ?? 0;
  const entryTransitions =
    final?.statusHistory.filter((h) => h.to === "ENTRY_TRIGGERED").length ?? 0;
  record("F_duplicate_bar", dupCount === 1 && entryTransitions === 1, {
    setupId: setup.setupId,
    dupCount,
    entryTransitions
  });
}

async function scenarioG(): Promise<void> {
  await closeAnyActiveTestSetups("Stage2 reset before G");
  const d1 = baseDecision({ decisionId: `dec-${RUN_TAG}-G1` });
  await store.saveDecision(d1);
  const s1 = await createSetupFromDecision(store, d1);
  const d2 = baseDecision({
    decisionId: `dec-${RUN_TAG}-G2`,
    barTime: "2026-07-21T12:15:00.000Z",
    marketDataTime: "2026-07-21T12:15:00.000Z"
  });
  await store.saveDecision(d2);
  const s2 = await createSetupFromDecision(store, d2);
  const active = await store.listActiveSetups(USER_ID, "TEST");
  record("G_active_guard", s1 !== null && s2 === null && active.length === 1, {
    firstSetupId: s1?.setupId,
    secondCreated: s2 !== null,
    activeCount: active.length
  });
}

async function scenarioH(): Promise<void> {
  await closeAnyActiveTestSetups("Stage2 reset before H");
  const beforeSetups = (await store.listSetups(USER_ID, 200)).length;
  const live = baseDecision({
    decisionId: `dec-${RUN_TAG}-H-live`,
    environment: "LIVE",
    isTestDecision: false,
    dataSourceLabel: "LIVE",
    reasonSummary: ["Stage2 LIVE isolation fixture"]
  });
  await store.saveDecision(live);
  const setup = await createSetupFromDecision(store, live);
  const afterSetups = (await store.listSetups(USER_ID, 200)).length;
  const flagsOk =
    setupLifecycleConfig.flags.setupTrackingEnvironments.join(",") === "TEST" &&
    setupLifecycleConfig.flags.brokerLiveExecutionEnabled === false &&
    setupLifecycleConfig.flags.brokerMode === "DISABLED";
  record("H_LIVE_isolation", setup === null && afterSetups === beforeSetups && flagsOk, {
    setupCreated: setup !== null,
    decisionSaved: true,
    decisionId: live.decisionId,
    trackingEnvs: setupLifecycleConfig.flags.setupTrackingEnvironments,
    brokerMode: setupLifecycleConfig.flags.brokerMode,
    brokerLiveExecutionEnabled: setupLifecycleConfig.flags.brokerLiveExecutionEnabled
  });
}

async function brokerFailClosed(): Promise<void> {
  const broker = new MockBrokerAdapter();
  const place = await broker.placeDemoOrder({
    symbol: "XAUUSD",
    direction: "BUY",
    size: 0.1,
    idempotencyKey: `${RUN_TAG}-broker`
  });
  record("broker_fail_closed", place.accepted === false, {
    reason: place.reason,
    brokerMode: setupLifecycleConfig.flags.brokerMode
  });
}

async function analyticsCheck(): Promise<void> {
  const setups = await store.listSetups(USER_ID, 200);
  const testA = computeSetupAnalytics(setups, "TEST");
  const liveA = computeSetupAnalytics(setups, "LIVE");
  const contaminated = liveA.totalSetups > 0 && setups.some((s) => s.environment === "TEST" && s.isTestSetup)
    ? liveA.totalSetups === setups.filter((s) => s.environment === "LIVE" && !s.isTestSetup).length
    : true;
  record("analytics_separation", contaminated && testA.environment === "TEST" && liveA.environment === "LIVE", {
    test: {
      total: testA.totalSetups,
      completed: testA.completedSetups,
      wins: testA.wins,
      losses: testA.losses,
      expired: testA.expired,
      ambiguous: testA.ambiguous,
      warning: testA.sampleSizeWarning
    },
    live: {
      total: liveA.totalSetups,
      completed: liveA.completedSetups
    }
  });
}

async function webhookSmoke(): Promise<void> {
  const eventId = `${RUN_TAG}-webhook-test-wait`;
  const payload = {
    schemaVersion: "1.0",
    source: "tradingview",
    eventId,
    symbol: "XAUUSD",
    timeframe: "15",
    eventType: "TEST",
    barTime: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    isConfirmedBar: true,
    indicatorName: "GoldMetaBridge",
    webhookSecret: null,
    ohlcv: { open: 2400, high: 2401, low: 2399, close: 2400.5, volume: 10 },
    levels: {
      pocAll: 2400,
      vahAll: 2405,
      valAll: 2395,
      pocNonBroken: [{ price: 2400, relation: "ABOVE" }],
      vahNonBroken: [{ price: 2405, relation: "ABOVE" }],
      valNonBroken: [{ price: 2395, relation: "BELOW" }]
    },
    sessionVolumeProfile: {
      session: "LONDON",
      poc: 2400,
      vah: 2405,
      val: 2395,
      hvn: [],
      lvn: [],
      acceptanceState: "UNKNOWN"
    },
    marketProfile: {
      tpoPoc: 2400,
      initialBalanceHigh: 2402,
      initialBalanceLow: 2398,
      singlePrints: [],
      valueMigration: "BALANCED",
      profileState: "BALANCED",
      acceptanceState: "UNKNOWN"
    },
    trend: {
      direction: "NEUTRAL",
      strength: 20,
      components: [{ name: "M15", direction: "NEUTRAL", strength: 20, sourceTimeframe: "15" }]
    },
    confirmationCandle: {
      confirmed: false,
      direction: "NEUTRAL",
      classification: "NONE",
      open: 2400,
      high: 2401,
      low: 2399,
      close: 2400.5,
      isClosed: true
    },
    metadata: { scriptVersion: "2.0.4", userId: USER_ID, stage2: RUN_TAG }
  };

  const res = await fetch(`${API_BASE}/webhooks/tradingview/${WEBHOOK_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const body = (await res.json()) as Record<string, unknown>;
  record("webhook_TEST_202", res.status === 202, {
    status: res.status,
    body
  });

  // LIVE isolation via webhook — decision may create, setup must not
  const liveEventId = `${RUN_TAG}-webhook-live-iso`;
  const livePayload = { ...payload, eventId: liveEventId, eventType: "BAR_CLOSE" };
  const liveRes = await fetch(`${API_BASE}/webhooks/tradingview/${WEBHOOK_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(livePayload)
  });
  // Wait briefly for job processing
  await new Promise((r) => setTimeout(r, 8000));
  const liveSetups = (await store.listSetups(USER_ID, 50)).filter(
    (s) => s.environment === "LIVE" && s.createdAt >= new Date(Date.now() - 5 * 60 * 1000).toISOString()
  );
  record("webhook_LIVE_no_setup", liveRes.status === 202 && liveSetups.length === 0, {
    status: liveRes.status,
    recentLiveSetups: liveSetups.map((s) => s.setupId)
  });
}

async function flagProbe(): Promise<void> {
  const health = await fetch(`${API_BASE}/health`);
  const healthBody = (await health.json()) as Record<string, unknown>;
  record("health", health.ok, {
    status: health.status,
    backendVersion: healthBody.backendVersion,
    body: healthBody
  });
}

async function main(): Promise<void> {
  console.log(
    JSON.stringify({
      runTag: RUN_TAG,
      userId: USER_ID,
      flags: setupLifecycleConfig.flags,
      ruleVersion: SETUP_RULES_VERSION
    })
  );
  await flagProbe();
  await brokerFailClosed();
  await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD();
  await scenarioE();
  await scenarioF();
  await scenarioG();
  await scenarioH();
  await analyticsCheck();
  await webhookSmoke();

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ summary: { total: results.length, failed: failed.length, failedScenarios: failed.map((f) => f.scenario) } }));
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
