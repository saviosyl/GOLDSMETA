/**
 * Gold Hunter Demo AutoExecution runtime — production call site for
 * attemptGoldHunterDemoExecution. Worker-driven only (not UI polling).
 *
 * Reliability:
 * - Enqueue on newOpportunity
 * - Bounded reconsider of the SAME opportunityId after retryable PRE-CLAIM failure
 *   or QUEUE_FULL (never after durable claim / unknown broker outcome)
 * - Telemetry + structured logs; exceptions never crash the quote worker
 */
import { loadGoldHunterDemoXauUsdSymbol } from "../broker/ctrader/workerSymbolMetadataCache";
import type { GoldHunterSymbolMetadataDiagnostics } from "../broker/ctrader/workerSymbolMetadataCache";
import { resetWorkerSymbolMetadataCacheForTests } from "../broker/ctrader/workerSymbolMetadataCache";
import { getSharedXauusdQuote } from "../marketFeed/sharedMarketData";
import { loadOwnerAuthConfig } from "../auth/ownerAuthConfig";
import { getOwnerQueue, resetOwnerQueuesForTests } from "./boundedQueue";
import { loadGoldHunterConfig } from "./configStore";
import {
  refreshGoldHunterCandidateAgainstLive
} from "./candidateFreshness";
import {
  attemptGoldHunterDemoExecution,
  type OrchestratorDeps,
  type OrchestratorResult
} from "./executionOrchestrator";
import {
  getGoldHunterExecutionTelemetry,
  logGoldHunterExecutionEvent,
  patchGoldHunterExecutionTelemetry,
  resetGoldHunterExecutionRuntimeForTests,
  syncGoldHunterExecutionQueueStats,
  beginGoldHunterExecutionStage,
  completeGoldHunterExecutionStage,
  timeoutGoldHunterExecutionStage,
  type GoldHunterExecutionState
} from "./executionRuntimeStore";
import {
  getGoldHunterSignalClaim,
  isGoldHunterSignalDurablyConsumed
} from "./signalClaimStore";
import {
  getGoldHunterStrategySelector,
  type GoldHunterSelectedCandidate
} from "./strategySelector";
import type { BrokerSymbol } from "../broker/domain";
import {
  GH_PRECLAIM_BROKER_METADATA_TIMEOUT_MS,
  GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
  isGoldHunterPreclaimTimeout,
  withGoldHunterPreclaimTimeout
} from "./preclaimBoundedOp";

function isPinnedOwnerAdmin(ownerUid: string): boolean {
  const pinned = loadOwnerAuthConfig().pinnedOwnerUid;
  return Boolean(pinned && pinned === ownerUid);
}

const FEED_STALE_MS = 45_000;

/** Coalesce retries — not every Depth event. Matches monitoring persist order of magnitude. */
export const GH_EXECUTION_RETRY_COOLDOWN_MS = 750;
/** Hard cap per opportunity identity — prevents unbounded retry storms. */
export const GH_EXECUTION_MAX_ATTEMPTS_PER_OPPORTUNITY = 8;

export type DemoAutoExecutionEnqueueResult = {
  enqueued: boolean;
  reason:
    | "ENQUEUED"
    | "NOT_NEW_OPPORTUNITY"
    | "QUEUE_FULL"
    | "NO_OPPORTUNITY"
    | "COOLDOWN"
    | "MAX_ATTEMPTS"
    | "ALREADY_CLAIMED"
    | "NOT_RETRYABLE"
    | "QUEUE_BUSY"
    | "IDENTITY_MISMATCH";
};

type RuntimeHooks = {
  attempt?: typeof attemptGoldHunterDemoExecution;
  loadSymbol?: (ownerUid: string) => Promise<BrokerSymbol | null>;
  /** Optional: override cache-aware loader (tests). */
  loadSymbolWithDiagnostics?: (
    ownerUid: string
  ) => Promise<{
    symbol: BrokerSymbol | null;
    diagnostics: GoldHunterSymbolMetadataDiagnostics;
  }>;
  isAdmin?: (ownerUid: string) => Promise<boolean>;
};

let hooks: RuntimeHooks = {};

export function setGoldHunterDemoAutoExecutionHooksForTests(
  h: RuntimeHooks
): void {
  hooks = h;
}

export function resetGoldHunterDemoAutoExecutionForTests(): void {
  hooks = {};
  resetOwnerQueuesForTests();
  resetGoldHunterExecutionRuntimeForTests();
  resetWorkerSymbolMetadataCacheForTests();
}

function syncQueue(ownerUid: string): void {
  syncGoldHunterExecutionQueueStats(
    ownerUid,
    getOwnerQueue("gh-demo-exec", ownerUid, 2).stats()
  );
}

/**
 * Classify whether a PRE-CLAIM failure may be reconsidered for the SAME opportunity.
 * Never retry after durable claim / unknown broker outcome.
 */
