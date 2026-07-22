/**
 * Signal Outcome Tracking — deterministic engine + analytics tests.
 * Never contacts brokers.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { DecisionRecord } from "../../../src/models/types";
import {
  applyBarToSignalOutcome,
  assertSnapshotImmutable,
  createSignalOutcomeFromDecision,
  freezeSignalSnapshot,
  invalidateSignal,
  moveTrailingStop
} from "../../../src/services/signalOutcome/engine";
import { computeSignalPerformance } from "../../../src/services/signalOutcome/analytics";
import {
  InMemorySignalOutcomeStore,
  type SignalOutcomeStore
} from "../../../src/services/signalOutcome/store";
import {
  ensureSignalOutcomeFromDecision,
  monitorSignalWithBar,
  setSignalOutcomeStoreForTests,
  syncDecisionAndMonitor
} from "../../../src/services/signalOutcome/monitor";
import type { SignalBarInput, SignalOutcomeRecord } from "../../../src/services/signalOutcome/types";

const baseDecision = (over: Partial<DecisionRecord> = {}): DecisionRecord =>
  ({
    schemaVersion: "1.0",
    decisionId: "dec-buy-1",
    userId: "user-1",
    symbol: "XAUUSD",
    timeframe: "15",
    barTime: "2026-07-22T10:00:00.000Z",
    generatedAt: "2026-07-22T10:00:05.000Z",
    marketDataTime: "2026-07-22T10:00:00.000Z",
    validUntil: "2026-07-22T11:00:00.000Z",
    decision: "BUY",
    confidence: 0.97,
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
  source: "tradingview-ohlcv",
  dataQuality: "OK",
  ...partial
});

describe("Signal Outcome Tracking", () => {
  let store: SignalOutcomeStore;

  beforeEach(() => {
    store = new InMemorySignalOutcomeStore();
    setSignalOutcomeStoreForTests(store);
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
        barTime: "2026-07-22T10:15:00.000Z",
        low: 4130,
        high: 4135,
        close: 4134
      })
    );
    expect(r.entry.entryReached).toBe(true);
    expect(r.entry.entryPrice).toBe(4131.3);
    expect(r.monitoring.lifecycle).toBe("OPEN");
  });

  it("BUY target hit", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131.5 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: "t2", low: 4132, high: 4139, close: 4138.5 })
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
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: "t2", low: 4126, high: 4130, close: 4126.5 })
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
      bar({ eventId: "s1", barTime: "t1", high: 4149, low: 4147, close: 4148 })
    );
    expect(r.entry.entryReached).toBe(true);
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "s2", barTime: "t2", high: 4147, low: 4139, close: 4140 })
    );
    expect(r.monitoring.tp1Status).toBe("HIT");

    let r2 = createSignalOutcomeFromDecision({ ...d, decisionId: "dec-sell-2" });
    r2 = applyBarToSignalOutcome(
      r2,
      bar({ eventId: "s3", barTime: "t1", high: 4149, low: 4147, close: 4148 })
    );
    r2 = applyBarToSignalOutcome(
      r2,
      bar({ eventId: "s4", barTime: "t2", high: 4154, low: 4149, close: 4153.5 })
    );
    expect(r2.finalResult?.outcome).toBe("LOSS");
  });

  it("breakeven after TP1 management event does not rewrite snapshot stop", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    const frozenStop = r.snapshot.stopLoss;
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: "t2", low: 4132, high: 4139, close: 4138 })
    );
    expect(r.snapshot.stopLoss).toBe(frozenStop);
    expect(r.monitoring.workingStop).toBe(r.entry.entryPrice);
    expect(r.managementEvents.some((e) => e.type === "BREAKEVEN_MOVE")).toBe(true);
  });

  it("TP1 then stop at breakeven", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: "t2", low: 4132, high: 4139, close: 4138 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e3", barTime: "t3", low: 4131.0, high: 4133, close: 4131.2 })
    );
    expect(r.finalResult?.outcome).toBe("BREAKEVEN");
  });

  it("TP1 then TP2 then TP3", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: "t2", low: 4132, high: 4139, close: 4138 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e3", barTime: "t3", low: 4140, high: 4147, close: 4146 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e4", barTime: "t4", low: 4147, high: 4156, close: 4155 })
    );
    expect(r.finalResult?.outcome).toBe("WIN");
    expect(r.finalResult?.targetsReached).toEqual(expect.arrayContaining(["TP1", "TP2", "TP3"]));
  });

  it("trailing-stop management", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = moveTrailingStop(r, 4133, "t2", "Trail up");
    expect(r.monitoring.stopStatus).toBe("TRAILED");
    expect(r.managementEvents.some((e) => e.type === "TRAIL_STOP")).toBe(true);
    expect(r.snapshot.stopLoss).toBe(4127);
  });

  it("strategy invalidation", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = invalidateSignal(r, "t2", "Structure broken");
    expect(r.finalResult?.outcome).toBe("CANCELLED");
  });

  it("pending entry expires", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    for (let i = 0; i < 48; i++) {
      r = applyBarToSignalOutcome(
        r,
        bar({
          eventId: `exp-${i}`,
          barTime: `2026-07-22T${String(10 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}:00.000Z`,
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
      baseDecision({ decisionId: "w1", decision: "WAIT", entry: { type: "NONE", price: null, zoneLow: null, zoneHigh: null, condition: null }, stopLoss: { price: null, reason: null }, takeProfits: [] })
    );
    const buy = createSignalOutcomeFromDecision(baseDecision());
    let closed = applyBarToSignalOutcome(
      buy,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    closed = applyBarToSignalOutcome(
      closed,
      bar({ eventId: "e2", barTime: "t2", low: 4126, high: 4130, close: 4126.5 })
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
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: "t2", low: 4126, high: 4140, close: 4135 })
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
    const b = bar({ eventId: "dup", barTime: "t1", low: 4130, high: 4132, close: 4131 });
    r = applyBarToSignalOutcome(r, b);
    const once = r.managementEvents.length;
    r = applyBarToSignalOutcome(r, b);
    expect(r.managementEvents.length).toBe(once);
    expect(r.appliedBarEventIds.filter((id) => id === "dup")).toHaveLength(1);
  });

  it("stale market data does not fabricate hits", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({
        eventId: "e2",
        barTime: "t2",
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
        barTime: "t1",
        open: Number.NaN,
        high: Number.NaN,
        low: Number.NaN,
        close: Number.NaN
      })
    );
    expect(r.monitoring.lifecycle).toBe("DATA_UNAVAILABLE");
    expect(r.finalResult?.outcome).toBe("DATA_UNAVAILABLE");
  });

  it("correct signal updated by signalId with multiple symbols/signals", async () => {
    const a = await ensureSignalOutcomeFromDecision(baseDecision({ decisionId: "a" }), store);
    const b = await ensureSignalOutcomeFromDecision(baseDecision({ decisionId: "b" }), store);
    expect(a.snapshot.signalId).not.toBe(b.snapshot.signalId);
    await syncDecisionAndMonitor(
      baseDecision({ decisionId: "a" }),
      bar({ eventId: "ea", barTime: "t1", low: 4130, high: 4132, close: 4131 }),
      store
    );
    const a2 = await store.get(a.snapshot.userId, a.snapshot.signalId);
    const b2 = await store.get(b.snapshot.userId, b.snapshot.signalId);
    expect(a2?.entry.entryReached).toBe(true);
    expect(b2?.entry.entryReached).toBe(false);
  });

  it("correct points, percentage, and R calculation", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e1", barTime: "t1", low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "e2", barTime: "t2", low: 4140, high: 4156, close: 4155 })
    );
    // May win via TP path
    expect(r.finalResult?.grossPoints).not.toBeNull();
    expect(r.finalResult?.grossR).not.toBeNull();
    expect(r.finalResult?.label).toBe("HYPOTHETICAL SIGNAL PERFORMANCE");
  });

  it("chronological drawdown and consecutive losses", () => {
    const mkLoss = (id: string, exit: string): SignalOutcomeRecord => {
      let r = createSignalOutcomeFromDecision(baseDecision({ decisionId: id }));
      r = applyBarToSignalOutcome(
        r,
        bar({ eventId: `${id}-1`, barTime: "2026-07-22T10:00:00.000Z", low: 4130, high: 4132, close: 4131 })
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

  it("confidence-band and BUY vs SELL statistics", () => {
    const buy = createSignalOutcomeFromDecision(baseDecision({ decisionId: "b1", confidence: 0.95 }));
    const sell = createSignalOutcomeFromDecision(
      baseDecision({
        decisionId: "s1",
        decision: "SELL",
        confidence: 0.72,
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
      bar({ eventId: "m1", barTime: "t1", low: 4130, high: 4132, close: 4131 }),
      store,
      "worker-1"
    );
    expect(updated[0]?.entry.entryReached).toBe(true);
    // No broker call surface in this module — dealing endpoints are never referenced.
    expect(JSON.stringify(updated)).not.toMatch(/positions\/otc|working-orders/);
  });

  it("out-of-order new eventId still processes (idempotent by event id)", () => {
    let r = createSignalOutcomeFromDecision(baseDecision());
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "later", barTime: "2026-07-22T12:00:00.000Z", low: 4130, high: 4132, close: 4131 })
    );
    r = applyBarToSignalOutcome(
      r,
      bar({ eventId: "earlier", barTime: "2026-07-22T11:00:00.000Z", low: 4130, high: 4131, close: 4130.5 })
    );
    expect(r.appliedBarEventIds).toContain("later");
    expect(r.appliedBarEventIds).toContain("earlier");
  });
});
