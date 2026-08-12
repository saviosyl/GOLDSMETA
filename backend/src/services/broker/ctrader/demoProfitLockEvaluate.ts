/**
 * Pure Demo profit-lock ladder evaluator.
 * Deterministic transitions from stage + broker facts + executable prices/candles.
 * No I/O — safe for exhaustive unit tests.
 */

import {
  canAdvanceProfitLockStage,
  type ProfitLockProtectionLevel,
  type ProfitLockStage
} from "./demoProfitLockTypes";
import {
  brokerHardTakeProfitForAmend,
  computeBrokerSafeStopBuffer,
  proposeProtectedStop,
  selectStopIfImproved,
  type StopBufferInputs
} from "./demoProfitLockStops";
import {
  brokerClosedLots,
  planRemainderClose,
  planT1PartialClose,
  planT2PartialClose,
  type VolumeRulesLots
} from "./demoProfitLockVolume";
import { targetTouched } from "./demoProfitLockTargets";

export type ProfitLockEvalInput = {
  side: "BUY" | "SELL";
  stage: ProfitLockStage;
  protectionLevel: ProfitLockProtectionLevel;
  entry: number | null;
  currentSl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  brokerHardTakeProfit: number | null;
  originalLots: number;
  brokerRemainingLots: number;
  /**
   * Executable close-side price for target touch:
   * BUY → BID, SELL → ASK. Never mid.
   * null → fail closed (do not declare target reached).
   */
  targetTouchPrice: number | null;
  /** True when broker position is absent (already closed). */
  brokerPositionOpen: boolean;
  /**
   * Fresh completed M5 close beyond TP1/TP2 AFTER secured baseline.
   * Caller must ensure bar time > t1SecuredAfterM5BarTime / t2SecuredAfterM5BarTime.
   */
  m5ContinuationBeyondTp1: boolean;
  m5ContinuationBeyondTp2: boolean;
  completedM5BarTime: number | null;
  volumeRules: VolumeRulesLots;
  stopBuffer: StopBufferInputs;
};

export type ProfitLockAction =
  | { type: "NONE"; reason: string }
  | {
      type: "PARTIAL_CLOSE";
      tag: "T1" | "T2" | "T3_REMAINDER";
      lots: number;
      volumeUnits: number;
      desiredCumulativeLots: number;
      submittingStage: ProfitLockStage;
      pendingStage: ProfitLockStage;
      doneStage: ProfitLockStage;
      dedupeKey: string;
    }
  | {
      type: "AMEND_SL";
      stopLoss: number;
      takeProfit: number | undefined;
      pendingStage: ProfitLockStage;
      nextStage: ProfitLockStage;
      nextProtection: ProfitLockProtectionLevel;
      reason: string;
      amendKind: "BE" | "TP1_PROTECT" | "TP2_ENSURE" | "TP2_PROTECT";
      dedupeKey: string;
    }
  | {
      type: "ADVANCE_STAGE";
      nextStage: ProfitLockStage;
      nextProtection?: ProfitLockProtectionLevel;
      reason: string;
      t1ContinuationBarTime?: number | null;
      t2ContinuationBarTime?: number | null;
    }
  | {
      type: "RECONCILE_CLOSED";
      nextStage: "CLOSE_RECONCILIATION_PENDING" | "CLOSED";
      reason: string;
    };

function advance(
  current: ProfitLockStage,
  next: ProfitLockStage
): ProfitLockStage {
  return canAdvanceProfitLockStage(current, next) ? next : current;
}