export function isGoldHunterPreclaimFailureRetryable(args: {
  blocker: string | null;
  detail?: string | null;
  claimed: boolean;
  outcome?: string | null;
}): boolean {
  if (args.claimed) return false;
  if (args.outcome === "PENDING_RECONCILIATION") return false;
  if (args.outcome === "FILLED" || args.outcome === "ACCEPTED_PENDING_FILL") {
    return false;
  }
  if (args.outcome === "BROKER_REJECTED" || args.outcome === "BROKER_SUBMIT_ERROR") {
    return false;
  }

  const b = args.blocker ?? "";
  const d = args.detail ?? "";

  // Hard non-retryable policy / config / environment.
  const nonRetryable = new Set([
    "WAIT — AUTOTRADE OFF",
    "WAIT — PAUSED",
    "WAIT — EMERGENCY STOP",
    "WAIT — LIVE ENVIRONMENT REFUSED",
    "WAIT — UNAUTHORIZED",
    "WAIT — CONFIG INVALID",
    "WAIT — DAILY LOSS LIMIT",
    "WAIT — MAX OPEN TRADES",
    "WAIT — CAPITAL LIMIT",
    "WAIT — SPREAD TOO WIDE",
    "WAIT — DEPTH INVALID",
    "WAIT — NO SETUP SELECTED",
    "WAIT — DUPLICATE SIGNAL",
    "WAIT — PROTECTION GEOMETRY NOT CONNECTED",
    "WAIT — ACCOUNT ENVIRONMENT UNKNOWN",
    "WAIT — BROKER DISCONNECTED",
    "WAIT — MARKET CLOSED"
  ]);
  if (nonRetryable.has(b)) return false;

  // Sizing fundamentally impossible (not transient metadata).
  if (b.includes("RISK BUDGET") || b.includes("LOT") || b.includes("STOP DISTANCE")) {
    return false;
  }

  // Resync permanently invalidates this opportunity identity.
  if (d === "resync_generation_mismatch") return false;
  if (d === "opportunity_no_longer_active") return false;
  if (d === "setup_or_side_changed") return false;
  if (d === "opportunity_consumed_or_not_executable") return false;

  // Transient / infrastructure / race (pre-claim).
  if (b === "WAIT — SIGNAL STALE") {
    // spot/depth stale or book race — reconsider while opportunity stays active.
    return (
      d === "book_generation_mismatch" ||
      d === "no_live_snapshot" ||
      d === "spot_side_stale" ||
      d === "depth_stale" ||
      d === "depth_book_age" ||
      d.startsWith("depth_")
    );
  }
  if (b === "WAIT — SIZING METADATA UNAVAILABLE") return true;
  if (b === "WAIT — ACCOUNT SNAPSHOT INVALID") return true;
  if (b === "WAIT — COMMITTED CAPITAL UNKNOWN") return true;
  if (b === "WAIT — RUNTIME TIMEOUT") return true;
  if (b === "QUEUE_FULL" || b === "RUNTIME_ERROR") return true;
  if (b.startsWith("RUNTIME_ERROR")) return true;

  // Unknown blockers: fail-closed (no rapid retry).
  return false;
}

function mapBlockerToState(blocker: string): GoldHunterExecutionState {
  switch (blocker) {
    case "WAIT — AUTOTRADE OFF":
      return "AUTOTRADE_OFF";
    case "WAIT — PAUSED":
      return "PAUSED";
    case "WAIT — EMERGENCY STOP":
      return "EMERGENCY_STOP";
    case "WAIT — DUPLICATE SIGNAL":
      return "DUPLICATE_ALREADY_CLAIMED";
    case "QUEUE_FULL":
      return "QUEUE_FULL";
    default:
      return "PRECLAIM_BLOCKED";
  }
}

function noteOpportunityDetected(
  ownerUid: string,
  opportunity: GoldHunterSelectedCandidate,
  autoTradeEnabled: boolean
): void {
  const id = opportunity.opportunityId || opportunity.signalId;
  const prev = getGoldHunterExecutionTelemetry(ownerUid);
  const same =
    prev.lastOpportunityId === id && prev.lastOpportunityStartedAt != null;
  patchGoldHunterExecutionTelemetry(ownerUid, {
    autoTradeEnabled,
    lastOpportunityId: id,
    lastSignalId: id,
    lastSetup: opportunity.setup,
    lastSide: opportunity.side,
    lastOpportunityStartedAt: same
      ? prev.lastOpportunityStartedAt
      : new Date().toISOString(),
    attemptCountForOpportunity: same ? prev.attemptCountForOpportunity : 0,
    lastRetryablePreclaim: same ? prev.lastRetryablePreclaim : false,
    lastAttemptClaimed: same ? prev.lastAttemptClaimed : false,
    state: "OPPORTUNITY_DETECTED",
    blocker: null,
    detail: same ? prev.detail : null,
    outcome: same ? prev.outcome : null
  });
  logGoldHunterExecutionEvent("gold_hunter_opportunity_detected", {
    opportunityId: id,
    setup: opportunity.setup,
    side: opportunity.side,
    attempt: same ? prev.attemptCountForOpportunity : 0
  });
}

/**
 * Called from market-data hot path when selector reports newOpportunity
 * OR when reconsidering an active unconsumed opportunity after retryable failure.
 * Never blocks on broker — enqueues bounded async work.
 */
