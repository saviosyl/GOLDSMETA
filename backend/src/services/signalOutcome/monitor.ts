/**
 * Signal outcome monitoring — durable, idempotent, lease-protected.
 * Market data: TradingView confirmed OHLCV via webhook pipeline (same as decision engine).
 * Never places broker orders.
 *
 * Per-signal child jobs process bars chronologically by barTime. A job must not
 * COMPLETE while any intended apply returned LEASE_BUSY or OUT_OF_ORDER_WAIT.
 */

import { randomUUID } from "crypto";
import type { DecisionRecord } from "../../models/types";
import { logger } from "../logging/logger";
import { getFirestoreDb } from "../firebaseAdmin";
import {
  createSignalOutcomeFromDecision,
  signalIdForDecision
} from "./engine";
import type { ApplyBarResult, SignalBarInput, SignalOutcomeRecord } from "./types";
import {
  FirestoreSignalOutcomeStore,
  InMemorySignalOutcomeStore,
  type SignalOutcomeStore
} from "./store";
import { FailClosedSignalOutcomeStore } from "./failClosedStore";
import {
  allowInMemorySignalOutcomeStore,
  SignalOutcomeStorageUnavailableError
} from "./storagePolicy";
import {
  getOutcomeMonitorJobStore,
  RETRY_APPLY_STATUSES,
  SAFE_COMPLETE_APPLY_STATUSES,
  type OutcomeMonitorJobStore
} from "./monitorJobs";

let singleton: SignalOutcomeStore | null = null;

export function getSignalOutcomeStore(): SignalOutcomeStore {
  if (singleton) return singleton;
  const db = getFirestoreDb();
  if (db != null) {
    singleton = new FirestoreSignalOutcomeStore(db);
    return singleton;
  }
  if (allowInMemorySignalOutcomeStore()) {
    singleton = new InMemorySignalOutcomeStore();
    return singleton;
  }
  logger.error("Signal outcome storage unavailable — fail closed", {
    code: "SIGNAL_OUTCOME_STORAGE_UNAVAILABLE"
  });
  singleton = new FailClosedSignalOutcomeStore();
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
  try {
    const existing = await store.getByDecisionId(decision.userId, decision.decisionId);
    if (existing) return existing;
    const created = createSignalOutcomeFromDecision(decision);
    return store.save(created);
  } catch (error: unknown) {
    if (error instanceof SignalOutcomeStorageUnavailableError) {
      logger.warn("Signal outcome create skipped — storage unavailable", {
        code: error.code,
        decisionId: decision.decisionId
      });
    }
    throw error;
  }
}

/**
 * Fan-out durable per-signal child jobs for every matching active signal.
 */
export async function enqueueMatchingOutcomeMonitorJobs(
  userId: string,
  bar: SignalBarInput,
  store: SignalOutcomeStore = getSignalOutcomeStore(),
  jobStore: OutcomeMonitorJobStore = getOutcomeMonitorJobStore()
): Promise<string[]> {
  const active = await store.listActiveMatching(userId, {
    symbol: bar.symbol,
    timeframe: bar.timeframe,
    environment: bar.environment
  });
  const jobIds: string[] = [];
  for (const signal of active) {
    const job = await jobStore.enqueue({
      userId,
      signalId: signal.snapshot.signalId,
      eventId: bar.eventId,
      bar: { ...bar, source: bar.source ?? "tradingview-ohlcv" }
    });
    jobIds.push(job.jobId);
  }
  return jobIds;
}

/**
 * Apply one confirmed bar to every matching active signal.
 * Returns explicit per-signal statuses (including LEASE_BUSY).
 */
