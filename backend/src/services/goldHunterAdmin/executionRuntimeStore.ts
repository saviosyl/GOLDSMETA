/**
 * Gold Hunter Demo execution runtime telemetry — owner-scoped.
 * In-memory on the quote worker; coalesced Firestore persistence so the API
 * Admin Diagnostics process can read the same truth (no secrets).
 */

import { getFirestoreDb } from "../firebaseAdmin";
import type { GoldHunterExecutionStage } from "./executionStages";

export type GoldHunterExecutionState =
  | "IDLE"
  | "OPPORTUNITY_DETECTED"
  | "QUEUED"
  | "QUEUE_FULL"
  | "EXECUTION_STARTED"
  | "PRECLAIM_CHECK"
  | "PRECLAIM_BLOCKED"
  | "CLAIMING"
  | "CLAIMED"
  | "SUBMITTING"
  | "FILLED"
  | "ACCEPTED_PENDING_FILL"
  | "BROKER_REJECTED"
  | "BROKER_SUBMIT_ERROR"
  | "PENDING_RECONCILIATION"
  | "RUNTIME_ERROR"
  | "DUPLICATE_ALREADY_CLAIMED"
  | "AUTOTRADE_OFF"
  | "PAUSED"
  | "EMERGENCY_STOP";

export type GoldHunterExecutionQueueTelemetry = {
  pending: number;
  dropped: number;
  completed: number;
  maxPendingSeen: number;
  activeOpportunityId: string | null;
  activeStartedAt: string | null;
  oldestPendingAgeMs: number | null;
  queueStuck: boolean;
};

export type GoldHunterExecutionTelemetry = {
  autoTradeEnabled: boolean;
  lastOpportunityId: string | null;
  lastSignalId: string | null;
  lastSetup: "A" | "B" | "C" | null;
  lastSide: "BUY" | "SELL" | null;
  lastOpportunityStartedAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptCompletedAt: string | null;
  state: GoldHunterExecutionState;
  blocker: string | null;
  detail: string | null;
  outcome: string | null;
  tradeId: string | null;
  brokerOrderIdMaskedOrSafe: string | null;
  brokerPositionIdMaskedOrSafe: string | null;
  attemptCountForOpportunity: number;
  /** Internal: last pre-claim failure classified as retryable. */
  lastRetryablePreclaim: boolean;
  /** Internal: last attempt obtained durable claim. */
  lastAttemptClaimed: boolean;
  queue: GoldHunterExecutionQueueTelemetry;
  /** Current / last execution stage (hang diagnosis). */
  currentStage: GoldHunterExecutionStage | null;
  stageStartedAt: string | null;
  lastStageCompletedAt: string | null;
  queueEnqueuedAt: string | null;
  queueStartedAt: string | null;
  /** Authoritative XAUUSD symbol metadata source for last attempt. */
  symbolMetadata: {
    available: boolean;
    source: "CTRADER_WORKER_SYMBOL_BY_ID" | "FALLBACK_DISCOVERY" | null;
    loadedAt: string | null;
    symbolId: string | null;
    accountMatched: boolean;
    environment: "DEMO" | "LIVE" | null;
  } | null;
  updatedAt?: string;
};

export type GoldHunterExecutionDiagnostics = Omit<
  GoldHunterExecutionTelemetry,
  "lastRetryablePreclaim" | "lastAttemptClaimed" | "updatedAt"
>;

const DEFAULT_QUEUE: GoldHunterExecutionQueueTelemetry = {
  pending: 0,
  dropped: 0,
  completed: 0,
  maxPendingSeen: 0,
  activeOpportunityId: null,
  activeStartedAt: null,
  oldestPendingAgeMs: null,
  queueStuck: false
};

/** Coalesce Firestore writes — never per Depth event. */
export const GH_EXECUTION_TELEMETRY_PERSIST_MIN_MS = 300;

