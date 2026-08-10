/**
 * Internal AutoTrade armed-candidate lifecycle.
 *
 * Pure engine logic only — no UI labels. Retains a previously qualified
 * BUY/SELL setup while waiting for existing 5M entry confirmation, then
 * re-runs normal safety gates before any execution attempt.
 */

import { setupLifecycleConfig } from "../../../config/setupLifecycleConfig";
import { resolveAuthoritativeConfirmation } from "../../decision/tradePlanGeometry";

/** Same entry window as WAITING_FOR_ENTRY setups (setupExpiryBars × 15m). */
export function maxArmedCandidateAgeMs(): number {
  return setupLifecycleConfig.limits.setupExpiryBars * 15 * 60 * 1000;
}

/**
 * Stale / cross-session guard — backend restarts may reload an armed doc from
 * Firestore; age + optional plan validUntil reuse existing setup expiry rules.
 */
export function isArmedCandidateStale(args: {
  armedAt: string;
  nowIso: string;
  sessionPlanValidUntil?: string | null;
}): boolean {
  const armedMs = Date.parse(args.armedAt);
  const nowMs = Date.parse(args.nowIso);
  if (!Number.isFinite(armedMs) || !Number.isFinite(nowMs)) return true;
  if (nowMs - armedMs > maxArmedCandidateAgeMs()) return true;
  if (args.sessionPlanValidUntil) {
    const until = Date.parse(args.sessionPlanValidUntil);
    if (Number.isFinite(until) && until < nowMs) return true;
  }
  return false;
}

export type ArmedCandidateStatus = "ARMED" | "EXECUTED" | "INVALIDATED";

export type ArmedCandidate = {
  candidateId: string;
  uid: string;
  symbol: "XAUUSD";
  direction: "BUY" | "SELL";
  /** Original qualifying decision / signal id. */
  signalId: string;
  planSourceKey: string | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number | null;
  setupScore: number | null;
  armedAt: string;
  updatedAt: string;
  status: ArmedCandidateStatus;
  invalidationReason: string | null;
  /** Prevents duplicate broker submissions across confirmation-true evaluations. */
  executionAttempted: boolean;
  lastReasonCode: string | null;
};

export type ArmedLifecycleAction =
  | "ARM"
  | "KEEP_WAITING"
  | "READY_TO_EXECUTE"
  | "INVALIDATE"
  | "REPLACE_WITH_OPPOSITE"
  | "NONE";

export type ArmedLifecycleResult = {
  action: ArmedLifecycleAction;
  candidate: ArmedCandidate | null;
  reasonCode: string;
  /** When REPLACE_WITH_OPPOSITE — the cancelled prior candidate. */
  cancelled: ArmedCandidate | null;
};

export function buildArmedCandidateId(args: {
  symbol: string;
  direction: "BUY" | "SELL";
  planSourceKey: string | null;
  signalId: string;
  entry: number;
  stopLoss: number;
}): string {
  const key =
    args.planSourceKey?.trim() ||
    `${args.symbol}|${args.direction}|${args.entry}|${args.stopLoss}|${args.signalId}`;
  return `armed_${key.replace(/[^A-Za-z0-9_|.-]/g, "_")}`;
}

/** Existing authoritative confirmation — direction-aware. */
export function isEntryConfirmationReady(args: {
  confirmationRequired: boolean;
  direction: "BUY" | "SELL";
  confirmationState: string | null | undefined;
  candleClassification?: string | null;
}): boolean {
  if (!args.confirmationRequired) return true;
  const auth = resolveAuthoritativeConfirmation({
    confirmationState: args.confirmationState,
    direction: args.direction,
    candleClassification: args.candleClassification ?? null
  });
  return auth.supportsPlan;
}

/** Meaningful anti-confirm / failed confirmation invalidates the thesis. */
export function isConfirmationInvalidating(args: {
  direction: "BUY" | "SELL";
  confirmationState: string | null | undefined;
  candleClassification?: string | null;
}): boolean {
  const auth = resolveAuthoritativeConfirmation({
    confirmationState: args.confirmationState,
    direction: args.direction,
    candleClassification: args.candleClassification ?? null
  });
  if (!auth.meaningful) return false;
  if (auth.state.includes("FAILED") || auth.state.includes("INVALID")) return true;
  return !auth.supportsPlan && auth.meaningful;
}

