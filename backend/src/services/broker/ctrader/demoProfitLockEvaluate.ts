/**
 * Pure Demo profit-lock ladder evaluator.
 * Deterministic transitions from stage + broker facts + price/candles.
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
  /** Mid / executable price for target touch detection. */
  currentPrice: number | null;
  /** True when broker position is absent (already closed). */
  brokerPositionOpen: boolean;
  /** Completed M5 close beyond TP1 in trade direction. */
  m5ContinuationBeyondTp1: boolean;
  m5ContinuationBeyondTp2: boolean;
  completedM5BarTime: number | null;
  t1ContinuationBarTime: number | null;
  t2ContinuationBarTime: number | null;
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
      nextStage: ProfitLockStage;
      dedupeKey: string;
    }
  | {
      type: "AMEND_SL";
      stopLoss: number;
      takeProfit: number | undefined;
      nextStage: ProfitLockStage;
      nextProtection: ProfitLockProtectionLevel;
      reason: string;
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

function priceHit(
  side: "BUY" | "SELL",
  price: number | null,
  level: number | null
): boolean {
  if (price == null || level == null) return false;
  return side === "BUY" ? price >= level : price <= level;
}

function advance(
  current: ProfitLockStage,
  next: ProfitLockStage
): ProfitLockStage {
  return canAdvanceProfitLockStage(current, next) ? next : current;
}

/**
 * Evaluate one management tick. Caller persists + executes returned action.
 */
export function evaluateProfitLock(input: ProfitLockEvalInput): ProfitLockAction {
  const stage = input.stage;
  const cumClosed = brokerClosedLots(
    input.originalLots,
    input.brokerRemainingLots
  );

  // Position already flat at broker — never send another close.
  if (!input.brokerPositionOpen || input.brokerRemainingLots <= 1e-8) {
    if (stage === "CLOSED") {
      return { type: "NONE", reason: "ALREADY_CLOSED" };
    }
    return {
      type: "RECONCILE_CLOSED",
      nextStage:
        stage === "CLOSE_RECONCILIATION_PENDING"
          ? "CLOSE_RECONCILIATION_PENDING"
          : "CLOSE_RECONCILIATION_PENDING",
      reason: "BROKER_POSITION_FLAT"
    };
  }

  const hardTp = brokerHardTakeProfitForAmend({
    tp3: input.tp3,
    brokerHardTakeProfit: input.brokerHardTakeProfit
  });

  // --- T3 path (hard TP or price crossed) ---
  if (
    stage === "T2_PROTECTED" ||
    stage === "T2_CONTINUATION_CONFIRMED" ||
    stage === "T2_SECURED" ||
    stage === "T3_TRIGGERED"
  ) {
    if (priceHit(input.side, input.currentPrice, input.tp3) || stage === "T3_TRIGGERED") {
      if (stage !== "T3_TRIGGERED" && canAdvanceProfitLockStage(stage, "T3_TRIGGERED")) {
        // First observe T3, then close-remainder only if still open.
        return {
          type: "ADVANCE_STAGE",
          nextStage: "T3_TRIGGERED",
          reason: "TP3_REACHED"
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
        nextStage: "CLOSE_RECONCILIATION_PENDING",
        dedupeKey: "profit_lock:t3_remainder"
      };
    }
  }

  // --- OPEN → wait for TP1 ---
  if (stage === "OPEN") {
    if (!priceHit(input.side, input.currentPrice, input.tp1)) {
      return { type: "NONE", reason: "WAITING_TP1" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: advance(stage, "T1_TRIGGERED"),
      reason: "TP1_REACHED"
    };
  }

  // --- T1_TRIGGERED → partial 50% original ---
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
        reason: "T1_PARTIAL_ALREADY_SATISFIED_BY_BROKER",
        nextProtection: input.protectionLevel
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
      nextStage: "T1_PARTIAL_DONE_SL_PENDING",
      dedupeKey: "profit_lock:t1_partial"
    };
  }

  // --- T1 partial done → SL to BE only (never re-partial) ---
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
      // Already at/better than BE — treat as secured.
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
      nextStage: "T1_SECURED_BE",
      nextProtection: "BE",
      reason: "MOVE_SL_TO_BREAKEVEN_AFTER_T1",
      dedupeKey: `profit_lock:t1_be:${proposed}`
    };
  }

  // --- T1 secured BE → wait for completed 5M continuation beyond TP1 ---
  if (stage === "T1_SECURED_BE") {
    if (!input.m5ContinuationBeyondTp1) {
      return { type: "NONE", reason: "WAITING_T1_CONTINUATION_5M" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: "T1_CONTINUATION_CONFIRMED",
      nextProtection: "BE",
      reason: "T1_CONTINUATION_5M_CONFIRMED",
      t1ContinuationBarTime: input.completedM5BarTime
    };
  }

  // --- T1 continuation → protect around TP1 ---
  if (stage === "T1_CONTINUATION_CONFIRMED") {
    if (input.tp1 == null) {
      return { type: "NONE", reason: "TP1_MISSING" };
    }
    const buffer = computeBrokerSafeStopBuffer(input.stopBuffer);
    if (buffer == null) {
      return { type: "NONE", reason: "STOP_BUFFER_UNAVAILABLE_KEEP_BE" };
    }
    const raw = proposeProtectedStop({
      side: input.side,
      level: input.tp1,
      buffer
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
      nextStage: "T1_PROTECTED",
      nextProtection: "TP1",
      reason: "PROTECT_AROUND_TP1",
      dedupeKey: `profit_lock:t1_protect:${proposed}`
    };
  }

  // --- T1_PROTECTED → wait TP2 ---
  if (stage === "T1_PROTECTED") {
    if (!priceHit(input.side, input.currentPrice, input.tp2)) {
      return { type: "NONE", reason: "WAITING_TP2" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: "T2_TRIGGERED",
      reason: "TP2_REACHED"
    };
  }

  // --- T2_TRIGGERED → partial to 80% cumulative original ---
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
      nextStage: "T2_PARTIAL_DONE",
      dedupeKey: "profit_lock:t2_partial"
    };
  }

  // --- T2 partial done → ensure SL at least around TP1, then secured ---
  if (stage === "T2_PARTIAL_DONE") {
    if (input.tp1 == null) {
      return {
        type: "ADVANCE_STAGE",
        nextStage: "T2_SECURED",
        reason: "T2_SECURED_NO_TP1_LEVEL"
      };
    }
    const buffer = computeBrokerSafeStopBuffer(input.stopBuffer);
    if (buffer == null) {
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
      buffer
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
      nextStage: "T2_SECURED",
      nextProtection: "TP1",
      reason: "ENSURE_TP1_PROTECTION_AFTER_T2",
      dedupeKey: `profit_lock:t2_ensure_tp1:${proposed}`
    };
  }

  // --- T2 secured → wait 5M continuation beyond TP2 ---
  if (stage === "T2_SECURED") {
    if (!input.m5ContinuationBeyondTp2) {
      return { type: "NONE", reason: "WAITING_T2_CONTINUATION_5M" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: "T2_CONTINUATION_CONFIRMED",
      reason: "T2_CONTINUATION_5M_CONFIRMED",
      t2ContinuationBarTime: input.completedM5BarTime
    };
  }

  // --- T2 continuation → protect around TP2 ---
  if (stage === "T2_CONTINUATION_CONFIRMED") {
    if (input.tp2 == null) {
      return { type: "NONE", reason: "TP2_MISSING" };
    }
    const buffer = computeBrokerSafeStopBuffer(input.stopBuffer);
    if (buffer == null) {
      return { type: "NONE", reason: "STOP_BUFFER_UNAVAILABLE_KEEP_TP1" };
    }
    const raw = proposeProtectedStop({
      side: input.side,
      level: input.tp2,
      buffer
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
      nextStage: "T2_PROTECTED",
      nextProtection: "TP2",
      reason: "PROTECT_AROUND_TP2",
      dedupeKey: `profit_lock:t2_protect:${proposed}`
    };
  }

  if (stage === "T2_PROTECTED") {
    if (!priceHit(input.side, input.currentPrice, input.tp3)) {
      return { type: "NONE", reason: "WAITING_TP3" };
    }
    return {
      type: "ADVANCE_STAGE",
      nextStage: "T3_TRIGGERED",
      reason: "TP3_REACHED"
    };
  }

  void cumClosed;
  return { type: "NONE", reason: `IDLE_AT_${stage}` };
}

function maxProt(
  a: ProfitLockProtectionLevel,
  b: ProfitLockProtectionLevel
): ProfitLockProtectionLevel {
  const rank = { NONE: 0, BE: 1, TP1: 2, TP2: 3 } as const;
  return rank[a] >= rank[b] ? a : b;
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
