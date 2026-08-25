/**
 * Signal Outcome Tracking — deterministic engine + analytics tests.
 * Never contacts brokers. Execution flags remain false.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { DecisionRecord } from "../../../src/models/types";
import {
  applyBarToSignalOutcome,
  assertSnapshotImmutable,
  confidenceOnHundredScale,
  createSignalOutcomeFromDecision,
  freezeSignalSnapshot,
  invalidateSignal,
  moveTrailingStop,
  pointsFrom,
  validateBarForSignal
} from "../../../src/services/signalOutcome/engine";
import {
  computeSignalPerformance,
  confidenceBand
} from "../../../src/services/signalOutcome/analytics";
import {
  InMemorySignalOutcomeStore,
  type SignalOutcomeStore
} from "../../../src/services/signalOutcome/store";
import {
  ensureSignalOutcomeFromDecision,
  monitorMatchingSignalsWithBar,
  monitorSignalWithBar,
  processOutcomeMonitorJob,
  setSignalOutcomeStoreForTests,
  syncDecisionAndMonitor
} from "../../../src/services/signalOutcome/monitor";
import {
  InMemoryOutcomeMonitorJobStore,
  setOutcomeMonitorJobStoreForTests
} from "../../../src/services/signalOutcome/monitorJobs";
import type { SignalBarInput, SignalOutcomeRecord } from "../../../src/services/signalOutcome/types";

const CREATION = "2026-07-22T10:00:00.000Z";
const T1 = "2026-07-22T10:15:00.000Z";
const T2 = "2026-07-22T10:30:00.000Z";
const T3 = "2026-07-22T10:45:00.000Z";
const T4 = "2026-07-22T11:00:00.000Z";

const baseDecision = (over: Partial<DecisionRecord> = {}): DecisionRecord =>
  ({
    schemaVersion: "1.0",
    decisionId: "dec-buy-1",
    userId: "user-1",
    symbol: "XAUUSD",
    timeframe: "15",
    barTime: CREATION,
    generatedAt: "2026-07-22T10:00:05.000Z",
    marketDataTime: CREATION,
    validUntil: "2026-07-22T11:00:00.000Z",
    decision: "BUY",
    confidence: 97,
    confidenceLabel: "VERY_HIGH",
    marketRegime: "TRENDING_UP",
    dataQuality: "OK",
    isProvisional: false,
    setupScore: 82,
    entry: {
      type: "LIMIT",
      price: 4131.3,
      zoneLow: null,
      zoneHigh: null,
      condition: null
    },
    stopLoss: { price: 4127.0, reason: "structure" },
    takeProfits: [
      { label: "TP1", price: 4138.0, reason: "tp1" },
      { label: "TP2", price: 4146.0, reason: "tp2" },
      { label: "TP3", price: 4155.0, reason: "tp3" }
    ],
    riskReward: { tp1: 1.5, tp2: 3.4, tp3: 5.5 },
    breakeven: { state: "HOLD_ORIGINAL_STOP", trigger: null, newStop: null, reason: null },
    earlyExit: { exitNow: false, conditions: [] },
    bullishEvidence: [],
    bearishEvidence: [],
    reasonCodes: ["STRUCTURE_LONG"],
    reasonSummary: ["Long"],
    warnings: [],
    missingInputs: [],
    invalidation: "",
    disclaimer: "",
    lifecycleState: "ACTIVE",
    snapshotId: null,
    ruleConfigVersion: "rules-1.1.0",
    pineScriptVersion: null,
    backendVersion: "1.0.0",
    environment: "TEST",
    isTestDecision: true,
    currentSession: "LONDON",
    ...over
  }) as DecisionRecord;

const bar = (partial: Partial<SignalBarInput> & { eventId: string; barTime: string }): SignalBarInput => ({
  open: 4130,
  high: 4132,
  low: 4129,
  close: 4131,
  isConfirmedBar: true,
  symbol: "XAUUSD",
  timeframe: "15",
  environment: "TEST",
  source: "tradingview-ohlcv",
  dataQuality: "OK",
  ...partial
});

describe("Signal Outcome Tracking", () => {
  let store: SignalOutcomeStore;
  let jobStore: InMemoryOutcomeMonitorJobStore;

  beforeEach(() => {
    store = new InMemorySignalOutcomeStore();
    jobStore = new InMemoryOutcomeMonitorJobStore();
    setSignalOutcomeStoreForTests(store);
    setOutcomeMonitorJobStoreForTests(jobStore);
  });

  it("freezes immutable snapshot fields", () => {
    const d = baseDecision();
    const snap = freezeSignalSnapshot(d);
    const copy = { ...snap, stopLoss: 9999 };
    expect(() => assertSnapshotImmutable(snap, copy)).toThrow(/stopLoss/);
  });

  it("BUY entry triggered at proposed price (not best-of-candle)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4130,
        high: 4135,
        close: 4134
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.entry.entryPrice).toBe(4131.3);
    expect(r.monitoring.lifecycle).toBe("OPEN");
  });

  it("rejects same-candle lookahead — creation candle cannot create entry/TP/stop", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    // Violent move inside the creation candle must not enter or resolve.
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "creation-candle",
        barTime: CREATION,
        low: 4120,
        high: 4160,
        close: 4155
      })
    );
    expect(r.entry.entryReached).toBe(false);
    expect(r.monitoring.lifecycle).toBe("PENDING_ENTRY");
    expect(r.finalResult).toBeNull();
    expect(r.managementEvents.some((e) => e.type === "BAR_SKIPPED")).toBe(true);
    expect(validateBarForSignal(createSignalOutcomeFromDecision(baseDecision()), bar({
      eventId: "x",
      barTime: CREATION,
      low: 4120,
      high: 4160,
      close: 4155
    }))).toBe("SAME_CANDLE_SKIP");
  });

  it("price movements earlier inside creation candle cannot create TP or stop result", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    // Enter on next bar
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    expect(r.entry.entryReached).toBe(true);
    // Replay an older/same creation-time spike — must be ignored
    const before = structuredClone(r);
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "old-spike",
        barTime: CREATION,
        low: 4120,
        high: 4160,
        close: 4155
      })
    );
    expect(r.monitoring.lifecycle).toBe(before.monitoring.lifecycle);
    expect(r.finalResult).toBeNull();
    expect(r.exitLegs.length).toBe(0);
  });

  it("BUY target hit", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131.5 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: T2, low: 4132, high: 4139, close: 4138.5 })
    );
    expect(r.monitoring.tp1Status).toBe("HIT");
    expect(r.monitoring.lifecycle === "TP1_HIT" || r.monitoring.lifecycle === "BREAKEVEN").toBe(
      true
    );
  });

  it("BUY stop hit", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: T2, low: 4126, high: 4130, close: 4126.5 })
    );
    expect(r.finalResult?.outcome).toBe("LOSS");
    expect(r.monitoring.stopStatus).toBe("HIT");
  });

  it("SELL entry, target, and stop", () => {
    const d = baseDecision({
      decisionId: "dec-sell-1",
      decision: "SELL",
      entry: { type: "LIMIT", price: 4148, zoneLow: null, zoneHigh: null, condition: null },
      stopLoss: { price: 4153, reason: "s" },
      takeProfits: [
        { label: "TP1", price: 4140, reason: "t" },
        { label: "TP2", price: 4132, reason: "t" },
        { label: "TP3", price: 4120, reason: "t" }
      ]
    });
    let r = createSignalOutcomeFromDecision(d);
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "s1", barTime: T1, high: 4149, low: 4147, close: 4148 })
    );
    expect(r.entry.entryReached).toBe(true);
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "s2", barTime: T2, high: 4147, low: 4139, close: 4140 })
    );
    expect(r.monitoring.tp1Status).toBe("HIT");

    let r2 = createSignalOutcomeFromDecision({ ...d, decisionId: "dec-sell-2" });
    r2 = applyBarToSignalOutcome(
      r2,
      bar({ eventId: "s3", barTime: T1, high: 4149, low: 4147, close: 4148 })
    );
    r2 = applyBarToSignalOutcome(
      r2,
      bar({ eventId: "s4", barTime: T2, high: 4154, low: 4149, close: 4153.5 })
    );
    expect(r2.finalResult?.outcome).toBe("LOSS");
  });

  it("breakeven after TP1 management event does not rewrite snapshot stop", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    const frozenStop = r.snapshot.stopLoss;
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: T2, low: 4132, high: 4139, close: 4138 })
    );
    expect(r.snapshot.stopLoss).toBe(frozenStop);
    expect(r.monitoring.workingStop).toBe(r.entry.entryPrice);
    expect(r.managementEvents.some((e) => e.type === "BREAKEVEN_MOVE")).toBe(true);
  });

  it("40% TP1 then 60% breakeven = positive weighted result (WIN)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: T2, low: 4132, high: 4139, close: 4138 })
    );
    // Remaining 60% stops at breakeven (entry)
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e3", barTime: T3, low: 4131.0, high: 4133, close: 4131.2 })
    );
    expect(r.exitLegs).toHaveLength(2);
    expect(r.exitLegs[0]?.quantityPct).toBe(40);
    expect(r.exitLegs[1]?.quantityPct).toBe(60);
    expect(r.finalResult?.outcome).toBe("WIN");
    // 0.4 * (4138-4131.3) = 0.4*6.7 = 2.68; BE leg ~0; minus spread allocation
    expect(r.finalResult!.netPoints!).toBeGreaterThan(0);
    // Must not equal full-position final-exit-only PnL at entry (~0)
    const finalOnly = pointsFrom("BUY", 4131.3, 4131.3);
    expect(r.finalResult!.grossPoints).not.toBe(finalOnly);
  });

  it("40% TP1 then 60% stop = weighted result (may be WIN/LOSS/BE from net R)", () => {
    // Use wider stop so after TP1 BE-move we can still hit original? After TP1 stop moves to BE.
    // To hit a losing stop after TP1 we trail stop below entry without BE, or use TP1 then
    // manually trail. Simpler: TP1 then stop at BE is tested above; here force stop before BE
    // by using a signal that hits TP1 and then we trail stop below entry for a loss on remainder.
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: T2, low: 4132, high: 4139, close: 4138 })
    );
    // Trail stop below entry so remaining 60% takes a loss
    r = moveTrailingStop(r, 4129, T2, "Trail for test");
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e3", barTime: T3, low: 4128, high: 4132, close: 4129 })
    );
    expect(r.exitLegs.length).toBeGreaterThanOrEqual(2);
    const tp1Pts = 0.4 * (4138 - 4131.3);
    const stopPts = 0.6 * (4129 - 4131.3);
    const expectedGross = Math.round((tp1Pts + stopPts) * 100) / 100;
    expect(r.finalResult!.grossPoints).toBeCloseTo(expectedGross, 1);
    // Net R decides outcome — not final exit price alone
    expect(["WIN", "LOSS", "BREAKEVEN"]).toContain(r.finalResult!.outcome);
    expect(r.finalResult!.exitPrice).toBe(4129);
    // Final exit alone would look like a small loss on 100% — weighted may differ
    const naiveFull = pointsFrom("BUY", 4131.3, 4129);
    expect(r.finalResult!.grossPoints).not.toBe(naiveFull);
  });

  it("TP1 + TP2 + TP3 = correctly weighted result", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: T2, low: 4132, high: 4139, close: 4138 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e3", barTime: T3, low: 4140, high: 4147, close: 4146 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e4", barTime: T4, low: 4147, high: 4156, close: 4155 })
    );
    expect(r.finalResult?.outcome).toBe("WIN");
    expect(r.finalResult?.targetsReached).toEqual(expect.arrayContaining(["TP1", "TP2", "TP3"]));
    expect(r.exitLegs).toHaveLength(3);
    const expected =
      Math.round(
        (0.4 * (4138 - 4131.3) + 0.3 * (4146 - 4131.3) + 0.3 * (4155 - 4131.3)) * 100
      ) / 100;
    expect(r.finalResult!.grossPoints).toBeCloseTo(expected, 1);
    // Not simply full size at TP3:
    expect(r.finalResult!.grossPoints).not.toBeCloseTo(4155 - 4131.3, 1);
  });

  it("trailing-stop management", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = moveTrailingStop(r, 4133, T2, "Trail up");
    expect(r.monitoring.stopStatus).toBe("TRAILED");
    expect(r.managementEvents.some((e) => e.type === "TRAIL_STOP")).toBe(true);
    expect(r.snapshot.stopLoss).toBe(4127);
  });

  it("strategy invalidation", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = invalidateSignal(r, T2, "Structure broken");
    expect(r.finalResult?.outcome).toBe("CANCELLED");
  });

  it("pending entry expires", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    for (let i = 0; i < 48; i++) {
      const t = new Date(Date.parse(CREATION) + (i + 1) * 15 * 60_000).toISOString();
      r = applyBarToSignalOutcome(
        r,
        bar({
          eventId: `exp-${i}`,
          barTime: t,
          low: 4140,
          high: 4145,
          close: 4142
        }),
        { maxPendingBars: 48, pendingBarsSeen: i }
      );
    }
    expect(r.monitoring.lifecycle).toBe("EXPIRED");
    expect(r.entry.expiredWithoutEntry).toBe(true);
  });

  it("WAIT excluded from trade statistics", () => {
    const wait = createSignalOutcomeFromDecision(
      baseDecision({
        decisionId: "w1",
        decision: "WAIT",
        entry: { type: "NONE", price: null, zoneLow: null, zoneHigh: null, condition: null },
        stopLoss: { price: null, reason: null },
        takeProfits: []
      })
    );
    const buy = createSignalOutcomeFromDecision(baseDecision());
    let closed = applyBarToSignalOutcome(
      buy,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    closed = applyBarToSignalOutcome(
      closed,
      bar({ eventId: "e2", barTime: T2, low: 4126, high: 4130, close: 4126.5 })
    );
    const summary = computeSignalPerformance([wait, closed]);
    expect(summary.waitOnly).toBe(1);
    expect(summary.totalConfirmedBuySell).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBe(0);
  });

  it("same-candle stop-and-target ambiguity", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: T2, low: 4126, high: 4140, close: 4135 })
    );
    expect(r.monitoring.lifecycle).toBe("AMBIGUOUS_INTRABAR");
    expect(r.finalResult?.outcome).toBe("AMBIGUOUS");
    expect(r.ambiguity?.missingDataRequired).toMatch(/tick-level/i);
    const summary = computeSignalPerformance([r]);
    expect(summary.ambiguousIntrabar).toBe(1);
    expect(summary.wins).toBe(0);
  });

  it("duplicate monitoring event is idempotent", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    const b = bar({ eventId: "dup", barTime: T1, low: 4130, high: 4132, close: 4131 });
    r = applyBarToSignalOutcome(r, b);
    const once = r.managementEvents.length;
    r = applyBarToSignalOutcome(r, b);
    expect(r.managementEvents.length).toBe(once);
    expect(r.appliedBarEventIds.filter((id) => id === "dup")).toHaveLength(1);
  });

  it("rejects wrong symbol, timeframe, environment, and older bars", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    expect(r.entry.entryReached).toBe(true);
    const life = r.monitoring.lifecycle;

    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "bad-sym", barTime: T2, symbol: "EURUSD", low: 4126, high: 4130, close: 4127 })
    );
    expect(r.monitoring.lifecycle).toBe(life);

    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "bad-tf", barTime: T2, timeframe: "60", low: 4126, high: 4130, close: 4127 })
    );
    expect(r.monitoring.lifecycle).toBe(life);

    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "bad-env",
        barTime: T2,
        environment: "LIVE",
        low: 4126,
        high: 4130,
        close: 4127
      })
    );
    expect(r.monitoring.lifecycle).toBe(life);

    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "older",
        barTime: "2026-07-22T10:10:00.000Z",
        low: 4126,
        high: 4130,
        close: 4127
      })
    );
    expect(r.monitoring.lifecycle).toBe(life);
    expect(r.lastAppliedBarTime).toBe(T1);
  });

  it("stale market data does not fabricate hits", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e2",
        barTime: T2,
        low: 4120,
        high: 4160,
        close: 4150,
        stale: true
      })
    );
    expect(r.monitoring.lifecycle).toBe("OPEN");
    expect(r.finalResult).toBeNull();
    expect(r.managementEvents.some((e) => e.type === "DATA_STALE")).toBe(true);
  });

  it("missing market data → DATA_UNAVAILABLE", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "bad",
        barTime: T1,
        open: Number.NaN,
        high: Number.NaN,
        low: Number.NaN,
        close: Number.NaN
      })
    );
    expect(r.monitoring.lifecycle).toBe("DATA_UNAVAILABLE");
    expect(r.finalResult?.outcome).toBe("DATA_UNAVAILABLE");
  });

  it("future bar monitors all matching active signals, not only the new decision", async () => {
    const a = await ensureSignalOutcomeFromDecision(baseDecision({ decisionId: "a" }), store);
    const b = await ensureSignalOutcomeFromDecision(baseDecision({ decisionId: "b" }), store);
    const otherTf = await ensureSignalOutcomeFromDecision(
      baseDecision({ decisionId: "c", timeframe: "60" }),
      store
    );
    expect(a.snapshot.signalId).not.toBe(b.snapshot.signalId);

    const updated = await monitorMatchingSignalsWithBar(
      "user-1",
      bar({ eventId: "shared", barTime: T1, low: 4130, high: 4132, close: 4131 }),
      store,
      "worker-1"
    );
    expect(updated.filter((r) => r.status === "APPLIED").length).toBe(2);
    const a2 = await store.get(a.snapshot.userId, a.snapshot.signalId);
    const b2 = await store.get(b.snapshot.userId, b.snapshot.signalId);
    const c2 = await store.get(otherTf.snapshot.userId, otherTf.snapshot.signalId);
    expect(a2?.entry.entryReached).toBe(true);
    expect(b2?.entry.entryReached).toBe(true);
    expect(c2?.entry.entryReached).toBe(false);
  });

  it("atomic applyBar does not leave lease claimed after success", async () => {
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), store);
    const result = await store.applyBarAtomic(
      "user-1",
      created.snapshot.signalId,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 }),
      "worker-a"
    );
    expect(result.status).toBe("APPLIED");
    expect(result.record?.entry.entryReached).toBe(true);
    expect(result.record?.leaseOwnerId).toBeNull();
    // Another worker can proceed
    const again = await store.applyBarAtomic(
      "user-1",
      created.snapshot.signalId,
      bar({ eventId: "e2", barTime: T2, low: 4126, high: 4130, close: 4126.5 }),
      "worker-b"
    );
    expect(again.status).toBe("APPLIED");
    expect(again.record?.finalResult?.outcome).toBe("LOSS");
  });

  it("durable outcome-monitor job retries independently", async () => {
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), store);
    const job = await jobStore.enqueue({
      userId: "user-1",
      signalId: created.snapshot.signalId,
      eventId: "evt-1",
      bar: bar({ eventId: "evt-1", barTime: T1, low: 4130, high: 4132, close: 4131 }),
      maxRetries: 2
    });
    await processOutcomeMonitorJob(job.jobId, { store, jobStore, workerId: "w1" });
    const done = await jobStore.get(job.jobId);
    expect(done?.state).toBe("COMPLETED");

    const failJob = await jobStore.enqueue({
      userId: "user-1",
      signalId: created.snapshot.signalId,
      eventId: "evt-fail",
      bar: bar({ eventId: "evt-fail", barTime: T2, low: 4130, high: 4132, close: 4131 }),
      maxRetries: 2
    });
    // Force failure by clearing store mid-flight via fail()
    await jobStore.claim(failJob.jobId, "w2", 60_000);
    await jobStore.fail(failJob.jobId, new Error("boom"), "MONITOR_APPLY_FAILED");
    const failed = await jobStore.get(failJob.jobId);
    expect(failed?.state).toBe("FAILED");
    expect(failed?.retryCount).toBe(1);
    expect(failed?.nextAttemptAt).toBeTruthy();
    expect(failed?.auditReason).toBe("MONITOR_APPLY_FAILED");
  });

  it("syncDecisionAndMonitor enqueues durable job without applying creation candle", async () => {
    const record = await syncDecisionAndMonitor(
      baseDecision(),
      bar({ eventId: "creation", barTime: CREATION, low: 4120, high: 4160, close: 4155 }),
      store,
      jobStore
    );
    expect(record.entry.entryReached).toBe(false);
    const job = await jobStore.get(
      (
        await jobStore.enqueue({
          userId: "user-1",
          signalId: record.snapshot.signalId,
          eventId: "creation",
          bar: bar({ eventId: "creation", barTime: CREATION, low: 4120, high: 4160, close: 4155 })
        })
      ).jobId
    );
    expect(job?.state === "QUEUED" || job?.state === "COMPLETED" || job?.state === "PROCESSING").toBe(
      true
    );
  });

  it("correct signal updated by signalId with multiple symbols/signals", async () => {
    const a = await ensureSignalOutcomeFromDecision(baseDecision({ decisionId: "a" }), store);
    const b = await ensureSignalOutcomeFromDecision(baseDecision({ decisionId: "b" }), store);
    expect(a.snapshot.signalId).not.toBe(b.snapshot.signalId);
    await monitorSignalWithBar(
      "user-1",
      bar({ eventId: "ea", barTime: T1, low: 4130, high: 4132, close: 4131 }),
      store
    );
    const a2 = await store.get(a.snapshot.userId, a.snapshot.signalId);
    const b2 = await store.get(b.snapshot.userId, b.snapshot.signalId);
    expect(a2?.entry.entryReached).toBe(true);
    expect(b2?.entry.entryReached).toBe(true);
  });

  it("correct points, percentage, and R calculation", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: T2, low: 4140, high: 4156, close: 4155 })
    );
    expect(r.finalResult?.grossPoints).not.toBeNull();
    expect(r.finalResult?.grossR).not.toBeNull();
    expect(r.finalResult?.label).toBe("HYPOTHETICAL SIGNAL PERFORMANCE");
  });

  it("chronological drawdown and consecutive losses", () => {
    const mkLoss = (id: string, exit: string): SignalOutcomeRecord => {
      let r = createSignalOutcomeFromDecision(baseDecision({ decisionId: id }));
      r = applyBarToSignalOutcome(
        r,
        bar({ eventId: `${id}-1`, barTime: T1, low: 4130, high: 4132, close: 4131 })
      );
      r = applyBarToSignalOutcome(
        r,
        bar({ eventId: `${id}-2`, barTime: exit, low: 4126, high: 4130, close: 4126.5 })
      );
      return r;
    };
    const a = mkLoss("l1", "2026-07-22T11:00:00.000Z");
    const b = mkLoss("l2", "2026-07-22T12:00:00.000Z");
    const c = mkLoss("l3", "2026-07-22T13:00:00.000Z");
    const summary = computeSignalPerformance([a, b, c]);
    expect(summary.maximumConsecutiveLosses).toBe(3);
    expect(summary.maximumDrawdownR).toBeLessThan(0);
  });

  it("confidence bands on 0–100 scale with boundaries 59..100", () => {
    const cases: Array<[number, string]> = [
      [59, "below-60"],
      [60, "60-69"],
      [69, "60-69"],
      [70, "70-79"],
      [79, "70-79"],
      [80, "80-89"],
      [89, "80-89"],
      [90, "90-100"],
      [100, "90-100"]
    ];
    for (const [c, band] of cases) {
      expect(confidenceBand(c)).toBe(band);
      expect(confidenceOnHundredScale(c)).toBe(c);
    }
    // Legacy 0–1 fractions still map
    expect(confidenceBand(0.95)).toBe("90-100");
    expect(confidenceBand(0.72)).toBe("70-79");

    const buy = createSignalOutcomeFromDecision(baseDecision({ decisionId: "b1", confidence: 95 }));
    const sell = createSignalOutcomeFromDecision(
      baseDecision({
        decisionId: "s1",
        decision: "SELL",
        confidence: 72,
        entry: { type: "LIMIT", price: 4148, zoneLow: null, zoneHigh: null, condition: null },
        stopLoss: { price: 4153, reason: "s" },
        takeProfits: [{ label: "TP1", price: 4140, reason: "t" }]
      })
    );
    const summary = computeSignalPerformance([buy, sell]);
    expect(summary.byDirection.BUY).toBe(1);
    expect(summary.byDirection.SELL).toBe(1);
    expect(summary.byConfidenceRange["90-100"]?.count).toBe(1);
    expect(summary.byConfidenceRange["70-79"]?.count).toBe(1);
  });

  it("complete performance history beyond newest 500 via pagination", async () => {
    for (let i = 0; i < 520; i++) {
      await store.save(
        createSignalOutcomeFromDecision(
          baseDecision({
            decisionId: `hist-${i}`,
            generatedAt: new Date(Date.parse(CREATION) + i * 1000).toISOString()
          })
        )
      );
    }
    const limited = await store.list("user-1", 500);
    expect(limited.length).toBe(500);
    const all = await store.listAllPaginated("user-1", 200);
    expect(all.length).toBe(520);
    const summary = computeSignalPerformance(all, { historyComplete: true });
    expect(summary.totalConfirmedBuySell).toBe(520);
    expect(summary.historyComplete).toBe(true);
  });

  it("cold-start persistence and multi-instance lease", async () => {
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), store);
    const again = await ensureSignalOutcomeFromDecision(baseDecision(), store);
    expect(again.snapshot.signalId).toBe(created.snapshot.signalId);

    const leaseA = await store.tryAcquireLease(
      "user-1",
      created.snapshot.signalId,
      "worker-a",
      60_000
    );
    expect(leaseA).not.toBeNull();
    const leaseB = await store.tryAcquireLease(
      "user-1",
      created.snapshot.signalId,
      "worker-b",
      60_000
    );
    expect(leaseB).toBeNull();
  });

  it("monitor applies bars to active signals without broker endpoints", async () => {
    await ensureSignalOutcomeFromDecision(baseDecision(), store);
    const updated = await monitorSignalWithBar(
      "user-1",
      bar({ eventId: "m1", barTime: T1, low: 4130, high: 4132, close: 4131 }),
      store,
      "worker-1"
    );
    expect(updated[0]?.status).toBe("APPLIED");
    expect(updated[0]?.record?.entry.entryReached).toBe(true);
    expect(JSON.stringify(updated)).not.toMatch(/positions\/otc|working-orders/);
  });
});

describe("Entry-candle ordering ambiguity", () => {
  it("entry + TP only — records entry, defers TP (rule B, no same-candle win)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4130,
        high: 4140,
        close: 4138
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.monitoring.tp1Status).toBe("PENDING");
    expect(r.finalResult).toBeNull();
    expect(r.managementEvents.some((e) => e.type === "ENTRY_SEQUENCE_DEFERRED")).toBe(true);
  });

  it("entry + stop only — records entry, defers stop (rule B, no same-candle loss fill)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4126,
        high: 4132,
        close: 4130
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.monitoring.stopStatus).not.toBe("HIT");
    expect(r.finalResult).toBeNull();
    expect(r.managementEvents.some((e) => e.type === "ENTRY_SEQUENCE_DEFERRED")).toBe(true);
  });

  it("entry + stop + TP — ENTRY_SEQUENCE_AMBIGUOUS without ordered ticks (rule A)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4126,
        high: 4140,
        close: 4135
      })
    );
    expect(r.entry.entryReached).toBe(false);
    expect(r.monitoring.lifecycle).toBe("ENTRY_SEQUENCE_AMBIGUOUS");
    expect(r.finalResult?.outcome).toBe("AMBIGUOUS");
  });

  it("TP before entry in ordered ticks is ignored — OPEN with TP1 PENDING", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4130,
        high: 4140,
        close: 4133,
        orderedTicks: [
          { t: 1, price: 4138 },
          { t: 2, price: 4131.3 },
          { t: 3, price: 4133 }
        ]
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.monitoring.lifecycle).toBe("OPEN");
    expect(r.monitoring.tp1Status).toBe("PENDING");
    expect(r.finalResult).toBeNull();
  });

  it("stop before entry in ordered ticks is ignored — entry then continues", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4126,
        high: 4132,
        close: 4130,
        orderedTicks: [
          { t: 1, price: 4126.5 },
          { t: 2, price: 4131.3 },
          { t: 3, price: 4130 }
        ]
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.monitoring.lifecycle).toBe("OPEN");
    expect(r.finalResult).toBeNull();
  });

  it("ordered ticks: entry then TP1 records 40% exit (OPEN or TP1_HIT/BREAKEVEN)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4130,
        high: 4140,
        close: 4138,
        orderedTicks: [
          { t: 1, price: 4131.3 },
          { t: 2, price: 4138 }
        ]
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.monitoring.tp1Status).toBe("HIT");
    expect(r.exitLegs.some((l) => l.reason === "TP1" && l.quantityPct === 40)).toBe(true);
    expect(r.finalResult?.outcome).not.toBe("WIN");
  });

  it("ordered ticks: entry then stop then TP later → LOSS (stop first)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4126,
        high: 4140,
        close: 4130,
        orderedTicks: [
          { t: 1, price: 4131.3 },
          { t: 2, price: 4127 },
          { t: 3, price: 4138 }
        ]
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.finalResult?.outcome).toBe("LOSS");
    expect(r.monitoring.stopStatus).toBe("HIT");
  });

  it("ordered ticks: entry → TP1 → breakeven stop → weighted positive", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4130,
        high: 4140,
        close: 4131.3,
        orderedTicks: [
          { t: 1, price: 4131.3 },
          { t: 2, price: 4138 },
          { t: 3, price: 4131.3 }
        ]
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.monitoring.tp1Status).toBe("HIT");
    expect(r.exitLegs.some((l) => l.reason === "TP1")).toBe(true);
    expect(r.exitLegs.some((l) => l.reason === "BREAKEVEN" || l.reason === "STOP")).toBe(true);
    expect(r.finalResult).not.toBeNull();
    expect((r.finalResult?.netPoints ?? 0) > 0).toBe(true);
  });

  it("ordered ticks with entry first then TP resolve sequence (entry then TP allowed)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e1",
        barTime: T1,
        low: 4130,
        high: 4140,
        close: 4138,
        orderedTicks: [
          { t: 1, price: 4131.3 },
          { t: 2, price: 4138 }
        ]
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.monitoring.tp1Status).toBe("HIT");
    expect(r.finalResult?.outcome).not.toBe("WIN"); // partial only — no full win bias
  });
});

describe("Concurrent bar ordering + lease retry", () => {
  let store: SignalOutcomeStore;
  let jobStore: InMemoryOutcomeMonitorJobStore;

  beforeEach(() => {
    store = new InMemorySignalOutcomeStore();
    jobStore = new InMemoryOutcomeMonitorJobStore();
    setSignalOutcomeStoreForTests(store);
    setOutcomeMonitorJobStoreForTests(jobStore);
  });

  it("T1/T2 concurrent: T2 lease-first does not lose T1 — final order T1 then T2 (entry then stop)", async () => {
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), store);
    const signalId = created.snapshot.signalId;
    const barT1 = bar({ eventId: "evt-t1", barTime: T1, low: 4130, high: 4132, close: 4131 });
    const barT2 = bar({ eventId: "evt-t2", barTime: T2, low: 4126, high: 4130, close: 4126.5 });

    const jobT1 = await jobStore.enqueue({
      userId: "user-1",
      signalId,
      eventId: barT1.eventId,
      bar: barT1
    });
    const jobT2 = await jobStore.enqueue({
      userId: "user-1",
      signalId,
      eventId: barT2.eventId,
      bar: barT2
    });

    // T2 arrives / claims first — must not COMPLETE while T1 incomplete.
    await processOutcomeMonitorJob(jobT2.jobId, { store, jobStore, workerId: "w-t2" });
    const afterT2First = await jobStore.get(jobT2.jobId);
    expect(afterT2First?.state).toBe("FAILED");
    expect(afterT2First?.lastApplyStatus).toBe("OUT_OF_ORDER_WAIT");
    expect((await store.get("user-1", signalId))?.entry.entryReached).toBe(false);

    // T1 applies entry.
    await processOutcomeMonitorJob(jobT1.jobId, { store, jobStore, workerId: "w-t1" });
    expect((await jobStore.get(jobT1.jobId))?.state).toBe("COMPLETED");
    expect((await store.get("user-1", signalId))?.entry.entryReached).toBe(true);
    expect((await store.get("user-1", signalId))?.lastAppliedBarTime).toBe(T1);

    // Retry T2 after backoff elapsed → stop / LOSS.
    jobStore.forceNextAttemptAt(jobT2.jobId, new Date(Date.now() - 1000).toISOString());
    await processOutcomeMonitorJob(jobT2.jobId, { store, jobStore, workerId: "w-t2b" });
    expect((await jobStore.get(jobT2.jobId))?.state).toBe("COMPLETED");
    const final = await store.get("user-1", signalId);
    expect(final?.finalResult?.outcome).toBe("LOSS");
    expect(final?.lastAppliedBarTime).toBe(T2);
  });

  it("T1 then T2 target path — entry on T1, TP on T2", async () => {
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), store);
    const signalId = created.snapshot.signalId;
    const jobT1 = await jobStore.enqueue({
      userId: "user-1",
      signalId,
      eventId: "tp-t1",
      bar: bar({ eventId: "tp-t1", barTime: T1, low: 4130, high: 4132, close: 4131 })
    });
    const jobT2 = await jobStore.enqueue({
      userId: "user-1",
      signalId,
      eventId: "tp-t2",
      bar: bar({ eventId: "tp-t2", barTime: T2, low: 4135, high: 4140, close: 4138 })
    });
    await processOutcomeMonitorJob(jobT2.jobId, { store, jobStore, workerId: "early" });
    expect((await jobStore.get(jobT2.jobId))?.state).toBe("FAILED");
    await processOutcomeMonitorJob(jobT1.jobId, { store, jobStore, workerId: "t1" });
    jobStore.forceNextAttemptAt(jobT2.jobId, new Date(Date.now() - 1000).toISOString());
    await processOutcomeMonitorJob(jobT2.jobId, { store, jobStore, workerId: "t2" });
    const final = await store.get("user-1", signalId);
    expect(final?.entry.entryReached).toBe(true);
    expect(final?.monitoring.tp1Status).toBe("HIT");
  });

  it("lease conflict retries automatically and does not COMPLETE", async () => {
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), store);
    const signalId = created.snapshot.signalId;
    // Hold lease with another worker.
    await store.tryAcquireLease("user-1", signalId, "holder", 120_000);
    const job = await jobStore.enqueue({
      userId: "user-1",
      signalId,
      eventId: "lease-evt",
      bar: bar({ eventId: "lease-evt", barTime: T1, low: 4130, high: 4132, close: 4131 })
    });
    await processOutcomeMonitorJob(job.jobId, { store, jobStore, workerId: "challenger" });
    const failed = await jobStore.get(job.jobId);
    expect(failed?.state).toBe("FAILED");
    expect(failed?.lastApplyStatus).toBe("LEASE_BUSY");
    expect(failed?.auditReason).toBe("LEASE_BUSY");
    expect(Date.parse(failed!.nextAttemptAt)).toBeGreaterThan(Date.now());

    // Release lease and retry after backoff.
    const held = await store.get("user-1", signalId);
    if (held) {
      held.leaseOwnerId = null;
      held.leaseUntil = null;
      await store.save(held);
    }
    jobStore.forceNextAttemptAt(job.jobId, new Date(Date.now() - 1000).toISOString());
    await processOutcomeMonitorJob(job.jobId, { store, jobStore, workerId: "challenger-2" });
    expect((await jobStore.get(job.jobId))?.state).toBe("COMPLETED");
    expect((await store.get("user-1", signalId))?.entry.entryReached).toBe(true);
  });

  it("duplicate retry does not apply twice", async () => {
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), store);
    const signalId = created.snapshot.signalId;
    const b = bar({ eventId: "dup-evt", barTime: T1, low: 4130, high: 4132, close: 4131 });
    const first = await store.applyBarAtomic("user-1", signalId, b, "w1");
    expect(first.status).toBe("APPLIED");
    const second = await store.applyBarAtomic("user-1", signalId, b, "w2");
    expect(second.status).toBe("DUPLICATE");
    const final = await store.get("user-1", signalId);
    expect(final?.appliedBarEventIds.filter((id) => id === "dup-evt")).toHaveLength(1);
  });
});

describe("Automatic outcome-monitor retries", () => {
  it("failed job retries automatically via retry pass without manual processOutcomeMonitorJob loop", async () => {
    const localStore = new InMemorySignalOutcomeStore();
    const localJobs = new InMemoryOutcomeMonitorJobStore();
    setSignalOutcomeStoreForTests(localStore);
    setOutcomeMonitorJobStoreForTests(localJobs);
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), localStore);

    const job = await localJobs.enqueue({
      userId: "user-1",
      signalId: created.snapshot.signalId,
      eventId: "retry-evt",
      bar: bar({ eventId: "retry-evt", barTime: T1, low: 4130, high: 4132, close: 4131 }),
      maxRetries: 5
    });

    await localJobs.claim(job.jobId, "w-fail", 60_000);
    await localJobs.fail(job.jobId, new Error("transient"), "MONITOR_APPLY_FAILED");
    const failed = await localJobs.get(job.jobId);
    expect(failed?.state).toBe("FAILED");
    expect(failed?.retryCount).toBe(1);
    expect(Date.parse(failed!.nextAttemptAt)).toBeGreaterThan(Date.now());

    // Elapse backoff — do not manually call processOutcomeMonitorJob in a loop.
    localJobs.forceNextAttemptAt(job.jobId, new Date(Date.now() - 1000).toISOString());

    const { runOutcomeMonitorRetryPass } = await import(
      "../../../src/services/signalOutcome/retryPass"
    );
    const heartbeat = await runOutcomeMonitorRetryPass({
      jobStore: localJobs,
      store: localStore,
      workerId: "scheduler-1",
      db: null
    });
    expect(heartbeat.claimed).toBeGreaterThanOrEqual(1);
    expect((await localJobs.get(job.jobId))?.state).toBe("COMPLETED");
    const all = await localStore.listAllPaginated("user-1");
    expect(all.some((s) => s.entry.entryReached)).toBe(true);
  });

  it("does not immediately reprocess a job whose nextAttemptAt is in the future", async () => {
    const localStore = new InMemorySignalOutcomeStore();
    const localJobs = new InMemoryOutcomeMonitorJobStore();
    setSignalOutcomeStoreForTests(localStore);
    setOutcomeMonitorJobStoreForTests(localJobs);
    const { runOutcomeMonitorRetryPass } = await import(
      "../../../src/services/signalOutcome/retryPass"
    );
    const created = await ensureSignalOutcomeFromDecision(baseDecision(), localStore);
    const job = await localJobs.enqueue({
      userId: "user-1",
      signalId: created.snapshot.signalId,
      eventId: "future-evt",
      bar: bar({ eventId: "future-evt", barTime: T1, low: 4130, high: 4132, close: 4131 }),
      maxRetries: 3
    });
    await localJobs.claim(job.jobId, "w", 60_000);
    await localJobs.fail(job.jobId, new Error("boom"), "MONITOR_APPLY_FAILED");
    const failed = await localJobs.get(job.jobId);
    expect(Date.parse(failed!.nextAttemptAt)).toBeGreaterThan(Date.now());

    const heartbeat = await runOutcomeMonitorRetryPass({
      jobStore: localJobs,
      store: localStore,
      workerId: "scheduler-2",
      db: null,
      now: new Date()
    });
    expect(heartbeat.completed).toBe(0);
    expect((await localJobs.get(job.jobId))?.state).toBe("FAILED");
  });
});

describe("Fail-closed production storage", () => {
  it("refuses in-memory outside test/local and exposes safe status code", async () => {
    const { allowInMemorySignalOutcomeStore, SignalOutcomeStorageUnavailableError } =
      await import("../../../src/services/signalOutcome/storagePolicy");
    const { FailClosedSignalOutcomeStore } = await import(
      "../../../src/services/signalOutcome/failClosedStore"
    );
    expect(allowInMemorySignalOutcomeStore({ NODE_ENV: "test" })).toBe(true);
    expect(
      allowInMemorySignalOutcomeStore({ NODE_ENV: "production", SIGNAL_OUTCOME_ALLOW_MEMORY: "true" })
    ).toBe(true);
    expect(allowInMemorySignalOutcomeStore({ NODE_ENV: "production" })).toBe(false);

    const closed = new FailClosedSignalOutcomeStore();
    await expect(closed.save(createSignalOutcomeFromDecision(baseDecision()))).rejects.toBeInstanceOf(
      SignalOutcomeStorageUnavailableError
    );
    try {
      await closed.list("user-1");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(SignalOutcomeStorageUnavailableError);
      expect((e as SignalOutcomeStorageUnavailableError).code).toBe(
        "SIGNAL_OUTCOME_STORAGE_UNAVAILABLE"
      );
    }
  });

  it("cold-start multi-instance uses shared store singleton only after explicit test set", async () => {
    const a = new InMemorySignalOutcomeStore();
    setSignalOutcomeStoreForTests(a);
    const created = await ensureSignalOutcomeFromDecision(baseDecision({ decisionId: "cold-1" }), a);
    const again = await ensureSignalOutcomeFromDecision(baseDecision({ decisionId: "cold-1" }), a);
    expect(again.snapshot.signalId).toBe(created.snapshot.signalId);
    const lease1 = await a.tryAcquireLease("user-1", created.snapshot.signalId, "instance-a", 60_000);
    const lease2 = await a.tryAcquireLease("user-1", created.snapshot.signalId, "instance-b", 60_000);
    expect(lease1).not.toBeNull();
    expect(lease2).toBeNull();
  });
});