export function createArmedCandidate(args: {
  uid: string;
  direction: "BUY" | "SELL";
  signalId: string;
  planSourceKey: string | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number | null;
  setupScore: number | null;
  nowIso: string;
}): ArmedCandidate {
  return {
    candidateId: buildArmedCandidateId({
      symbol: "XAUUSD",
      direction: args.direction,
      planSourceKey: args.planSourceKey,
      signalId: args.signalId,
      entry: args.entry,
      stopLoss: args.stopLoss
    }),
    uid: args.uid,
    symbol: "XAUUSD",
    direction: args.direction,
    signalId: args.signalId,
    planSourceKey: args.planSourceKey,
    entry: args.entry,
    stopLoss: args.stopLoss,
    takeProfit: args.takeProfit,
    confidence: args.confidence,
    setupScore: args.setupScore,
    armedAt: args.nowIso,
    updatedAt: args.nowIso,
    status: "ARMED",
    invalidationReason: null,
    executionAttempted: false,
    lastReasonCode: "CANDIDATE_ARMED"
  };
}

export function sameArmedSetup(
  existing: ArmedCandidate,
  next: {
    direction: "BUY" | "SELL";
    planSourceKey: string | null;
    signalId: string;
    entry: number;
    stopLoss: number;
  }
): boolean {
  if (existing.status !== "ARMED") return false;
  if (existing.direction !== next.direction) return false;
  if (existing.candidateId ===
    buildArmedCandidateId({
      symbol: "XAUUSD",
      direction: next.direction,
      planSourceKey: next.planSourceKey,
      signalId: next.signalId,
      entry: next.entry,
      stopLoss: next.stopLoss
    })
  ) {
    return true;
  }
  // Stable across re-evaluations of the same plan window / geometry.
  if (
    existing.planSourceKey &&
    next.planSourceKey &&
    existing.planSourceKey === next.planSourceKey &&
    existing.direction === next.direction
  ) {
    return true;
  }
  if (
    existing.signalId === next.signalId ||
    (existing.entry === next.entry &&
      existing.stopLoss === next.stopLoss &&
      existing.direction === next.direction)
  ) {
    return true;
  }
  return false;
}

export type ArmedLifecycleInput = {
  uid: string;
  nowIso: string;
  autoTradePermitted: boolean;
  autoTradeOffReason?: string | null;
  existing: ArmedCandidate | null;
  /** Fresh BUY/SELL that passed existing deterministic qualification (geometry/confidence/etc). */
  qualifiedSetup: {
    direction: "BUY" | "SELL";
    signalId: string;
    planSourceKey: string | null;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    confidence: number | null;
    setupScore: number | null;
  } | null;
  confirmationRequired: boolean;
  confirmationState: string | null | undefined;
  candleClassification?: string | null;
  /** Optional session-plan validUntil — expired plans invalidate armed candidates. */
  sessionPlanValidUntil?: string | null;
  /** Session / structure hard invalidation of the armed thesis. */
  structurallyInvalid?: boolean;
  structuralReason?: string | null;
};

/**
 * Decide arm / keep / execute-ready / invalidate for one evaluation cycle.
 * Does not place orders and does not bypass risk gates.
 */
