/**
 * Internal AutoTrade armed-candidate lifecycle.
 *
 * Pure engine logic only — no UI labels. Retains a previously qualified
 * BUY/SELL setup while waiting for existing 5M entry confirmation, then
 * re-runs normal safety gates before any execution attempt.
 *
 * ACTIVE_DEMO: short armed window (default 3×5M bars). Session-plan
 * NO_VALID_PLAN alone must NOT invalidate — see PLAN_REFRESH_UNAVAILABLE.
 */

import { resolveAuthoritativeConfirmation } from "../../decision/tradePlanGeometry";
import {
  armedWindowMs,
  classifyDemoSetupTier,
  confirmationRequiredForTier,
  DEFAULT_DEMO_OPPORTUNITY_CONFIG,
  hasFastDirectionalConfirmation,
  loadDemoOpportunityConfig,
  type DemoOpportunityConfig,
  type DemoSetupTier
} from "./demoOpportunityEngine";

/** ACTIVE_DEMO short window (default 15m). STRICT legacy callers may pass override. */
export function maxArmedCandidateAgeMs(
  config: DemoOpportunityConfig = loadDemoOpportunityConfig()
): number {
  return armedWindowMs(config);
}

/**
 * Stale / expiry guard — uses candidate.expiresAt when present, else armed window.
 * Session-plan validUntil alone must NOT expire an armed thesis (plan refresh).
 */
export function isArmedCandidateStale(args: {
  armedAt: string;
  nowIso: string;
  expiresAt?: string | null;
  /** @deprecated Ignored for ACTIVE_DEMO — plan refresh must not kill thesis. */
  sessionPlanValidUntil?: string | null;
  maxAgeMs?: number;
}): boolean {
  const armedMs = Date.parse(args.armedAt);
  const nowMs = Date.parse(args.nowIso);
  if (!Number.isFinite(armedMs) || !Number.isFinite(nowMs)) return true;
  if (args.expiresAt) {
    const exp = Date.parse(args.expiresAt);
    if (Number.isFinite(exp) && exp < nowMs) return true;
  }
  const maxAge = args.maxAgeMs ?? maxArmedCandidateAgeMs();
  if (nowMs - armedMs > maxAge) return true;
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
  /** Optional TP ladder (Demo opportunity engine). */
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  confidence: number | null;
  setupScore: number | null;
  /** A+ / A tier at arm time — setup score, not win probability. */
  tier?: DemoSetupTier | null;
  /** Original decision reasons (structural support audit). */
  originalReasons?: string[];
  armedAt: string;
  /** Independent expiry — not tied to session-plan refresh. */
  expiresAt?: string | null;
  invalidationPrice?: number | null;
  updatedAt: string;
  status: ArmedCandidateStatus;
  invalidationReason: string | null;
  /** Prevents duplicate broker submissions across confirmation-true evaluations. */
  executionAttempted: boolean;
  lastReasonCode: string | null;
  /** Last non-fatal plan refresh note (NO_VALID_PLAN). */
  planRefreshNote?: string | null;
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
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  confidence: number | null;
  setupScore: number | null;
  originalReasons?: string[];
  invalidationPrice?: number | null;
  nowIso: string;
  /** Prefer resolved runtime config so DEMO_ARMED_CONFIRMATION_BARS_5M is honoured. */
  opportunityConfig?: DemoOpportunityConfig;
  armedWindowMsOverride?: number;
}): ArmedCandidate {
  const cfg = args.opportunityConfig ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG;
  const windowMs = args.armedWindowMsOverride ?? armedWindowMs(cfg);
  const armedMs = Date.parse(args.nowIso);
  const expiresAt = Number.isFinite(armedMs)
    ? new Date(armedMs + windowMs).toISOString()
    : null;
  const tier = classifyDemoSetupTier(args.setupScore, cfg);
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
    takeProfit2: args.takeProfit2 ?? null,
    takeProfit3: args.takeProfit3 ?? null,
    confidence: args.confidence,
    setupScore: args.setupScore,
    tier,
    originalReasons: args.originalReasons ?? [],
    armedAt: args.nowIso,
    expiresAt,
    invalidationPrice:
      args.invalidationPrice ??
      (args.direction === "BUY" ? args.stopLoss : args.stopLoss),
    updatedAt: args.nowIso,
    status: "ARMED",
    invalidationReason: null,
    executionAttempted: false,
    lastReasonCode: "CANDIDATE_ARMED",
    planRefreshNote: null
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
    takeProfit2?: number | null;
    takeProfit3?: number | null;
    confidence: number | null;
    setupScore: number | null;
    originalReasons?: string[];
  } | null;
  confirmationRequired: boolean;
  confirmationState: string | null | undefined;
  candleClassification?: string | null;
  /** @deprecated Plan validUntil must not kill armed thesis in ACTIVE_DEMO. */
  sessionPlanValidUntil?: string | null;
  /** Hard structural invalidation (price / opposite / expired plan INVALIDATED). */
  structurallyInvalid?: boolean;
  structuralReason?: string | null;
  /**
   * Soft plan refresh (NO_VALID_PLAN / NO_TRADE) — keep armed, annotate only.
   * Must never alone produce INVALIDATE.
   */
  planRefreshUnavailable?: boolean;
  /** Mid price for stop/invalidation breach checks. */
  markPrice?: number | null;
  /**
   * A+ fast path may be considered when true. Actual fast-ready still requires
   * hasFastDirectionalConfirmation (directional evidence, not generic structure).
   */
  allowFastConfirmation?: boolean;
  /** Resolved runtime opportunity config (armed window, tier thresholds). */
  opportunityConfig?: DemoOpportunityConfig;
  /** Decision reasons for A+ fast directional confirmation. */
  decisionReasons?: string[];
};

