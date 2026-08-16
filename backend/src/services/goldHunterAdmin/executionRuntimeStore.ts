/**
 * Gold Hunter Demo execution runtime telemetry — in-memory, owner-scoped.
 * Safe for Admin Diagnostics (no tokens / secrets / full account IDs).
 */

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
};

const DEFAULT_QUEUE: GoldHunterExecutionQueueTelemetry = {
  pending: 0,
  dropped: 0,
  completed: 0,
  maxPendingSeen: 0
};

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

export function resetGoldHunterExecutionRuntimeForTests(): void {
  byOwner.clear();
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

/** Public diagnostics shape — omits internal flags. */
export function getGoldHunterExecutionDiagnostics(ownerUid: string): {
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
  queue: GoldHunterExecutionQueueTelemetry;
} {
  const t = getGoldHunterExecutionTelemetry(ownerUid);
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

function maskSafeId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 4) return id;
  return `…${id.slice(-4)}`;
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