function emptyTelemetry(): GoldHunterExecutionTelemetry {
  return {
    autoTradeEnabled: false,
    lastOpportunityId: null,
    lastSignalId: null,
    lastSetup: null,
    lastSide: null,
    lastOpportunityStartedAt: null,
    lastAttemptAt: null,
    lastAttemptCompletedAt: null,
    state: "IDLE",
    blocker: null,
    detail: null,
    outcome: null,
    tradeId: null,
    brokerOrderIdMaskedOrSafe: null,
    brokerPositionIdMaskedOrSafe: null,
    attemptCountForOpportunity: 0,
    lastRetryablePreclaim: false,
    lastAttemptClaimed: false,
    queue: { ...DEFAULT_QUEUE },
    currentStage: null,
    stageStartedAt: null,
    lastStageCompletedAt: null,
    queueEnqueuedAt: null,
    queueStartedAt: null,
    symbolMetadata: null
  };
}

const byOwner = new Map<string, GoldHunterExecutionTelemetry>();
const lastPersistAt = new Map<string, number>();
const persistInFlight = new Map<string, boolean>();
const pendingPersist = new Map<string, boolean>();
const hydratedFromStore = new Set<string>();

export function resetGoldHunterExecutionRuntimeForTests(): void {
  byOwner.clear();
  lastPersistAt.clear();
  persistInFlight.clear();
  pendingPersist.clear();
  hydratedFromStore.clear();
}

function execDoc(ownerUid: string) {
  const db = getFirestoreDb();
  if (!db) return null;
  return db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterExecution")
    .doc("runtime");
}

export function getGoldHunterExecutionTelemetry(
  ownerUid: string
): GoldHunterExecutionTelemetry {
  let t = byOwner.get(ownerUid);
  if (!t) {
    t = emptyTelemetry();
    byOwner.set(ownerUid, t);
  }
  return t;
}

function toDiagnostics(
  t: GoldHunterExecutionTelemetry
): GoldHunterExecutionDiagnostics {
  return {
    autoTradeEnabled: t.autoTradeEnabled,
    lastOpportunityId: t.lastOpportunityId,
    lastSignalId: t.lastSignalId,
    lastSetup: t.lastSetup,
    lastSide: t.lastSide,
    lastOpportunityStartedAt: t.lastOpportunityStartedAt,
    lastAttemptAt: t.lastAttemptAt,
    lastAttemptCompletedAt: t.lastAttemptCompletedAt,
    currentStage: t.currentStage,
    stageStartedAt: t.stageStartedAt,
    lastStageCompletedAt: t.lastStageCompletedAt,
    queueEnqueuedAt: t.queueEnqueuedAt,
    queueStartedAt: t.queueStartedAt,
    symbolMetadata: t.symbolMetadata
      ? { ...t.symbolMetadata }
      : null,
    state: t.state,
    blocker: t.blocker,
    detail: t.detail,
    outcome: t.outcome,
    tradeId: t.tradeId,
    brokerOrderIdMaskedOrSafe: t.brokerOrderIdMaskedOrSafe,
    brokerPositionIdMaskedOrSafe: t.brokerPositionIdMaskedOrSafe,
    attemptCountForOpportunity: t.attemptCountForOpportunity,
    queue: { ...t.queue }
  };
}

/** Public diagnostics shape — omits internal flags. Sync memory view. */
export function getGoldHunterExecutionDiagnostics(
  ownerUid: string
): GoldHunterExecutionDiagnostics {
  return toDiagnostics(getGoldHunterExecutionTelemetry(ownerUid));
}

/**
 * Hydrate from Firestore when this process has no local worker state
 * (API Cloud Function serving Admin Diagnostics).
 * Prefer Firestore when local is still IDLE / empty so API never invents truth.
 */
