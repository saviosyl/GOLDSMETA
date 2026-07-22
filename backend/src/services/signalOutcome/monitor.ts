/**
 * Signal outcome monitoring — durable, idempotent, lease-protected.
 * Market data: TradingView confirmed OHLCV via webhook pipeline (same as decision engine).
 * Never places broker orders.
 *
 * Every confirmed bar monitors ALL matching active signals (userId+symbol+timeframe+environment),
 * not only the decision created from that same event.
 */

import { randomUUID } from "crypto";
import type { DecisionRecord } from "../../models/types";
import { logger } from "../logging/logger";
import { getFirestoreDb } from "../firebaseAdmin";
import {
  createSignalOutcomeFromDecision,
  signalIdForDecision
} from "./engine";
import type { SignalBarInput, SignalOutcomeRecord } from "./types";
import {
  FirestoreSignalOutcomeStore,
  InMemorySignalOutcomeStore,
  type SignalOutcomeStore
} from "./store";
import {
  getOutcomeMonitorJobStore,
  type OutcomeMonitorJobStore
} from "./monitorJobs";

let singleton: SignalOutcomeStore | null = null;

export function getSignalOutcomeStore(): SignalOutcomeStore {
  if (singleton) return singleton;
  const db = getFirestoreDb();
  singleton =
    db != null ? new FirestoreSignalOutcomeStore(db) : new InMemorySignalOutcomeStore();
  return singleton;
}

/** Test helper — force in-memory store. */
export function setSignalOutcomeStoreForTests(store: SignalOutcomeStore): void {
  singleton = store;
}

export async function ensureSignalOutcomeFromDecision(
  decision: DecisionRecord,
  store: SignalOutcomeStore = getSignalOutcomeStore()
): Promise<SignalOutcomeRecord> {
  const existing = await store.getByDecisionId(decision.userId, decision.decisionId);
  if (existing) return existing;
  const created = createSignalOutcomeFromDecision(decision);
  return store.save(created);
}

/**
 * Apply one confirmed bar to every matching active signal.
 * Uses atomic Firestore/in-memory apply (lease + transition + persist in one step).
 */
export async function monitorMatchingSignalsWithBar(
  userId: string,
  bar: SignalBarInput,
  store: SignalOutcomeStore = getSignalOutcomeStore(),
  workerId: string = `monitor-${randomUUID().slice(0, 8)}`
): Promise<SignalOutcomeRecord[]> {
  const active = await store.listActiveMatching(userId, {
    symbol: bar.symbol,
    timeframe: bar.timeframe,
    environment: bar.environment
  });
  const updated: SignalOutcomeRecord[] = [];
  for (const signal of active) {
    const result = await store.applyBarAtomic(
      userId,
      signal.snapshot.signalId,
      { ...bar, source: bar.source ?? "tradingview-ohlcv" },
      workerId,
      60_000
    );
    if (!result) {
      logger.info("Signal monitor lease not acquired", {
        signalId: signal.snapshot.signalId,
        workerId
      });
      continue;
    }
    updated.push(result.record);
  }
  return updated;
}

/** @deprecated Use monitorMatchingSignalsWithBar */
export async function monitorSignalWithBar(
  userId: string,
  bar: SignalBarInput,
  store: SignalOutcomeStore = getSignalOutcomeStore(),
  workerId?: string
): Promise<SignalOutcomeRecord[]> {
  return monitorMatchingSignalsWithBar(userId, bar, store, workerId);
}

/**
 * Create/load signal from decision. Does NOT apply the creation candle
 * (no same-candle lookahead). Optionally enqueues durable monitor work for a future bar.
 */
export async function syncDecisionAndMonitor(
  decision: DecisionRecord,
  bar: SignalBarInput | null,
  store: SignalOutcomeStore = getSignalOutcomeStore(),
  jobStore: OutcomeMonitorJobStore = getOutcomeMonitorJobStore()
): Promise<SignalOutcomeRecord> {
  const record = await ensureSignalOutcomeFromDecision(decision, store);
  if (!bar) return record;

  // Enqueue durable monitoring for ALL matching active signals (including this one).
  // Engine rejects barTime <= marketDataTimestamp for the newly created signal.
  await jobStore.enqueue({
    userId: decision.userId,
    eventId: bar.eventId,
    bar: { ...bar, source: bar.source ?? "tradingview-ohlcv" }
  });

  return record;
}

/**
 * Process one durable outcome-monitor job.
 * Retries on failure; decision job must not treat this as fire-and-forget complete.
 */
export async function processOutcomeMonitorJob(
  jobId: string,
  options: {
    store?: SignalOutcomeStore;
    jobStore?: OutcomeMonitorJobStore;
    workerId?: string;
  } = {}
): Promise<void> {
  const jobStore = options.jobStore ?? getOutcomeMonitorJobStore();
  const store = options.store ?? getSignalOutcomeStore();
  const workerId = options.workerId ?? `om-${randomUUID().slice(0, 8)}`;

  const claimed = await jobStore.claim(jobId, workerId, 120_000);
  if (!claimed) return;

  try {
    await monitorMatchingSignalsWithBar(claimed.userId, claimed.bar, store, workerId);
    await jobStore.complete(jobId);
  } catch (error: unknown) {
    await jobStore.fail(
      jobId,
      error instanceof Error ? error : "unknown",
      "MONITOR_APPLY_FAILED"
    );
    throw error;
  }
}

export { signalIdForDecision };