export function enqueueGoldHunterDemoAutoExecution(args: {
  ownerUid: string;
  newOpportunity: boolean;
  opportunity: GoldHunterSelectedCandidate | null;
  source?: "NEW" | "RETRY";
}): DemoAutoExecutionEnqueueResult {
  const source = args.source ?? (args.newOpportunity ? "NEW" : "RETRY");
  if (!args.opportunity) {
    return { enqueued: false, reason: "NO_OPPORTUNITY" };
  }
  if (source === "NEW" && !args.newOpportunity) {
    return { enqueued: false, reason: "NOT_NEW_OPPORTUNITY" };
  }

  const opportunity = args.opportunity;
  const id = opportunity.opportunityId || opportunity.signalId;
  const tel = getGoldHunterExecutionTelemetry(args.ownerUid);

  if (source === "NEW") {
    noteOpportunityDetected(args.ownerUid, opportunity, tel.autoTradeEnabled);
  }

  if (source === "RETRY") {
    if (tel.lastAttemptClaimed) {
      return { enqueued: false, reason: "ALREADY_CLAIMED" };
    }
    if (tel.lastOpportunityId === id && !tel.lastRetryablePreclaim) {
      // First attempt never ran (e.g. only QUEUE_FULL) → allow; else require retryable flag.
      if (tel.attemptCountForOpportunity > 0 && tel.state !== "QUEUE_FULL") {
        return { enqueued: false, reason: "NOT_RETRYABLE" };
      }
    }
    if (
      tel.lastOpportunityId === id &&
      tel.attemptCountForOpportunity >= GH_EXECUTION_MAX_ATTEMPTS_PER_OPPORTUNITY
    ) {
      return { enqueued: false, reason: "MAX_ATTEMPTS" };
    }
    const lastAt = tel.lastAttemptAt ? Date.parse(tel.lastAttemptAt) : 0;
    if (
      Number.isFinite(lastAt) &&
      Date.now() - lastAt < GH_EXECUTION_RETRY_COOLDOWN_MS
    ) {
      return { enqueued: false, reason: "COOLDOWN" };
    }
  }

  const q = getOwnerQueue("gh-demo-exec", args.ownerUid, 2);
  const stats = q.stats();
  if (stats.pending > 0 && source === "RETRY") {
    syncQueue(args.ownerUid);
    return { enqueued: false, reason: "QUEUE_BUSY" };
  }

  const ok = q.enqueue(async () => {
    try {
      await runGoldHunterDemoAutoExecution(args.ownerUid, opportunity);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message.slice(0, 160) : "UNKNOWN_RUNTIME_ERROR";
      patchGoldHunterExecutionTelemetry(args.ownerUid, {
        state: "RUNTIME_ERROR",
        blocker: "RUNTIME_ERROR",
        detail: msg,
        lastAttemptCompletedAt: new Date().toISOString(),
        lastRetryablePreclaim: true,
        lastAttemptClaimed: false,
        outcome: null
      });
      logGoldHunterExecutionEvent("gold_hunter_execution_runtime_error", {
        opportunityId: id,
        setup: opportunity.setup,
        side: opportunity.side,
        error: msg,
        attempt: getGoldHunterExecutionTelemetry(args.ownerUid)
          .attemptCountForOpportunity
      });
    } finally {
      syncQueue(args.ownerUid);
    }
  }, { opportunityId: id });

  syncQueue(args.ownerUid);

  if (!ok) {
    patchGoldHunterExecutionTelemetry(args.ownerUid, {
      autoTradeEnabled: tel.autoTradeEnabled,
      lastOpportunityId: id,
      lastSignalId: id,
      lastSetup: opportunity.setup,
      lastSide: opportunity.side,
      state: "QUEUE_FULL",
      blocker: "QUEUE_FULL",
      detail: "execution_queue_at_capacity",
      lastRetryablePreclaim: true,
      lastAttemptClaimed: false
    });
    logGoldHunterExecutionEvent("gold_hunter_execution_queue_full", {
      opportunityId: id,
      setup: opportunity.setup,
      side: opportunity.side,
      pending: q.stats().pending,
      dropped: q.stats().dropped,
      queueStuck: q.stats().queueStuck,
      oldestPendingAgeMs: q.stats().oldestPendingAgeMs,
      activeOpportunityId: q.stats().activeOpportunityId
    });
    return { enqueued: false, reason: "QUEUE_FULL" };
  }

  const enqueuedAt = new Date().toISOString();
  patchGoldHunterExecutionTelemetry(args.ownerUid, {
    state: "QUEUED",
    blocker: null,
    detail: source === "RETRY" ? "retry_enqueued" : "new_opportunity_enqueued",
    queueEnqueuedAt: enqueuedAt
  });
  logGoldHunterExecutionEvent(
    source === "RETRY"
      ? "gold_hunter_execution_retry_scheduled"
      : "gold_hunter_execution_enqueued",
    {
      opportunityId: id,
      setup: opportunity.setup,
      side: opportunity.side,
      attempt: getGoldHunterExecutionTelemetry(args.ownerUid)
        .attemptCountForOpportunity
    }
  );
  return { enqueued: true, reason: "ENQUEUED" };
}

/**
 * On later market ticks: if the SAME opportunity is still active, unconsumed,
 * depth-executable, and a prior attempt failed before durable claim with a
 * retryable condition (or never ran due to QUEUE_FULL), enqueue a bounded retry.
 */
