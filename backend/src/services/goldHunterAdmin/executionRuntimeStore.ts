/**
 * Gold Hunter Demo execution runtime telemetry — owner-scoped.
 * In-memory on the quote worker; coalesced Firestore persistence so the API
 * Admin Diagnostics process can read the same truth (no secrets).
 */

import { getFirestoreDb } from "../firebaseAdmin";

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
  maxPendingSeen: 0
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
    queue: { ...DEFAULT_QUEUE }
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
  const payload = {
    ...getGoldHunterExecutionTelemetry(ownerUid),
    updatedAt: new Date().toISOString()
  };
  void ref
    .set(payload, { merge: true })
    .then(() => {
      lastPersistAt.set(ownerUid, Date.now());
    })
    .catch(() => undefined)
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
  const next: GoldHunterExecutionTelemetry = {
    ...cur,
    ...patch,
    queue: patch.queue ? { ...patch.queue } : cur.queue
  };
  if ("brokerOrderId" in patch) {
    next.brokerOrderIdMaskedOrSafe = maskSafeId(patch.brokerOrderId);
  }
  if ("brokerPositionId" in patch) {
    next.brokerPositionIdMaskedOrSafe = maskSafeId(patch.brokerPositionId);
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