export async function monitorMatchingSignalsWithBar(
  userId: string,
  bar: SignalBarInput,
  store: SignalOutcomeStore = getSignalOutcomeStore(),
  workerId: string = `monitor-${randomUUID().slice(0, 8)}`
): Promise<ApplyBarResult[]> {
  const active = await store.listActiveMatching(userId, {
    symbol: bar.symbol,
    timeframe: bar.timeframe,
    environment: bar.environment
  });
  const results: ApplyBarResult[] = [];
  for (const signal of active) {
    const result = await store.applyBarAtomic(
      userId,
      signal.snapshot.signalId,
      { ...bar, source: bar.source ?? "tradingview-ohlcv" },
      workerId,
      60_000
    );
    if (result.status === "LEASE_BUSY") {
      logger.info("Signal monitor lease busy — will durable-retry", {
        signalId: signal.snapshot.signalId,
        workerId,
        status: result.status
      });
    }
    results.push(result);
  }
  return results;
}

/** @deprecated Use monitorMatchingSignalsWithBar */
export async function monitorSignalWithBar(
  userId: string,
  bar: SignalBarInput,
  store: SignalOutcomeStore = getSignalOutcomeStore(),
  workerId?: string
): Promise<ApplyBarResult[]> {
  return monitorMatchingSignalsWithBar(userId, bar, store, workerId);
}

/**
 * Create/load signal from decision. Does NOT apply the creation candle
 * (no same-candle lookahead). Enqueues durable per-signal child jobs.
 */
export async function syncDecisionAndMonitor(
  decision: DecisionRecord,
  bar: SignalBarInput | null,
  store: SignalOutcomeStore = getSignalOutcomeStore(),
  jobStore: OutcomeMonitorJobStore = getOutcomeMonitorJobStore()
): Promise<SignalOutcomeRecord> {
  const record = await ensureSignalOutcomeFromDecision(decision, store);
  if (!bar) return record;

  await enqueueMatchingOutcomeMonitorJobs(
    decision.userId,
    { ...bar, source: bar.source ?? "tradingview-ohlcv" },
    store,
    jobStore
  );

  return record;
}

/**
 * Process one durable per-signal outcome-monitor job.
 * Completes only on safe statuses; LEASE_BUSY / OUT_OF_ORDER_WAIT → backoff retry.
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
    // Chronological gate: do not apply a later bar while an earlier incomplete job exists.
    const earlier = await jobStore.listEarlierIncomplete(
      claimed.signalId,
      claimed.barTime,
      claimed.jobId
    );
    if (earlier.length > 0) {
      logger.info("Outcome monitor waiting for earlier bar", {
        jobId,
        signalId: claimed.signalId,
        barTime: claimed.barTime,
        blockedBy: earlier[0]!.jobId,
        earlierBarTime: earlier[0]!.barTime
      });
      await jobStore.fail(
        jobId,
        `OUT_OF_ORDER_WAIT: earlier bar ${earlier[0]!.barTime} still incomplete`,
        "OUT_OF_ORDER_WAIT",
        "OUT_OF_ORDER_WAIT"
      );
      return;
    }

    const result = await store.applyBarAtomic(
      claimed.userId,
      claimed.signalId,
      { ...claimed.bar, source: claimed.bar.source ?? "tradingview-ohlcv" },
      workerId,
      60_000
    );

    if (RETRY_APPLY_STATUSES.has(result.status)) {
      logger.info("Outcome monitor durable retry required", {
        jobId,
        signalId: claimed.signalId,
        status: result.status
      });
      await jobStore.fail(
        jobId,
        result.status,
        result.status,
        result.status
      );
      return;
    }

    if (!SAFE_COMPLETE_APPLY_STATUSES.has(result.status)) {
      await jobStore.fail(
        jobId,
        `Unexpected apply status ${result.status}`,
        "MONITOR_APPLY_FAILED",
        result.status
      );
      return;
    }

    await jobStore.complete(jobId, result.status);
  } catch (error: unknown) {
    await jobStore.fail(
      jobId,
      error instanceof Error ? error : "unknown",
      "MONITOR_APPLY_FAILED"
    );
    throw error;
  }
}

export { signalIdForDecision, SignalOutcomeStorageUnavailableError };