export function maybeReconsiderGoldHunterDemoAutoExecution(
  ownerUid: string
): DemoAutoExecutionEnqueueResult {
  const sel = getGoldHunterStrategySelector(ownerUid);
  const live = sel.getExecutableCandidate();
  if (!live || !live.depthExecutable || live.consumed) {
    return { enqueued: false, reason: "NO_OPPORTUNITY" };
  }

  const id = live.opportunityId || live.signalId;
  const tel = getGoldHunterExecutionTelemetry(ownerUid);

  // Only reconsider the opportunity we already know about.
  if (tel.lastOpportunityId != null && tel.lastOpportunityId !== id) {
    return { enqueued: false, reason: "IDENTITY_MISMATCH" };
  }

  if (tel.lastAttemptClaimed) {
    return { enqueued: false, reason: "ALREADY_CLAIMED" };
  }

  const eligible =
    tel.state === "QUEUE_FULL" ||
    tel.state === "RUNTIME_ERROR" ||
    (tel.lastRetryablePreclaim && tel.state === "PRECLAIM_BLOCKED") ||
    (tel.state === "OPPORTUNITY_DETECTED" &&
      tel.attemptCountForOpportunity === 0 &&
      tel.lastOpportunityId === id);

  if (!eligible) {
    return { enqueued: false, reason: "NOT_RETRYABLE" };
  }

  return enqueueGoldHunterDemoAutoExecution({
    ownerUid,
    newOpportunity: false,
    opportunity: live,
    source: "RETRY"
  });
}

/**
 * Production body: load config → OFF means no order → else orchestrator.
 * All pre-claim external I/O is bounded so a hung read cannot stall the queue.
 */