export async function loadGoldHunterExecutionDiagnostics(
  ownerUid: string
): Promise<GoldHunterExecutionDiagnostics> {
  const local = getGoldHunterExecutionTelemetry(ownerUid);
  const localHasWorkerTruth =
    local.lastOpportunityId != null ||
    local.lastAttemptAt != null ||
    (local.state !== "IDLE" && local.state !== "AUTOTRADE_OFF");

  if (localHasWorkerTruth) {
    return toDiagnostics(local);
  }

  const ref = execDoc(ownerUid);
  if (!ref) return toDiagnostics(local);
  try {
    const snap = await ref.get();
    hydratedFromStore.add(ownerUid);
    if (!snap.exists) return toDiagnostics(local);
    const data = snap.data() as Partial<GoldHunterExecutionTelemetry>;
    const merged: GoldHunterExecutionTelemetry = {
      ...emptyTelemetry(),
      ...data,
      queue: { ...DEFAULT_QUEUE, ...(data.queue ?? {}) },
      currentStage: data.currentStage ?? null,
      stageStartedAt: data.stageStartedAt ?? null,
      lastStageCompletedAt: data.lastStageCompletedAt ?? null,
      queueEnqueuedAt: data.queueEnqueuedAt ?? null,
      queueStartedAt: data.queueStartedAt ?? null,
      symbolMetadata: data.symbolMetadata
        ? { ...data.symbolMetadata }
        : null,
      lastRetryablePreclaim: Boolean(data.lastRetryablePreclaim),
      lastAttemptClaimed: Boolean(data.lastAttemptClaimed)
    };
    // Keep hydrated view in memory for this request cycle, but do not mark as
    // a worker writer — API must not schedulePersist over this.
    byOwner.set(ownerUid, merged);
    return toDiagnostics(merged);
  } catch {
    return toDiagnostics(local);
  }
}

function maskSafeId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 4) return id;
  return `…${id.slice(-4)}`;
}

function schedulePersist(ownerUid: string, force = false): void {
  const now = Date.now();
  const last = lastPersistAt.get(ownerUid) ?? 0;
  if (!force && now - last < GH_EXECUTION_TELEMETRY_PERSIST_MIN_MS) {
    pendingPersist.set(ownerUid, true);
    return;
  }
  if (persistInFlight.get(ownerUid)) {
    pendingPersist.set(ownerUid, true);
    return;
  }
  const ref = execDoc(ownerUid);
  if (!ref) return;
  persistInFlight.set(ownerUid, true);
  // Firestore rejects `undefined` field values — strip extras from patches.
  const raw = {
    ...getGoldHunterExecutionTelemetry(ownerUid),
    updatedAt: new Date().toISOString()
  };
  const payload = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  void ref
    .set(payload, { merge: true })
    .then(() => {
      lastPersistAt.set(ownerUid, Date.now());
    })
    .catch((err) => {
      console.warn(
        JSON.stringify({
          msg: "gold_hunter_execution_telemetry_persist_failed",
          product: "GOLD_HUNTER",
          error: err instanceof Error ? err.message.slice(0, 160) : "persist_failed"
        })
      );
    })
    .finally(() => {
      persistInFlight.set(ownerUid, false);
      if (pendingPersist.get(ownerUid)) {
        pendingPersist.set(ownerUid, false);
        schedulePersist(ownerUid, true);
      }
    });
}

export function patchGoldHunterExecutionTelemetry(
  ownerUid: string,
  patch: Partial<GoldHunterExecutionTelemetry> & {
    brokerOrderId?: string | null;
    brokerPositionId?: string | null;
  }
): GoldHunterExecutionTelemetry {
  const cur = getGoldHunterExecutionTelemetry(ownerUid);
  const {
    brokerOrderId: patchBrokerOrderId,
    brokerPositionId: patchBrokerPositionId,
    ...rest
  } = patch;
  const next: GoldHunterExecutionTelemetry = {
    ...cur,
    ...rest,
    queue: patch.queue ? { ...patch.queue } : cur.queue
  };
  if ("brokerOrderId" in patch) {
    next.brokerOrderIdMaskedOrSafe = maskSafeId(patchBrokerOrderId);
  }
  if ("brokerPositionId" in patch) {
    next.brokerPositionIdMaskedOrSafe = maskSafeId(patchBrokerPositionId);
  }
  byOwner.set(ownerUid, next);
  hydratedFromStore.add(ownerUid);

  const force =
    next.state === "FILLED" ||
    next.state === "CLAIMED" ||
    next.state === "SUBMITTING" ||
    next.state === "PRECLAIM_BLOCKED" ||
    next.state === "QUEUE_FULL" ||
    next.state === "RUNTIME_ERROR" ||
    next.state === "PENDING_RECONCILIATION" ||
    next.state === "BROKER_REJECTED" ||
    next.state === "BROKER_SUBMIT_ERROR" ||
    next.state === "DUPLICATE_ALREADY_CLAIMED" ||
    next.state === "OPPORTUNITY_DETECTED";
  schedulePersist(ownerUid, force);
  return next;
}