export function evaluateArmedCandidateLifecycle(
  input: ArmedLifecycleInput
): ArmedLifecycleResult {
  const existing =
    input.existing && input.existing.status === "ARMED" ? input.existing : null;

  if (
    existing &&
    isArmedCandidateStale({
      armedAt: existing.armedAt,
      nowIso: input.nowIso,
      sessionPlanValidUntil: input.sessionPlanValidUntil
    })
  ) {
    const cancelled: ArmedCandidate = {
      ...existing,
      status: "INVALIDATED",
      invalidationReason: "STALE_OR_EXPIRED_ARMED_CANDIDATE",
      updatedAt: input.nowIso,
      lastReasonCode: "CANDIDATE_INVALIDATED_STALE"
    };
    if (!input.qualifiedSetup) {
      return {
        action: "INVALIDATE",
        candidate: cancelled,
        reasonCode: cancelled.lastReasonCode!,
        cancelled: null
      };
    }
    // A fresh qualified setup on this cycle may replace the stale candidate.
    return armOrReadyFromQualified({
      ...input,
      existing: null,
      priorCancelled: cancelled
    });
  }

  if (!input.autoTradePermitted) {
    if (existing) {
      const cancelled: ArmedCandidate = {
        ...existing,
        status: "INVALIDATED",
        invalidationReason: input.autoTradeOffReason ?? "AUTOTRADE_OFF",
        updatedAt: input.nowIso,
        lastReasonCode: "CANDIDATE_INVALIDATED_AUTOTRADE_OFF"
      };
      return {
        action: "INVALIDATE",
        candidate: cancelled,
        reasonCode: cancelled.lastReasonCode!,
        cancelled: null
      };
    }
    return { action: "NONE", candidate: null, reasonCode: "AUTOTRADE_OFF", cancelled: null };
  }

  if (existing && (input.structurallyInvalid || isConfirmationInvalidating({
    direction: existing.direction,
    confirmationState: input.confirmationState,
    candleClassification: input.candleClassification
  }))) {
    const reason =
      input.structuralReason ??
      (input.structurallyInvalid
        ? "STRUCTURALLY_INVALID"
        : "CONFIRMATION_INVALIDATED_THESIS");
    const cancelled: ArmedCandidate = {
      ...existing,
      status: "INVALIDATED",
      invalidationReason: reason,
      updatedAt: input.nowIso,
      lastReasonCode: "CANDIDATE_INVALIDATED"
    };
    // Opposite qualified setup may still arm below.
    if (
      !input.qualifiedSetup ||
      input.qualifiedSetup.direction === existing.direction
    ) {
      return {
        action: "INVALIDATE",
        candidate: cancelled,
        reasonCode: cancelled.lastReasonCode!,
        cancelled: null
      };
    }
    // Fall through to opposite replace using cancelled as prior.
    return armOrReadyFromQualified({
      ...input,
      existing: null,
      priorCancelled: cancelled
    });
  }

  if (
    existing &&
    input.qualifiedSetup &&
    input.qualifiedSetup.direction !== existing.direction
  ) {
    const cancelled: ArmedCandidate = {
      ...existing,
      status: "INVALIDATED",
      invalidationReason: "OPPOSITE_QUALIFIED_SETUP",
      updatedAt: input.nowIso,
      lastReasonCode: "CANDIDATE_INVALIDATED_OPPOSITE"
    };
    return armOrReadyFromQualified({
      ...input,
      existing: null,
      priorCancelled: cancelled
    });
  }

  if (input.qualifiedSetup) {
    return armOrReadyFromQualified({
      ...input,
      existing,
      priorCancelled: null
    });
  }

  // No fresh qualified BUY/SELL this cycle — keep monitoring armed candidate.
  if (!existing) {
    return { action: "NONE", candidate: null, reasonCode: "NO_CANDIDATE", cancelled: null };
  }

  if (existing.executionAttempted) {
    return {
      action: "KEEP_WAITING",
      candidate: {
        ...existing,
        updatedAt: input.nowIso,
        lastReasonCode: "EXECUTION_ALREADY_ATTEMPTED"
      },
      reasonCode: "EXECUTION_ALREADY_ATTEMPTED",
      cancelled: null
    };
  }

  const ready = isEntryConfirmationReady({
    confirmationRequired: input.confirmationRequired,
    direction: existing.direction,
    confirmationState: input.confirmationState,
    candleClassification: input.candleClassification
  });

  if (ready) {
    const readyCandidate: ArmedCandidate = {
      ...existing,
      updatedAt: input.nowIso,
      lastReasonCode: "ENTRY_CONFIRMATION_RECEIVED"
    };
    return {
      action: "READY_TO_EXECUTE",
      candidate: readyCandidate,
      reasonCode: "ENTRY_CONFIRMATION_RECEIVED",
      cancelled: null
    };
  }

  const waiting: ArmedCandidate = {
    ...existing,
    updatedAt: input.nowIso,
    lastReasonCode: "CANDIDATE_WAITING_CONFIRMATION"
  };
  return {
    action: "KEEP_WAITING",
    candidate: waiting,
    reasonCode: "CANDIDATE_WAITING_CONFIRMATION",
    cancelled: null
  };
}