/**
 * Decide arm / keep / execute-ready / invalidate for one evaluation cycle.
 * Does not place orders and does not bypass risk gates.
 */
export function evaluateArmedCandidateLifecycle(
  input: ArmedLifecycleInput
): ArmedLifecycleResult {
  let existing: ArmedCandidate | null =
    input.existing && input.existing.status === "ARMED" ? input.existing : null;

  // Soft plan refresh — annotate and continue (never alone invalidate).
  if (existing && input.planRefreshUnavailable && !input.structurallyInvalid) {
    existing = {
      ...existing,
      planRefreshNote: "PLAN_REFRESH_UNAVAILABLE",
      updatedAt: input.nowIso,
      lastReasonCode:
        existing.lastReasonCode === "CANDIDATE_ARMED" ||
        existing.lastReasonCode === "CANDIDATE_WAITING_CONFIRMATION"
          ? "PLAN_REFRESH_UNAVAILABLE"
          : existing.lastReasonCode
    };
  }

  // Price breach of invalidation / stop → real invalidator.
  if (
    existing &&
    input.markPrice != null &&
    Number.isFinite(input.markPrice) &&
    existing.invalidationPrice != null
  ) {
    const breached =
      existing.direction === "BUY"
        ? input.markPrice <= existing.invalidationPrice
        : input.markPrice >= existing.invalidationPrice;
    if (breached) {
      const cancelled: ArmedCandidate = {
        ...existing,
        status: "INVALIDATED",
        invalidationReason: "INVALIDATION_PRICE_BREACHED",
        updatedAt: input.nowIso,
        lastReasonCode: "CANDIDATE_INVALIDATED"
      };
      return {
        action: "INVALIDATE",
        candidate: cancelled,
        reasonCode: cancelled.lastReasonCode!,
        cancelled: null
      };
    }
  }

  if (
    existing &&
    isArmedCandidateStale({
      armedAt: existing.armedAt,
      nowIso: input.nowIso,
      expiresAt: existing.expiresAt ?? null
    })
  ) {
    const cancelled: ArmedCandidate = {
      ...existing,
      status: "INVALIDATED",
      invalidationReason: "ARMED_WINDOW_EXPIRED",
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
    const cfg = input.opportunityConfig ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG;
    const oppTier = classifyDemoSetupTier(
      input.qualifiedSetup.setupScore,
      cfg
    );
    // ACTIVE_DEMO: a BELOW opposite setup must not invalidate/replace A/A+.
    if (cfg.mode === "ACTIVE_DEMO" && oppTier === "BELOW") {
      return {
        action: "KEEP_WAITING",
        candidate: {
          ...existing,
          updatedAt: input.nowIso,
          lastReasonCode: "CANDIDATE_WAITING_CONFIRMATION"
        },
        reasonCode: "TIER_BELOW_A_IGNORED",
        cancelled: null
      };
    }
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

  const cfg = input.opportunityConfig ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG;
  const existingTier =
    existing.tier ?? classifyDemoSetupTier(existing.setupScore, cfg);
  const ready = isEntryConfirmationReady({
    confirmationRequired: confirmationRequiredForTier({
      mode: cfg.mode,
      tier: existingTier,
      settingConfirmationRequired: input.confirmationRequired
    }),
    direction: existing.direction,
    confirmationState: input.confirmationState,
    candleClassification: input.candleClassification
  });

  if (ready) {
    const readyCandidate: ArmedCandidate = {
      ...existing,
      tier: existingTier,
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
    tier: existingTier,
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
  const cfg = input.opportunityConfig ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG;
  const tier = classifyDemoSetupTier(setup.setupScore, cfg);

  // ACTIVE_DEMO: BELOW must never arm, replace, or fast-confirm.
  if (cfg.mode === "ACTIVE_DEMO" && tier === "BELOW") {
    if (input.existing && input.existing.status === "ARMED") {
      return {
        action: "KEEP_WAITING",
        candidate: {
          ...input.existing,
          updatedAt: input.nowIso,
          lastReasonCode: "CANDIDATE_WAITING_CONFIRMATION"
        },
        reasonCode: "TIER_BELOW_A_IGNORED",
        cancelled: null
      };
    }
    return {
      action: "NONE",
      candidate: null,
      reasonCode: "TIER_BELOW_A",
      cancelled: input.priorCancelled
    };
  }

  // A+ fast path: requires directional decision evidence — NOT the ordinary
  // confirmationCandleRequired / isEntryConfirmationReady path alone.
  // Explicit opposite confirmation always vetoes fast-ready.
  const fastReady =
    Boolean(input.allowFastConfirmation) &&
    tier === "A_PLUS" &&
    hasFastDirectionalConfirmation({
      direction: setup.direction,
      reasons: setup.originalReasons ?? input.decisionReasons,
      confirmationClassification:
        input.candleClassification ?? input.confirmationState
    });
  // ACTIVE_DEMO A and A+ always require confirmation via this gate.
  // A+ may still become ready immediately through fastReady above when
  // valid directional fast-confirm evidence exists — never via setting=false.
  const confirmationRequired = confirmationRequiredForTier({
    mode: cfg.mode,
    tier,
    settingConfirmationRequired: input.confirmationRequired
  });
  const ready =
    fastReady ||
    isEntryConfirmationReady({
      confirmationRequired,
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
      const reasonCode = fastReady
        ? "FAST_CONFIRMATION_RECEIVED"
        : "ENTRY_CONFIRMATION_RECEIVED";
      const c: ArmedCandidate = {
        ...input.existing,
        // Refresh live confidence/score if the same setup re-qualified.
        // Preserve original TP ladder when re-evaluating the same thesis.
        takeProfit2: input.existing.takeProfit2 ?? setup.takeProfit2 ?? null,
        takeProfit3: input.existing.takeProfit3 ?? setup.takeProfit3 ?? null,
        confidence: setup.confidence ?? input.existing.confidence,
        setupScore: setup.setupScore ?? input.existing.setupScore,
        updatedAt: input.nowIso,
        lastReasonCode: reasonCode
      };
      return {
        action: "READY_TO_EXECUTE",
        candidate: c,
        reasonCode,
        cancelled: input.priorCancelled
      };
    }
    const kept: ArmedCandidate = {
      ...input.existing,
      takeProfit2: input.existing.takeProfit2 ?? setup.takeProfit2 ?? null,
      takeProfit3: input.existing.takeProfit3 ?? setup.takeProfit3 ?? null,
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
    takeProfit2: setup.takeProfit2,
    takeProfit3: setup.takeProfit3,
    confidence: setup.confidence,
    setupScore: setup.setupScore,
    originalReasons: setup.originalReasons,
    nowIso: input.nowIso,
    opportunityConfig: cfg
  });

  if (ready) {
    const reasonCode = fastReady
      ? "FAST_CONFIRMATION_RECEIVED"
      : input.priorCancelled
        ? "OPPOSITE_SETUP_READY"
        : "ENTRY_CONFIRMATION_RECEIVED";
    return {
      action: input.priorCancelled ? "REPLACE_WITH_OPPOSITE" : "READY_TO_EXECUTE",
      candidate: {
        ...armed,
        lastReasonCode: reasonCode
      },
      reasonCode,
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
