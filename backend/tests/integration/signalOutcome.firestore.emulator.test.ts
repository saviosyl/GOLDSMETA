/**
 * Firestore Emulator concurrency tests for atomic signal-outcome bar application.
 * Requires FIRESTORE_EMULATOR_HOST (default 127.0.0.1:8081).
 * Never contacts brokers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeApp, deleteApp, getApps, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createSignalOutcomeFromDecision } from "../../src/services/signalOutcome/engine";
import { FirestoreSignalOutcomeStore } from "../../src/services/signalOutcome/store";
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
  let ready = false;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
    ready = await emulatorReachable();
    if (!ready) return;
    for (const existing of getApps()) {
      await deleteApp(existing);
    }
    app = initializeApp({ projectId: PROJECT });
    store = new FirestoreSignalOutcomeStore(getFirestore(app));
  }, 30_000);

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  it("runs concurrent applyBarAtomic without double-applying the same event", async () => {
    if (!ready) {
      console.warn("Skipping — Firestore emulator not reachable at", EMULATOR);
      return;
    }
    const record = createSignalOutcomeFromDecision(decision(`emu-${Date.now()}`));
    await store.save(record);

    const b = bar({ eventId: `shared-${Date.now()}`, barTime: T1, low: 4130, high: 4132, close: 4131 });
    const results = await Promise.all([
      store.applyBarAtomic("emu-user", record.snapshot.signalId, b, "worker-a"),
      store.applyBarAtomic("emu-user", record.snapshot.signalId, b, "worker-b"),
      store.applyBarAtomic("emu-user", record.snapshot.signalId, b, "worker-c")
    ]);

    const acquired = results.filter((r) => r != null);
    expect(acquired.length).toBeGreaterThanOrEqual(1);
    const final = await store.get("emu-user", record.snapshot.signalId);
    expect(final?.appliedBarEventIds.filter((id) => id === b.eventId)).toHaveLength(1);
    expect(final?.entry.entryReached).toBe(true);
    expect(final?.leaseOwnerId).toBeNull();
  });

  it("second chronological bar applies after first inside separate transactions", async () => {
    if (!ready) {
      console.warn("Skipping — Firestore emulator not reachable at", EMULATOR);
      return;
    }
    const record = createSignalOutcomeFromDecision(decision(`emu2-${Date.now()}`));
    await store.save(record);
    await store.applyBarAtomic(
      "emu-user",
      record.snapshot.signalId,
      bar({ eventId: `e1-${Date.now()}`, barTime: T1, low: 4130, high: 4132, close: 4131 }),
      "w1"
    );
    await store.applyBarAtomic(
      "emu-user",
      record.snapshot.signalId,
      bar({ eventId: `e2-${Date.now()}`, barTime: T2, low: 4126, high: 4130, close: 4126.5 }),
      "w2"
    );
    const final = await store.get("emu-user", record.snapshot.signalId);
    expect(final?.finalResult?.outcome).toBe("LOSS");
    expect(final?.lastAppliedBarTime).toBe(T2);
  });
});