export async function runGoldHunterDemoAutoExecution(
  ownerUid: string,
  opportunity: GoldHunterSelectedCandidate,
  depsOverride?: Partial<OrchestratorDeps>
): Promise<OrchestratorResult | { ok: false; skipped: string }> {
  const opportunityId = opportunity.opportunityId || opportunity.signalId;
  const stageCtx = {
    opportunityId,
    setup: opportunity.setup,
    side: opportunity.side
  };

  const startedAt = new Date().toISOString();
  patchGoldHunterExecutionTelemetry(ownerUid, {
    queueStartedAt: startedAt
  });
  beginGoldHunterExecutionStage(ownerUid, "QUEUE_DEQUEUED", stageCtx);
  completeGoldHunterExecutionStage(ownerUid, "QUEUE_DEQUEUED", stageCtx);

  beginGoldHunterExecutionStage(ownerUid, "CONFIG_LOAD_START", stageCtx);
  let config;
  try {
    config = await withGoldHunterPreclaimTimeout(
      "loadGoldHunterConfig",
      "CONFIG_LOAD_START",
      GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
      () => loadGoldHunterConfig(ownerUid)
    );
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      timeoutGoldHunterExecutionStage(ownerUid, "CONFIG_LOAD_START", {
        ...stageCtx,
        timeoutMs: e.timeoutMs,
        op: e.op
      });
      return {
        ok: false,
        submitted: false,
        blockers: ["WAIT — RUNTIME TIMEOUT"],
        signalId: opportunityId
      };
    }
    throw e;
  }
  completeGoldHunterExecutionStage(ownerUid, "CONFIG_LOAD_DONE", stageCtx);

  patchGoldHunterExecutionTelemetry(ownerUid, {
    autoTradeEnabled: config.demoAutoTradeEnabled,
    lastOpportunityId: opportunityId,
    lastSignalId: opportunityId,
    lastSetup: opportunity.setup,
    lastSide: opportunity.side,
    lastAttemptAt: new Date().toISOString(),
    state: "EXECUTION_STARTED",
    attemptCountForOpportunity:
      getGoldHunterExecutionTelemetry(ownerUid).lastOpportunityId === opportunityId
        ? getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity + 1
        : 1,
    lastAttemptClaimed: false
  });

  // Prefer specific safety states over generic AUTOTRADE_OFF when both apply.
  if (config.emergencyStopActive) {
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: "EMERGENCY_STOP",
      blocker: "WAIT — EMERGENCY STOP",
      detail: "emergency_stop_active",
      lastAttemptCompletedAt: new Date().toISOString(),
      lastRetryablePreclaim: false,
      autoTradeEnabled: false
    });
    return { ok: false, skipped: "WAIT — EMERGENCY STOP" };
  }

  if (config.pauseNewEntries) {
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: "PAUSED",
      blocker: "WAIT — PAUSED",
      detail: "pause_new_entries",
      lastAttemptCompletedAt: new Date().toISOString(),
      lastRetryablePreclaim: false
    });
    return { ok: false, skipped: "WAIT — PAUSED" };
  }

  if (!config.demoAutoTradeEnabled) {
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: "AUTOTRADE_OFF",
      blocker: "WAIT — AUTOTRADE OFF",
      detail: "demo_auto_trade_disabled",
      lastAttemptCompletedAt: new Date().toISOString(),
      lastRetryablePreclaim: false,
      outcome: null
    });
    logGoldHunterExecutionEvent("gold_hunter_preclaim_blocked", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side,
      blocker: "WAIT — AUTOTRADE OFF",
      attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
    });
    return { ok: false, skipped: "WAIT — AUTOTRADE OFF" };
  }

  beginGoldHunterExecutionStage(ownerUid, "IDENTITY_CHECK_START", {
    ...stageCtx,
    attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
  });
  // Fast identity gate — drain dead queued work before symbol/account I/O.
  const activeId =
    getGoldHunterStrategySelector(ownerUid).getActiveOpportunityId();
  if (activeId !== opportunityId) {
    completeGoldHunterExecutionStage(ownerUid, "IDENTITY_CHECK_DONE", stageCtx);
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: "PRECLAIM_BLOCKED",
      blocker: "WAIT — SIGNAL STALE",
      detail: "opportunity_no_longer_active",
      lastAttemptCompletedAt: new Date().toISOString(),
      lastRetryablePreclaim: false,
      lastAttemptClaimed: false
    });
    logGoldHunterExecutionEvent("gold_hunter_preclaim_blocked", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side,
      blocker: "WAIT — SIGNAL STALE",
      detail: "opportunity_no_longer_active",
      attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
    });
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — SIGNAL STALE"],
      signalId: opportunityId
    };
  }
  completeGoldHunterExecutionStage(ownerUid, "IDENTITY_CHECK_DONE", {
    ...stageCtx,
    attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
  });

  // Durable claim already exists → never resubmit.
  beginGoldHunterExecutionStage(ownerUid, "CLAIM_LOOKUP_START", {
    ...stageCtx,
    attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
  });
  let alreadyClaimed = false;
  try {
    alreadyClaimed = await withGoldHunterPreclaimTimeout(
      "isGoldHunterSignalDurablyConsumed",
      "CLAIM_LOOKUP_START",
      GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
      () => isGoldHunterSignalDurablyConsumed(ownerUid, opportunityId)
    );
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      timeoutGoldHunterExecutionStage(ownerUid, "CLAIM_LOOKUP_START", {
        ...stageCtx,
        timeoutMs: e.timeoutMs,
        op: e.op,
        attempt: getGoldHunterExecutionTelemetry(ownerUid)
          .attemptCountForOpportunity
      });
      return {
        ok: false,
        submitted: false,
        blockers: ["WAIT — RUNTIME TIMEOUT"],
        signalId: opportunityId
      };
    }
    throw e;
  }
  if (alreadyClaimed) {
    getGoldHunterStrategySelector(ownerUid).markOpportunityConsumed(opportunityId);
    let claim = null;
    try {
      claim = await withGoldHunterPreclaimTimeout(
        "getGoldHunterSignalClaim",
        "CLAIM_LOOKUP_START",
        GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
        () => getGoldHunterSignalClaim(ownerUid, opportunityId)
      );
    } catch (e) {
      if (isGoldHunterPreclaimTimeout(e)) {
        timeoutGoldHunterExecutionStage(ownerUid, "CLAIM_LOOKUP_START", {
          ...stageCtx,
          timeoutMs: e.timeoutMs,
          op: e.op,
          attempt: getGoldHunterExecutionTelemetry(ownerUid)
            .attemptCountForOpportunity
        });
        return {
          ok: false,
          submitted: false,
          blockers: ["WAIT — RUNTIME TIMEOUT"],
          signalId: opportunityId
        };
      }
      throw e;
    }
    completeGoldHunterExecutionStage(ownerUid, "CLAIM_LOOKUP_DONE", stageCtx);
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: "DUPLICATE_ALREADY_CLAIMED",
      blocker: "WAIT — DUPLICATE SIGNAL",
      detail: claim?.state ?? "claim_exists",
      lastAttemptCompletedAt: new Date().toISOString(),
      lastRetryablePreclaim: false,
      lastAttemptClaimed: true,
      tradeId: claim?.goldHunterTradeId ?? null,
      outcome: claim?.state ?? "ALREADY_CLAIMED",
      brokerOrderId: claim?.brokerOrderId ?? null,
      brokerPositionId: claim?.brokerPositionId ?? null
    });
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — DUPLICATE SIGNAL"],
      signalId: opportunityId
    };
  }
  completeGoldHunterExecutionStage(ownerUid, "CLAIM_LOOKUP_DONE", {
    ...stageCtx,
    attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
  });

  // Refresh market fields against live active opportunity (same identity).
  beginGoldHunterExecutionStage(ownerUid, "CANDIDATE_REFRESH_START", stageCtx);
  const refreshed =
    refreshGoldHunterCandidateAgainstLive({ ownerUid, candidate: opportunity }) ??
    opportunity;
  completeGoldHunterExecutionStage(ownerUid, "CANDIDATE_REFRESH_DONE", stageCtx);

  // Re-validate opportunity still active after any slow I/O above.
  const activeAfterIo =
    getGoldHunterStrategySelector(ownerUid).getActiveOpportunityId();
  if (
    activeAfterIo !== opportunityId ||
    !refreshed.depthExecutable ||
    refreshed.consumed
  ) {
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: "PRECLAIM_BLOCKED",
      blocker: "WAIT — SIGNAL STALE",
      detail: "opportunity_no_longer_active_after_preclaim_io",
      lastAttemptCompletedAt: new Date().toISOString(),
      lastRetryablePreclaim: false,
      lastAttemptClaimed: false
    });
    logGoldHunterExecutionEvent("gold_hunter_preclaim_blocked", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side,
      blocker: "WAIT — SIGNAL STALE",
      detail: "opportunity_no_longer_active_after_preclaim_io",
      attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
    });
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — SIGNAL STALE"],
      signalId: opportunityId
    };
  }

  patchGoldHunterExecutionTelemetry(ownerUid, {
    state: "PRECLAIM_CHECK",
    blocker: null,
    detail: null
  });

  const attempt = hooks.attempt ?? attemptGoldHunterDemoExecution;
  const checkAdmin =
    hooks.isAdmin ??
    (async (uid: string) => isPinnedOwnerAdmin(uid));

  beginGoldHunterExecutionStage(ownerUid, "SYMBOL_LOAD_START", {
    ...stageCtx,
    attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
  });
  let symbol: BrokerSymbol | null;
  let symbolDiagnostics: GoldHunterSymbolMetadataDiagnostics = {
    available: false,
    source: null,
    loadedAt: null,
    symbolId: null,
    accountMatched: false,
    environment: null
  };
  try {
    if (depsOverride?.symbol) {
      symbol = depsOverride.symbol;
      symbolDiagnostics = {
        available: true,
        source: "CTRADER_WORKER_SYMBOL_BY_ID",
        loadedAt: new Date().toISOString(),
        symbolId: String(symbol.symbolId),
        accountMatched: true,
        environment: symbol.environment === "LIVE" ? "LIVE" : "DEMO"
      };
    } else if (hooks.loadSymbolWithDiagnostics) {
      const loaded = await withGoldHunterPreclaimTimeout(
        "loadGoldHunterDemoXauUsdSymbol",
        "SYMBOL_LOAD_START",
        GH_PRECLAIM_BROKER_METADATA_TIMEOUT_MS,
        () => hooks.loadSymbolWithDiagnostics!(ownerUid)
      );
      symbol = loaded.symbol;
      symbolDiagnostics = loaded.diagnostics;
    } else if (hooks.loadSymbol) {
      // Legacy test hook — still wrapped; prefer cache-aware loader in production.
      symbol = await withGoldHunterPreclaimTimeout(
        "loadDemoXauUsdSymbol",
        "SYMBOL_LOAD_START",
        GH_PRECLAIM_BROKER_METADATA_TIMEOUT_MS,
        () => hooks.loadSymbol!(ownerUid)
      );
    } else {
      const loaded = await withGoldHunterPreclaimTimeout(
        "loadGoldHunterDemoXauUsdSymbol",
        "SYMBOL_LOAD_START",
        GH_PRECLAIM_BROKER_METADATA_TIMEOUT_MS,
        () => loadGoldHunterDemoXauUsdSymbol(ownerUid)
      );
      symbol = loaded.symbol;
      symbolDiagnostics = loaded.diagnostics;
    }
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      timeoutGoldHunterExecutionStage(ownerUid, "SYMBOL_LOAD_START", {
        ...stageCtx,
        timeoutMs: e.timeoutMs,
        op: e.op,
        attempt: getGoldHunterExecutionTelemetry(ownerUid)
          .attemptCountForOpportunity
      });
      patchGoldHunterExecutionTelemetry(ownerUid, {
        symbolMetadata: symbolDiagnostics
      });
      return {
        ok: false,
        submitted: false,
        blockers: ["WAIT — RUNTIME TIMEOUT"],
        signalId: opportunityId
      };
    }
    throw e;
  }
  patchGoldHunterExecutionTelemetry(ownerUid, {
    symbolMetadata: symbolDiagnostics
  });
  completeGoldHunterExecutionStage(ownerUid, "SYMBOL_LOAD_DONE", stageCtx);

  if (!symbol) {
    const blocker = "WAIT — SIZING METADATA UNAVAILABLE";
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: "PRECLAIM_BLOCKED",
      blocker,
      detail: "symbol_metadata_null",
      lastAttemptCompletedAt: new Date().toISOString(),
      lastRetryablePreclaim: true,
      lastAttemptClaimed: false
    });
    logGoldHunterExecutionEvent("gold_hunter_preclaim_blocked", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side,
      blocker,
      detail: "symbol_metadata_null",
      attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
    });
    return {
      ok: false,
      submitted: false,
      blockers: [blocker],
      signalId: opportunityId
    };
  }

  beginGoldHunterExecutionStage(ownerUid, "QUOTE_LOAD_START", stageCtx);
  let quote;
  try {
    quote = await withGoldHunterPreclaimTimeout(
      "getSharedXauusdQuote",
      "QUOTE_LOAD_START",
      GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
      () => getSharedXauusdQuote()
    );
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      timeoutGoldHunterExecutionStage(ownerUid, "QUOTE_LOAD_START", {
        ...stageCtx,
        timeoutMs: e.timeoutMs,
        op: e.op,
        attempt: getGoldHunterExecutionTelemetry(ownerUid)
          .attemptCountForOpportunity
      });
      return {
        ok: false,
        submitted: false,
        blockers: ["WAIT — RUNTIME TIMEOUT"],
        signalId: opportunityId
      };
    }
    throw e;
  }
  completeGoldHunterExecutionStage(ownerUid, "QUOTE_LOAD_DONE", stageCtx);

  const marketOpen = quote?.marketStatus === "OPEN";
  const ageMs =
    quote?.updatedAt != null
      ? Date.now() - Date.parse(quote.updatedAt)
      : quote?.quote?.ageMs ?? null;
  const feedFresh =
    ageMs != null && Number.isFinite(ageMs) && ageMs <= FEED_STALE_MS;

  beginGoldHunterExecutionStage(ownerUid, "ADMIN_CHECK_START", stageCtx);
  const isAdmin =
    depsOverride?.isAdmin ?? (await checkAdmin(ownerUid));
  completeGoldHunterExecutionStage(ownerUid, "ADMIN_CHECK_DONE", stageCtx);

  // Final relevance check before orchestrator / claim.
  const liveBeforeOrch =
    getGoldHunterStrategySelector(ownerUid).getExecutableCandidate();
  if (
    !liveBeforeOrch ||
    (liveBeforeOrch.opportunityId || liveBeforeOrch.signalId) !== opportunityId ||
    liveBeforeOrch.resyncGeneration !== refreshed.resyncGeneration ||
    !liveBeforeOrch.depthExecutable ||
    liveBeforeOrch.consumed
  ) {
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: "PRECLAIM_BLOCKED",
      blocker: "WAIT — SIGNAL STALE",
      detail: "opportunity_stale_before_orchestrator",
      lastAttemptCompletedAt: new Date().toISOString(),
      lastRetryablePreclaim: false,
      lastAttemptClaimed: false
    });
    logGoldHunterExecutionEvent("gold_hunter_preclaim_blocked", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side,
      blocker: "WAIT — SIGNAL STALE",
      detail: "opportunity_stale_before_orchestrator",
      attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
    });
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — SIGNAL STALE"],
      signalId: opportunityId
    };
  }

  beginGoldHunterExecutionStage(ownerUid, "ORCHESTRATOR_START", {
    ...stageCtx,
    attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
  });

  const result = await attempt(ownerUid, refreshed, {
    isAdmin,
    marketOpen: depsOverride?.marketOpen ?? marketOpen,
    feedFresh: depsOverride?.feedFresh ?? feedFresh,
    symbol,
    placeOrder: depsOverride?.placeOrder,
    beforeBrokerSubmit: depsOverride?.beforeBrokerSubmit,
    assertFresh: depsOverride?.assertFresh,
    onTelemetry: (ev) => {
      applyOrchestratorTelemetry(ownerUid, opportunityId, opportunity, ev);
    },
    onStage: (stage, kind) => {
      if (kind === "start") {
        beginGoldHunterExecutionStage(ownerUid, stage, {
          ...stageCtx,
          attempt: getGoldHunterExecutionTelemetry(ownerUid)
            .attemptCountForOpportunity
        });
      } else if (kind === "done") {
        completeGoldHunterExecutionStage(ownerUid, stage, {
          ...stageCtx,
          attempt: getGoldHunterExecutionTelemetry(ownerUid)
            .attemptCountForOpportunity
        });
      } else if (kind === "timeout") {
        timeoutGoldHunterExecutionStage(ownerUid, stage, {
          ...stageCtx,
          timeoutMs: GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
          op: `orchestrator_${stage}`,
          attempt: getGoldHunterExecutionTelemetry(ownerUid)
            .attemptCountForOpportunity
        });
      }
    }
  });

  finalizeFromOrchestratorResult(ownerUid, opportunity, result);
  return result;
}