export function syncGoldHunterExecutionQueueStats(
  ownerUid: string,
  stats: GoldHunterExecutionQueueTelemetry
): void {
  patchGoldHunterExecutionTelemetry(ownerUid, { queue: { ...stats } });
}

export function beginGoldHunterExecutionStage(
  ownerUid: string,
  stage: GoldHunterExecutionStage,
  fields: {
    opportunityId: string;
    setup: "A" | "B" | "C" | null;
    side: "BUY" | "SELL" | null;
    attempt?: number;
    claimed?: boolean;
    tradeId?: string | null;
  }
): void {
  const now = new Date().toISOString();
  const prior = getGoldHunterExecutionTelemetry(ownerUid);
  patchGoldHunterExecutionTelemetry(ownerUid, {
    currentStage: stage,
    stageStartedAt: now,
    lastOpportunityId: fields.opportunityId,
    lastSetup: fields.setup,
    lastSide: fields.side,
    ...(fields.tradeId !== undefined ? { tradeId: fields.tradeId } : {}),
    ...(fields.claimed === true ? { lastAttemptClaimed: true } : {})
  });
  logGoldHunterExecutionEvent("gold_hunter_execution_stage_started", {
    opportunityId: fields.opportunityId,
    setup: fields.setup,
    side: fields.side,
    stage,
    attempt: fields.attempt ?? prior.attemptCountForOpportunity,
    claimed: fields.claimed === true || prior.lastAttemptClaimed,
    tradeId: fields.tradeId ?? prior.tradeId
  });
}

export function completeGoldHunterExecutionStage(
  ownerUid: string,
  stage: GoldHunterExecutionStage,
  fields: {
    opportunityId: string;
    setup: "A" | "B" | "C" | null;
    side: "BUY" | "SELL" | null;
    attempt?: number;
    claimed?: boolean;
    tradeId?: string | null;
  }
): void {
  const now = new Date().toISOString();
  const prior = getGoldHunterExecutionTelemetry(ownerUid);
  patchGoldHunterExecutionTelemetry(ownerUid, {
    currentStage: stage,
    lastStageCompletedAt: now,
    stageStartedAt: prior.stageStartedAt
  });
  logGoldHunterExecutionEvent("gold_hunter_execution_stage_completed", {
    opportunityId: fields.opportunityId,
    setup: fields.setup,
    side: fields.side,
    stage,
    attempt: fields.attempt ?? prior.attemptCountForOpportunity,
    claimed: fields.claimed === true || prior.lastAttemptClaimed,
    tradeId: fields.tradeId ?? prior.tradeId
  });
}

export function timeoutGoldHunterExecutionStage(
  ownerUid: string,
  stage: GoldHunterExecutionStage,
  fields: {
    opportunityId: string;
    setup: "A" | "B" | "C" | null;
    side: "BUY" | "SELL" | null;
    timeoutMs: number;
    op: string;
    attempt?: number;
  }
): void {
  const prior = getGoldHunterExecutionTelemetry(ownerUid);
  patchGoldHunterExecutionTelemetry(ownerUid, {
    state: "PRECLAIM_BLOCKED",
    blocker: "WAIT — RUNTIME TIMEOUT",
    detail: `${fields.op}_timeout_at_${stage}`,
    currentStage: stage,
    lastAttemptCompletedAt: new Date().toISOString(),
    lastRetryablePreclaim: true,
    lastAttemptClaimed: false
  });
  logGoldHunterExecutionEvent("gold_hunter_execution_stage_timeout", {
    opportunityId: fields.opportunityId,
    setup: fields.setup,
    side: fields.side,
    stage,
    timeoutMs: fields.timeoutMs,
    op: fields.op,
    attempt: fields.attempt ?? prior.attemptCountForOpportunity,
    claimed: false
  });
}

export function logGoldHunterExecutionEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    // Never log token-like keys.
    if (/token|secret|password|authorization/i.test(k)) continue;
    safe[k] = v;
  }
  // Structured single-line log for Cloud Logging searchability.
  console.info(
    JSON.stringify({
      msg: event,
      product: "GOLD_HUNTER",
      ts: new Date().toISOString(),
      ...safe
    })
  );
}