function maxProt(
  a: ProfitLockProtectionLevel,
  b: ProfitLockProtectionLevel
): ProfitLockProtectionLevel {
  const rank = { NONE: 0, BE: 1, TP1: 2, TP2: 3 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Evaluate one management tick for non-pending stages.
 * Pending SUBMITTING/RECONCILE stages are handled by the manager via broker proof.
 */
export function evaluateProfitLock(input: ProfitLockEvalInput): ProfitLockAction {
  const stage = input.stage;

  if (!input.brokerPositionOpen || input.brokerRemainingLots <= 1e-8) {
    if (stage === "CLOSED") {
      return { type: "NONE", reason: "ALREADY_CLOSED" };
    }
    return {
      type: "RECONCILE_CLOSED",
      nextStage: "CLOSE_RECONCILIATION_PENDING",
      reason: "BROKER_POSITION_FLAT"
    };
  }

  const hardTp = brokerHardTakeProfitForAmend({
    tp3: input.tp3,
    brokerHardTakeProfit: input.brokerHardTakeProfit
  });

  const touch = input.targetTouchPrice;

  // Pending stages: manager reconciles — evaluator idles.
  if (
    stage === "T1_CLOSE_SUBMITTING" ||
    stage === "T1_CLOSE_PENDING_RECONCILE" ||
    stage === "T2_CLOSE_SUBMITTING" ||
    stage === "T2_CLOSE_PENDING_RECONCILE" ||
    stage === "T3_CLOSE_SUBMITTING" ||
    stage === "T3_CLOSE_PENDING_RECONCILE" ||
    stage === "BE_AMEND_PENDING_RECONCILE" ||
    stage === "T1_PROTECT_AMEND_PENDING_RECONCILE" ||
    stage === "T2_ENSURE_AMEND_PENDING_RECONCILE" ||
    stage === "T2_PROTECT_AMEND_PENDING_RECONCILE"
  ) {
    return { type: "NONE", reason: "PENDING_BROKER_RECONCILE" };
  }

  if (
    stage === "T2_PROTECTED" ||
    stage === "T2_CONTINUATION_CONFIRMED" ||
    stage === "T2_SECURED" ||
    stage === "T3_TRIGGERED"
  ) {
    if (
      targetTouched({ side: input.side, touchPrice: touch, level: input.tp3 }) ||
      stage === "T3_TRIGGERED"
    ) {
      if (stage !== "T3_TRIGGERED" && canAdvanceProfitLockStage(stage, "T3_TRIGGERED")) {
        return {
          type: "ADVANCE_STAGE",
          nextStage: "T3_TRIGGERED",
          reason: "TP3_REACHED_EXECUTABLE"
        };
      }
      const rem = planRemainderClose({
        brokerRemainingLots: input.brokerRemainingLots,
        rules: input.volumeRules
      });
      if (rem.kind === "ALREADY_FLAT") {
        return {
          type: "RECONCILE_CLOSED",
          nextStage: "CLOSE_RECONCILIATION_PENDING",
          reason: "BROKER_ALREADY_CLOSED_AT_TP3"
        };
      }
      if (rem.kind === "SKIP_INVALID") {
        return { type: "NONE", reason: rem.reason };
      }
      return {
        type: "PARTIAL_CLOSE",
        tag: "T3_REMAINDER",
        lots: rem.roundedLots,
        volumeUnits: rem.orderVolumeUnits,
        desiredCumulativeLots: input.originalLots,
        submittingStage: "T3_CLOSE_SUBMITTING",
        pendingStage: "T3_CLOSE_PENDING_RECONCILE",
        doneStage: "CLOSE_RECONCILIATION_PENDING",
        dedupeKey: "profit_lock:t3_remainder"
      };
    }
  }

  if (stage === "OPEN") {
    if (touch == null) {
      return { type: "NONE", reason: "EXECUTABLE_TOUCH_PRICE_UNAVAILABLE" };
    }
    if (!targetTouched({ side: input.side, touchPrice: touch, level: input.tp1 })) {
      return { type: "NONE", reason: "WAITING_TP1" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: advance(stage, "T1_TRIGGERED"),
      reason: "TP1_REACHED_EXECUTABLE"
    };
  }

  if (stage === "T1_TRIGGERED") {
    const plan = planT1PartialClose({
      originalLots: input.originalLots,
      brokerRemainingLots: input.brokerRemainingLots,
      rules: input.volumeRules
    });
    if (plan.kind === "ALREADY_SATISFIED") {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T1_PARTIAL_DONE_SL_PENDING",
        reason: "T1_PARTIAL_ALREADY_SATISFIED_BY_BROKER"
      };
    }
    if (plan.kind === "SKIP_INVALID") {
      return { type: "NONE", reason: plan.reason };
    }
    return {
      type: "PARTIAL_CLOSE",
      tag: "T1",
      lots: plan.roundedLots,
      volumeUnits: plan.orderVolumeUnits,
      desiredCumulativeLots: plan.desiredCumulativeLots,
      submittingStage: "T1_CLOSE_SUBMITTING",
      pendingStage: "T1_CLOSE_PENDING_RECONCILE",
      doneStage: "T1_PARTIAL_DONE_SL_PENDING",
      dedupeKey: "profit_lock:t1_partial"
    };
  }

  if (stage === "T1_PARTIAL_DONE_SL_PENDING") {
    if (input.entry == null) {
      return { type: "NONE", reason: "ENTRY_MISSING_FOR_BE" };
    }
    const proposed = selectStopIfImproved({
      side: input.side,
      currentSl: input.currentSl,
      proposedSl: input.entry
    });
    if (proposed == null) {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T1_SECURED_BE",
        nextProtection: "BE",
        reason: "BE_ALREADY_IN_PLACE"
      };
    }
    return {
      type: "AMEND_SL",
      stopLoss: proposed,
      takeProfit: hardTp,
      pendingStage: "BE_AMEND_PENDING_RECONCILE",
      nextStage: "T1_SECURED_BE",
      nextProtection: "BE",
      reason: "MOVE_SL_TO_BREAKEVEN_AFTER_T1",
      amendKind: "BE",
      dedupeKey: `profit_lock:t1_be:${proposed}`
    };
  }

  if (stage === "T1_SECURED_BE") {
    if (!input.m5ContinuationBeyondTp1) {
      return { type: "NONE", reason: "WAITING_T1_CONTINUATION_5M_FRESH" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: "T1_CONTINUATION_CONFIRMED",
      nextProtection: "BE",
      reason: "T1_CONTINUATION_5M_CONFIRMED_FRESH",
      t1ContinuationBarTime: input.completedM5BarTime
    };
  }

  if (stage === "T1_CONTINUATION_CONFIRMED") {
    if (input.tp1 == null) {
      return { type: "NONE", reason: "TP1_MISSING" };
    }
    const buf = computeBrokerSafeStopBuffer({
      ...input.stopBuffer,
      referencePrice: input.tp1
    });
    if (!buf.ok) {
      // Ratchet optional — keep BE, continue monitoring TP2.
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T1_PROTECTED",
        nextProtection: input.protectionLevel, // stay BE; do not claim TP1
        reason: "T1_RATCHET_SKIPPED_KEEP_BE"
      };
    }
    const raw = proposeProtectedStop({
      side: input.side,
      level: input.tp1,
      buffer: buf.buffer
    });
    const proposed = selectStopIfImproved({
      side: input.side,
      currentSl: input.currentSl,
      proposedSl: raw
    });
    if (proposed == null) {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T1_PROTECTED",
        nextProtection: "TP1",
        reason: "T1_PROTECTION_ALREADY_IN_PLACE_OR_WOULD_WEAKEN"
      };
    }
    return {
      type: "AMEND_SL",
      stopLoss: proposed,
      takeProfit: hardTp,
      pendingStage: "T1_PROTECT_AMEND_PENDING_RECONCILE",
      nextStage: "T1_PROTECTED",
      nextProtection: "TP1",
      reason: "PROTECT_AROUND_TP1",
      amendKind: "TP1_PROTECT",
      dedupeKey: `profit_lock:t1_protect:${proposed}`
    };
  }

  if (stage === "T1_PROTECTED") {
    if (touch == null) {
      return { type: "NONE", reason: "EXECUTABLE_TOUCH_PRICE_UNAVAILABLE" };
    }
    if (!targetTouched({ side: input.side, touchPrice: touch, level: input.tp2 })) {
      return { type: "NONE", reason: "WAITING_TP2" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: "T2_TRIGGERED",
      reason: "TP2_REACHED_EXECUTABLE"
    };
  }

  if (stage === "T2_TRIGGERED") {
    const plan = planT2PartialClose({
      originalLots: input.originalLots,
      brokerRemainingLots: input.brokerRemainingLots,
      rules: input.volumeRules
    });
    if (plan.kind === "ALREADY_SATISFIED") {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T2_PARTIAL_DONE",
        reason: "T2_PARTIAL_ALREADY_SATISFIED_BY_BROKER"
      };
    }
    if (plan.kind === "SKIP_INVALID") {
      return { type: "NONE", reason: plan.reason };
    }
    return {
      type: "PARTIAL_CLOSE",
      tag: "T2",
      lots: plan.roundedLots,
      volumeUnits: plan.orderVolumeUnits,
      desiredCumulativeLots: plan.desiredCumulativeLots,
      submittingStage: "T2_CLOSE_SUBMITTING",
      pendingStage: "T2_CLOSE_PENDING_RECONCILE",
      doneStage: "T2_PARTIAL_DONE",
      dedupeKey: "profit_lock:t2_partial"
    };
  }

  if (stage === "T2_PARTIAL_DONE") {
    if (input.tp1 == null) {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T2_SECURED",
        reason: "T2_SECURED_NO_TP1_LEVEL"
      };
    }
    const buf = computeBrokerSafeStopBuffer({
      ...input.stopBuffer,
      referencePrice: input.tp1
    });
    if (!buf.ok) {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T2_SECURED",
        nextProtection: input.protectionLevel,
        reason: "T2_SECURED_KEEP_CURRENT_SL_NO_BUFFER"
      };
    }
    const raw = proposeProtectedStop({
      side: input.side,
      level: input.tp1,
      buffer: buf.buffer
    });
    const proposed = selectStopIfImproved({
      side: input.side,
      currentSl: input.currentSl,
      proposedSl: raw
    });
    if (proposed == null) {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T2_SECURED",
        nextProtection: maxProt(input.protectionLevel, "TP1"),
        reason: "T2_SECURED_TP1_ALREADY_PROTECTED"
      };
    }
    return {
      type: "AMEND_SL",
      stopLoss: proposed,
      takeProfit: hardTp,
      pendingStage: "T2_ENSURE_AMEND_PENDING_RECONCILE",
      nextStage: "T2_SECURED",
      nextProtection: "TP1",
      reason: "ENSURE_TP1_PROTECTION_AFTER_T2",
      amendKind: "TP2_ENSURE",
      dedupeKey: `profit_lock:t2_ensure_tp1:${proposed}`
    };
  }

  if (stage === "T2_SECURED") {
    if (!input.m5ContinuationBeyondTp2) {
      return { type: "NONE", reason: "WAITING_T2_CONTINUATION_5M_FRESH" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: "T2_CONTINUATION_CONFIRMED",
      reason: "T2_CONTINUATION_5M_CONFIRMED_FRESH",
      t2ContinuationBarTime: input.completedM5BarTime
    };
  }

  if (stage === "T2_CONTINUATION_CONFIRMED") {
    if (input.tp2 == null) {
      return { type: "NONE", reason: "TP2_MISSING" };
    }
    const buf = computeBrokerSafeStopBuffer({
      ...input.stopBuffer,
      referencePrice: input.tp2
    });
    if (!buf.ok) {
      // Keep current best SL; continue toward broker hard TP3.
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T2_PROTECTED",
        nextProtection: input.protectionLevel,
        reason: "T2_RATCHET_SKIPPED_KEEP_CURRENT_SL"
      };
    }
    const raw = proposeProtectedStop({
      side: input.side,
      level: input.tp2,
      buffer: buf.buffer
    });
    const proposed = selectStopIfImproved({
      side: input.side,
      currentSl: input.currentSl,
      proposedSl: raw
    });
    if (proposed == null) {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T2_PROTECTED",
        nextProtection: "TP2",
        reason: "T2_PROTECTION_ALREADY_IN_PLACE_OR_WOULD_WEAKEN"
      };
    }
    return {
      type: "AMEND_SL",
      stopLoss: proposed,
      takeProfit: hardTp,
      pendingStage: "T2_PROTECT_AMEND_PENDING_RECONCILE",
      nextStage: "T2_PROTECTED",
      nextProtection: "TP2",
      reason: "PROTECT_AROUND_TP2",
      amendKind: "TP2_PROTECT",
      dedupeKey: `profit_lock:t2_protect:${proposed}`
    };
  }

  if (stage === "T2_PROTECTED") {
    if (touch == null) {
      return { type: "NONE", reason: "EXECUTABLE_TOUCH_PRICE_UNAVAILABLE" };
    }
    if (!targetTouched({ side: input.side, touchPrice: touch, level: input.tp3 })) {
      return { type: "NONE", reason: "WAITING_TP3" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: "T3_TRIGGERED",
      reason: "TP3_REACHED_EXECUTABLE"
    };
  }

  void brokerClosedLots;
  return { type: "NONE", reason: `IDLE_AT_${stage}` };
}