type OrchestratorTelemetryEvent = {
  phase: GoldHunterExecutionState;
  blocker?: string | null;
  detail?: string | null;
  claimed?: boolean;
  outcome?: string | null;
  tradeId?: string | null;
  brokerOrderId?: string | null;
  brokerPositionId?: string | null;
};

function applyOrchestratorTelemetry(
  ownerUid: string,
  opportunityId: string,
  opportunity: GoldHunterSelectedCandidate,
  ev: OrchestratorTelemetryEvent
): void {
  patchGoldHunterExecutionTelemetry(ownerUid, {
    state: ev.phase,
    blocker: ev.blocker ?? null,
    detail: ev.detail ?? null,
    lastAttemptClaimed:
      ev.claimed === true
        ? true
        : getGoldHunterExecutionTelemetry(ownerUid).lastAttemptClaimed,
    outcome: ev.outcome ?? getGoldHunterExecutionTelemetry(ownerUid).outcome,
    tradeId: ev.tradeId ?? getGoldHunterExecutionTelemetry(ownerUid).tradeId,
    brokerOrderId: ev.brokerOrderId,
    brokerPositionId: ev.brokerPositionId
  });
  if (ev.phase === "CLAIMED" || ev.phase === "CLAIMING") {
    logGoldHunterExecutionEvent("gold_hunter_signal_claimed", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side,
      attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
    });
  }
  if (ev.phase === "SUBMITTING") {
    logGoldHunterExecutionEvent("gold_hunter_broker_submit_started", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side
    });
  }
  if (ev.phase === "FILLED") {
    logGoldHunterExecutionEvent("gold_hunter_broker_filled", {
      opportunityId,
      tradeId: ev.tradeId ?? null
    });
  }
  if (ev.phase === "BROKER_REJECTED") {
    logGoldHunterExecutionEvent("gold_hunter_broker_rejected", {
      opportunityId,
      blocker: ev.blocker ?? null
    });
  }
  if (ev.phase === "BROKER_SUBMIT_ERROR") {
    logGoldHunterExecutionEvent("gold_hunter_broker_submit_error", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side,
      blocker: ev.blocker ?? null,
      detail: ev.detail ?? null,
      attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
    });
  }
  if (ev.phase === "ACCEPTED_PENDING_FILL") {
    logGoldHunterExecutionEvent("gold_hunter_broker_accepted", {
      opportunityId,
      tradeId: ev.tradeId ?? null,
      brokerOrderId: ev.brokerOrderId ?? null,
      brokerPositionId: ev.brokerPositionId ?? null
    });
  }
  if (ev.phase === "PENDING_RECONCILIATION") {
    logGoldHunterExecutionEvent("gold_hunter_broker_pending_reconciliation", {
      opportunityId,
      tradeId: ev.tradeId ?? null,
      detail: ev.detail ?? null,
      blocker: ev.blocker ?? null
    });
  }
  if (ev.phase === "PRECLAIM_BLOCKED") {
    logGoldHunterExecutionEvent("gold_hunter_preclaim_blocked", {
      opportunityId,
      setup: opportunity.setup,
      side: opportunity.side,
      blocker: ev.blocker ?? null,
      detail: ev.detail ?? null,
      attempt: getGoldHunterExecutionTelemetry(ownerUid).attemptCountForOpportunity
    });
  }
}