function armOrReadyFromQualified(
  input: ArmedLifecycleInput & { priorCancelled: ArmedCandidate | null }
): ArmedLifecycleResult {
  const setup = input.qualifiedSetup!;
  const ready = isEntryConfirmationReady({
    confirmationRequired: input.confirmationRequired,
    direction: setup.direction,
    confirmationState: input.confirmationState,
    candleClassification: input.candleClassification
  });

  if (
    input.existing &&
    sameArmedSetup(input.existing, setup) &&
    input.existing.status === "ARMED"
  ) {
    if (input.existing.executionAttempted) {
      return {
        action: "KEEP_WAITING",
        candidate: {
          ...input.existing,
          updatedAt: input.nowIso,
          lastReasonCode: "EXECUTION_ALREADY_ATTEMPTED"
        },
        reasonCode: "EXECUTION_ALREADY_ATTEMPTED",
        cancelled: input.priorCancelled
      };
    }
    if (ready) {
      const c: ArmedCandidate = {
        ...input.existing,
        // Refresh live confidence/score if the same setup re-qualified.
        confidence: setup.confidence ?? input.existing.confidence,
        setupScore: setup.setupScore ?? input.existing.setupScore,
        updatedAt: input.nowIso,
        lastReasonCode: "ENTRY_CONFIRMATION_RECEIVED"
      };
      return {
        action: "READY_TO_EXECUTE",
        candidate: c,
        reasonCode: "ENTRY_CONFIRMATION_RECEIVED",
        cancelled: input.priorCancelled
      };
    }
    const kept: ArmedCandidate = {
      ...input.existing,
      confidence: setup.confidence ?? input.existing.confidence,
      setupScore: setup.setupScore ?? input.existing.setupScore,
      updatedAt: input.nowIso,
      lastReasonCode: "CANDIDATE_WAITING_CONFIRMATION"
    };
    return {
      action: "KEEP_WAITING",
      candidate: kept,
      reasonCode: "CANDIDATE_WAITING_CONFIRMATION",
      cancelled: input.priorCancelled
    };
  }

  const armed = createArmedCandidate({
    uid: input.uid,
    direction: setup.direction,
    signalId: setup.signalId,
    planSourceKey: setup.planSourceKey,
    entry: setup.entry,
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
    confidence: setup.confidence,
    setupScore: setup.setupScore,
    nowIso: input.nowIso
  });

  if (ready) {
    return {
      action: input.priorCancelled ? "REPLACE_WITH_OPPOSITE" : "READY_TO_EXECUTE",
      candidate: {
        ...armed,
        lastReasonCode: "ENTRY_CONFIRMATION_RECEIVED"
      },
      reasonCode: input.priorCancelled
        ? "OPPOSITE_SETUP_READY"
        : "ENTRY_CONFIRMATION_RECEIVED",
      cancelled: input.priorCancelled
    };
  }

  if (input.priorCancelled) {
    return {
      action: "REPLACE_WITH_OPPOSITE",
      candidate: armed,
      reasonCode: "CANDIDATE_ARMED_OPPOSITE",
      cancelled: input.priorCancelled
    };
  }

  return {
    action: "ARM",
    candidate: armed,
    reasonCode: "CANDIDATE_ARMED",
    cancelled: null
  };
}

export function markExecutionAttempted(
  candidate: ArmedCandidate,
  nowIso: string
): ArmedCandidate {
  return {
    ...candidate,
    executionAttempted: true,
    // Remain ARMED in-memory until the store clears after submit — the
    // executionAttempted flag is what suppresses duplicate broker orders.
    status: "ARMED",
    updatedAt: nowIso,
    lastReasonCode: "ORDER_SUBMITTED"
  };
}

export function markExecutionRejectedKeepArmed(
  candidate: ArmedCandidate,
  nowIso: string,
  reasonCode: string
): ArmedCandidate {
  // Risk gate failure must not bypass controls, but also must not spawn duplicates.
  // Keep ARMED with executionAttempted=false so a later clean cycle may retry
  // only when confirmation remains valid — callers set attempted=true for
  // hard "order accepted path started" only.
  return {
    ...candidate,
    status: "ARMED",
    updatedAt: nowIso,
    lastReasonCode: reasonCode
  };
}
