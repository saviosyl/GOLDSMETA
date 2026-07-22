/**
 * Signal outcome monitoring — durable, idempotent, lease-protected.
 * Market data: TradingView confirmed OHLCV via webhook pipeline (same as decision engine).
 * Never places broker orders.
 */

import { randomUUID } from "crypto";
import type { DecisionRecord } from "../../models/types";
import { logger } from "../logging/logger";
import { getFirestoreDb } from "../firebaseAdmin";
import {
  applyBarToSignalOutcome,
  createSignalOutcomeFromDecision,
  signalIdForDecision
} from "./engine";
import type { SignalBarInput, SignalOutcomeRecord } from "./types";
import {
  FirestoreSignalOutcomeStore,
  InMemorySignalOutcomeStore,
  type SignalOutcomeStore
} from "./store";

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

export async function monitorSignalWithBar(
  userId: string,
  bar: SignalBarInput,
  store: SignalOutcomeStore = getSignalOutcomeStore(),
  workerId: string = `monitor-${randomUUID().slice(0, 8)}`
): Promise<SignalOutcomeRecord[]> {
  const active = await store.listActive(userId);
  const updated: SignalOutcomeRecord[] = [];
  for (const signal of active) {
    const leased = await store.tryAcquireLease(
      userId,
      signal.snapshot.signalId,
      workerId,
      60_000
    );
    if (!leased) {
      logger.info("Signal monitor lease not acquired", {
        signalId: signal.snapshot.signalId,
        workerId
      });
      continue;
    }
    const next = applyBarToSignalOutcome(leased, bar);
    updated.push(await store.save(next));
  }
  return updated;
}

export async function syncDecisionAndMonitor(
  decision: DecisionRecord,
  bar: SignalBarInput | null,
  store: SignalOutcomeStore = getSignalOutcomeStore()
): Promise<SignalOutcomeRecord> {
  const record = await ensureSignalOutcomeFromDecision(decision, store);
  if (!bar) return record;
  // Also apply to this specific signal (idempotent) even if not yet in active list semantics
  const leased = await store.tryAcquireLease(
    decision.userId,
    record.snapshot.signalId,
    `job-${bar.eventId}`,
    60_000
  );
  if (!leased) return record;
  const next = applyBarToSignalOutcome(leased, {
    ...bar,
    source: bar.source ?? "tradingview-ohlcv"
  });
  return store.save(next);
}

export { signalIdForDecision };