function finalizeFromOrchestratorResult(
  ownerUid: string,
  opportunity: GoldHunterSelectedCandidate,
  result: OrchestratorResult | { ok: false; skipped: string }
): void {
  const completedAt = new Date().toISOString();
  const prior = getGoldHunterExecutionTelemetry(ownerUid);

  if ("skipped" in result) {
    const blocker = result.skipped;
    const state = mapBlockerToState(blocker);
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state,
      blocker,
      detail: prior.detail ?? "skipped_before_orchestrator",
      lastAttemptCompletedAt: completedAt,
      lastRetryablePreclaim: isGoldHunterPreclaimFailureRetryable({
        blocker,
        detail: prior.detail,
        claimed: false
      }),
      lastAttemptClaimed: false
    });
    return;
  }

  const orch: OrchestratorResult = result;

  if (!orch.ok) {
    const blocker = orch.blockers[0] ?? "WAIT — UNKNOWN";
    const claimed =
      prior.lastAttemptClaimed || blocker === "WAIT — DUPLICATE SIGNAL";
    const detail = prior.detail ?? blocker;
    // Post-claim broker gate failures must NEVER retry (claim is durable).
    const retryable = claimed
      ? false
      : isGoldHunterPreclaimFailureRetryable({
          blocker,
          detail,
          claimed: false
        });
    patchGoldHunterExecutionTelemetry(ownerUid, {
      state: claimed
        ? prior.state === "BROKER_SUBMIT_ERROR" ||
          prior.state === "BROKER_REJECTED" ||
          prior.state === "PENDING_RECONCILIATION" ||
          prior.state === "DUPLICATE_ALREADY_CLAIMED"
          ? prior.state
          : "DUPLICATE_ALREADY_CLAIMED"
        : mapBlockerToState(blocker),
      blocker,
      detail,
      lastAttemptCompletedAt: completedAt,
      lastRetryablePreclaim: retryable,
      lastAttemptClaimed: claimed,
      outcome: claimed ? prior.outcome ?? "CLAIMED_NO_FILL" : null
    });
    return;
  }

  // ok:true paths — claim obtained (or pending recon after claim).
  const claimed = true;
  let state: GoldHunterExecutionState = "CLAIMED";
  if (orch.outcome === "FILLED") state = "FILLED";
  else if (orch.outcome === "ACCEPTED_PENDING_FILL") state = "ACCEPTED_PENDING_FILL";
  else if (orch.outcome === "BROKER_REJECTED") state = "BROKER_REJECTED";
  else if (orch.outcome === "BROKER_SUBMIT_ERROR") state = "BROKER_SUBMIT_ERROR";
  else if (orch.outcome === "PENDING_RECONCILIATION") {
    state = "PENDING_RECONCILIATION";
  }

  patchGoldHunterExecutionTelemetry(ownerUid, {
    state,
    blocker: null,
    detail: orch.detail ?? prior.detail,
    outcome: orch.outcome,
    tradeId: orch.tradeId,
    lastAttemptCompletedAt: completedAt,
    lastRetryablePreclaim: false,
    lastAttemptClaimed: claimed
  });
}

/** Test helper — wait for owner's execution queue to drain. */
export async function drainGoldHunterDemoAutoExecutionForTests(
  ownerUid: string
): Promise<void> {
  await getOwnerQueue("gh-demo-exec", ownerUid, 2).drainForTests();
}

export function goldHunterDemoExecQueueStats(ownerUid: string) {
  return getOwnerQueue("gh-demo-exec", ownerUid, 2).stats();
}

// Re-export for call-site discovery / grepping.
export { attemptGoldHunterDemoExecution };
