/**
 * Firestore Emulator concurrency + query-contract tests for signal outcomes.
 * Requires FIRESTORE_EMULATOR_HOST (set by firebase emulators:exec).
 * Never contacts brokers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeApp, deleteApp, getApps, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createSignalOutcomeFromDecision } from "../../src/services/signalOutcome/engine";
import { FirestoreSignalOutcomeStore } from "../../src/services/signalOutcome/store";
import { FirestoreOutcomeMonitorJobStore } from "../../src/services/signalOutcome/monitorJobs";
import { processOutcomeMonitorJob } from "../../src/services/signalOutcome/monitor";
import type { DecisionRecord } from "../../src/models/types";
import type { SignalBarInput } from "../../src/services/signalOutcome/types";

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081";
const PROJECT = "goldmeta-signal-outcome-test";

const CREATION = "2026-07-22T10:00:00.000Z";
const T1 = "2026-07-22T10:15:00.000Z";
const T2 = "2026-07-22T10:30:00.000Z";

function decision(id: string): DecisionRecord {
  return {
    schemaVersion: "1.0",
    decisionId: id,
    userId: "emu-user",
    symbol: "XAUUSD",
    timeframe: "15",
    barTime: CREATION,
    generatedAt: "2026-07-22T10:00:05.000Z",
    marketDataTime: CREATION,
    validUntil: "2026-07-22T11:00:00.000Z",
    decision: "BUY",
    confidence: 80,
    confidenceLabel: "HIGH",
    marketRegime: "TRENDING_UP",
    dataQuality: "OK",
    isProvisional: false,
    setupScore: 70,
    entry: { type: "LIMIT", price: 4131.3, zoneLow: null, zoneHigh: null, condition: null },
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
    currentSession: "LONDON"
  } as DecisionRecord;
}

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
  ...partial
});

async function emulatorReachable(): Promise<boolean> {
  try {
    const [host, port] = EMULATOR.split(":");
    const net = await import("net");
    return await new Promise((resolve) => {
      const socket = net.connect({ host, port: Number(port) }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

describe("Firestore emulator — atomic signal outcome apply", () => {
  let app: App;
  let store: FirestoreSignalOutcomeStore;
  let jobStore: FirestoreOutcomeMonitorJobStore;
  let ready = false;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
    process.env.GCLOUD_PROJECT = PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
    ready = await emulatorReachable();
    if (!ready) return;
    for (const existing of getApps()) {
      await deleteApp(existing);
    }
    app = initializeApp({ projectId: PROJECT });
    const db = getFirestore(app);
    store = new FirestoreSignalOutcomeStore(db);
    jobStore = new FirestoreOutcomeMonitorJobStore(db);
  }, 60_000);

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  it(
    "runs concurrent applyBarAtomic without double-applying the same event",
    async () => {
      if (!ready) {
        throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
      }
      const record = createSignalOutcomeFromDecision(decision(`emu-${Date.now()}`));
      await store.save(record);

      const b = bar({
        eventId: `shared-${Date.now()}`,
        barTime: T1,
        low: 4130,
        high: 4132,
        close: 4131
      });
      const results = await Promise.all([
        store.applyBarAtomic("emu-user", record.snapshot.signalId, b, "worker-a"),
        store.applyBarAtomic("emu-user", record.snapshot.signalId, b, "worker-b"),
        store.applyBarAtomic("emu-user", record.snapshot.signalId, b, "worker-c")
      ]);

      const applied = results.filter((r) => r.status === "APPLIED");
      const busyOrDup = results.filter(
        (r) => r.status === "LEASE_BUSY" || r.status === "DUPLICATE"
      );
      expect(applied.length).toBeGreaterThanOrEqual(1);
      expect(applied.length + busyOrDup.length).toBe(3);
      const final = await store.get("emu-user", record.snapshot.signalId);
      expect(final?.appliedBarEventIds.filter((id) => id === b.eventId)).toHaveLength(1);
      expect(final?.entry.entryReached).toBe(true);
      expect(final?.leaseOwnerId).toBeNull();
    },
    30_000
  );

  it(
    "second chronological bar applies after first inside separate transactions",
    async () => {
      if (!ready) {
        throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
      }
      const record = createSignalOutcomeFromDecision(decision(`emu2-${Date.now()}`));
      await store.save(record);
      const r1 = await store.applyBarAtomic(
        "emu-user",
        record.snapshot.signalId,
        bar({ eventId: `e1-${Date.now()}`, barTime: T1, low: 4130, high: 4132, close: 4131 }),
        "w1"
      );
      expect(r1.status).toBe("APPLIED");
      const r2 = await store.applyBarAtomic(
        "emu-user",
        record.snapshot.signalId,
        bar({ eventId: `e2-${Date.now()}`, barTime: T2, low: 4126, high: 4130, close: 4126.5 }),
        "w2"
      );
      expect(r2.status).toBe("APPLIED");
      const final = await store.get("emu-user", record.snapshot.signalId);
      expect(final?.finalResult?.outcome).toBe("LOSS");
      expect(final?.lastAppliedBarTime).toBe(T2);
    },
    30_000
  );

  it(
    "T1/T2 concurrent jobs: T2 first does not lose T1 — final order entry then stop",
    async () => {
      if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
      const record = createSignalOutcomeFromDecision(decision(`race-${Date.now()}`));
      await store.save(record);
      const signalId = record.snapshot.signalId;
      const barT1 = bar({
        eventId: `race-t1-${Date.now()}`,
        barTime: T1,
        low: 4130,
        high: 4132,
        close: 4131
      });
      const barT2 = bar({
        eventId: `race-t2-${Date.now()}`,
        barTime: T2,
        low: 4126,
        high: 4130,
        close: 4126.5
      });
      const jobT1 = await jobStore.enqueue({
        userId: "emu-user",
        signalId,
        eventId: barT1.eventId,
        bar: barT1
      });
      const jobT2 = await jobStore.enqueue({
        userId: "emu-user",
        signalId,
        eventId: barT2.eventId,
        bar: barT2
      });

      await processOutcomeMonitorJob(jobT2.jobId, { store, jobStore, workerId: "emu-t2" });
      expect((await jobStore.get(jobT2.jobId))?.state).toBe("FAILED");
      expect((await jobStore.get(jobT2.jobId))?.lastApplyStatus).toBe("OUT_OF_ORDER_WAIT");

      await processOutcomeMonitorJob(jobT1.jobId, { store, jobStore, workerId: "emu-t1" });
      expect((await jobStore.get(jobT1.jobId))?.state).toBe("COMPLETED");

      // Advance backoff for T2 retry
      const failed = await jobStore.get(jobT2.jobId);
      await jobStore.fail(jobT2.jobId!, "force-due", "OUT_OF_ORDER_WAIT", "OUT_OF_ORDER_WAIT");
      // Re-read and manually set nextAttemptAt via transaction-like re-enqueue path:
      // claim requires nextAttemptAt <= now — use fail then patch by re-getting.
      // Emulator: write nextAttemptAt directly.
      const db = getFirestore(app);
      await db
        .collection("outcomeMonitorJobs")
        .doc(jobT2.jobId)
        .set(
          {
            state: "FAILED",
            nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
            lastApplyStatus: "OUT_OF_ORDER_WAIT"
          },
          { merge: true }
        );
      void failed;

      await processOutcomeMonitorJob(jobT2.jobId, { store, jobStore, workerId: "emu-t2b" });
      expect((await jobStore.get(jobT2.jobId))?.state).toBe("COMPLETED");
      const final = await store.get("emu-user", signalId);
      expect(final?.entry.entryReached).toBe(true);
      expect(final?.finalResult?.outcome).toBe("LOSS");
      expect(final?.lastAppliedBarTime).toBe(T2);
    },
    30_000
  );

  it(
    "production listActiveMatching query executes with timeframe in index path",
    async () => {
      if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
      const a = createSignalOutcomeFromDecision(decision(`match-a-${Date.now()}`));
      const b = createSignalOutcomeFromDecision({
        ...decision(`match-b-${Date.now()}`),
        timeframe: "60"
      });
      await store.save(a);
      await store.save(b);
      const matched = await store.listActiveMatching("emu-user", {
        symbol: "XAUUSD",
        timeframe: "15",
        environment: "TEST"
      });
      expect(matched.some((r) => r.snapshot.signalId === a.snapshot.signalId)).toBe(true);
      expect(matched.every((r) => String(r.snapshot.timeframe ?? "") === "15")).toBe(true);
    },
    30_000
  );

  it(
    "production outcomeMonitorJobs due query executes (state + nextAttemptAt)",
    async () => {
      if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
      const eventId = `due-${Date.now()}`;
      const record = createSignalOutcomeFromDecision(decision(`due-sig-${Date.now()}`));
      await store.save(record);
      await jobStore.enqueue({
        userId: "emu-user",
        signalId: record.snapshot.signalId,
        eventId,
        bar: bar({ eventId, barTime: T1, low: 4130, high: 4132, close: 4131 })
      });
      const due = await jobStore.listDue(20);
      expect(due.some((j) => j.eventId === eventId)).toBe(true);
    },
    30_000
  );
});