/** Completed M5 close confirms continuation beyond a level. */
export function m5CloseConfirmsContinuation(args: {
  side: "BUY" | "SELL";
  completedClose: number | null;
  level: number | null;
}): boolean {
  if (args.completedClose == null || args.level == null) return false;
  return args.side === "BUY"
    ? args.completedClose > args.level
    : args.completedClose < args.level;
}

const M5_SECONDS = 5 * 60;

/**
 * Continuation candle must be provably AFTER the secure event.
 * A null/missing secure baseline is NOT "any bar is fresh" — fail closed.
 */
export function isFreshPostSecureM5Bar(args: {
  /** Completed M5 bar open time (unix seconds). */
  barTime: number | null;
  /** ISO timestamp when BE/T2 secure was broker-confirmed. */
  securedAt: string | null | undefined;
  securedAfterM5BarTime: number | null;
  alreadyConfirmedBarTime: number | null;
  barPeriodSeconds?: number;
}): boolean {
  if (args.barTime == null) return false;
  const securedMs =
    args.securedAt != null ? Date.parse(args.securedAt) : Number.NaN;
  if (!Number.isFinite(securedMs)) {
    // Missing secure timestamp → cannot prove freshness.
    return false;
  }
  const period = args.barPeriodSeconds ?? M5_SECONDS;
  const barEndMs = (args.barTime + period) * 1000;
  if (!(barEndMs > securedMs)) return false;
  if (
    args.securedAfterM5BarTime != null &&
    !(args.barTime > args.securedAfterM5BarTime)
  ) {
    return false;
  }
  if (
    args.alreadyConfirmedBarTime != null &&
    !(args.barTime > args.alreadyConfirmedBarTime)
  ) {
    return false;
  }
  return true;
}
