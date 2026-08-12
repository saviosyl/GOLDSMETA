/**
 * Deterministic Demo T1/T2/T3 profit-lock ladder types.
 * Position management only — never invents strategy targets.
 */

export const PROFIT_LOCK_T1_CUMULATIVE_FRACTION = 0.5;
export const PROFIT_LOCK_T2_CUMULATIVE_FRACTION = 0.8;
export const PROFIT_LOCK_T3_CUMULATIVE_FRACTION = 1.0;

/**
 * Immutable per-position management policy.
 * Snapshot at open from demoProfitLockLadderEnabled — never flips mid-trade.
 */
export type PositionManagementPolicy = "LEGACY_V1" | "PROFIT_LOCK_V1";

/**
 * Irreversible lifecycle stages for the Demo profit-lock manager.
 * Pending/reconcile stages require broker-confirmed volume/SL before advance.
 */
export type ProfitLockStage =
  | "OPEN"
  | "T1_TRIGGERED"
  | "T1_CLOSE_SUBMITTING"
  | "T1_CLOSE_PENDING_RECONCILE"
  | "T1_PARTIAL_DONE_SL_PENDING"
  | "BE_AMEND_PENDING_RECONCILE"
  | "T1_SECURED_BE"
  | "T1_CONTINUATION_CONFIRMED"
  | "T1_PROTECT_AMEND_PENDING_RECONCILE"
  | "T1_PROTECTED"
  | "T2_TRIGGERED"
  | "T2_CLOSE_SUBMITTING"
  | "T2_CLOSE_PENDING_RECONCILE"
  | "T2_PARTIAL_DONE"
  | "T2_ENSURE_AMEND_PENDING_RECONCILE"
  | "T2_SECURED"
  | "T2_CONTINUATION_CONFIRMED"
  | "T2_PROTECT_AMEND_PENDING_RECONCILE"
  | "T2_PROTECTED"
  | "T3_TRIGGERED"
  | "T3_CLOSE_SUBMITTING"
  | "T3_CLOSE_PENDING_RECONCILE"
  | "CLOSE_RECONCILIATION_PENDING"
  | "CLOSED";

export type ProfitLockProtectionLevel = "NONE" | "BE" | "TP1" | "TP2";

/** Stage rank — only advance, never regress. */
export const PROFIT_LOCK_STAGE_RANK: Record<ProfitLockStage, number> = {
  OPEN: 0,
  T1_TRIGGERED: 10,
  T1_CLOSE_SUBMITTING: 12,
  T1_CLOSE_PENDING_RECONCILE: 14,
  T1_PARTIAL_DONE_SL_PENDING: 20,
  BE_AMEND_PENDING_RECONCILE: 25,
  T1_SECURED_BE: 30,
  T1_CONTINUATION_CONFIRMED: 40,
  T1_PROTECT_AMEND_PENDING_RECONCILE: 45,
  T1_PROTECTED: 50,
  T2_TRIGGERED: 60,
  T2_CLOSE_SUBMITTING: 62,
  T2_CLOSE_PENDING_RECONCILE: 64,
  T2_PARTIAL_DONE: 70,
  T2_ENSURE_AMEND_PENDING_RECONCILE: 75,
  T2_SECURED: 80,
  T2_CONTINUATION_CONFIRMED: 90,
  T2_PROTECT_AMEND_PENDING_RECONCILE: 95,
  T2_PROTECTED: 100,
  T3_TRIGGERED: 110,
  T3_CLOSE_SUBMITTING: 112,
  T3_CLOSE_PENDING_RECONCILE: 114,
  CLOSE_RECONCILIATION_PENDING: 120,
  CLOSED: 130
};

export const PROFIT_LOCK_PROTECTION_RANK: Record<
  ProfitLockProtectionLevel,
  number
> = {
  NONE: 0,
  BE: 1,
  TP1: 2,
  TP2: 3
};

export function canAdvanceProfitLockStage(
  current: ProfitLockStage | null | undefined,
  next: ProfitLockStage
): boolean {
  if (current == null) return true;
  return PROFIT_LOCK_STAGE_RANK[next] >= PROFIT_LOCK_STAGE_RANK[current];
}

export function maxProtectionLevel(
  a: ProfitLockProtectionLevel,
  b: ProfitLockProtectionLevel
): ProfitLockProtectionLevel {
  return PROFIT_LOCK_PROTECTION_RANK[a] >= PROFIT_LOCK_PROTECTION_RANK[b]
    ? a
    : b;
}

export type PendingCloseIntent = {
  tag: "T1" | "T2" | "T3_REMAINDER";
  desiredCumulativeLots: number;
  requestedLots: number;
  volumeUnits: number;
  submittedAt: string;
  brokerAccepted: boolean | null;
};

export type PendingAmendIntent = {
  kind: "BE" | "TP1_PROTECT" | "TP2_ENSURE" | "TP2_PROTECT";
  stopLoss: number;
  takeProfit: number | null;
  nextStage: ProfitLockStage;
  nextProtection: ProfitLockProtectionLevel;
  submittedAt: string;
  brokerAccepted: boolean | null;
};

/** Persisted profit-lock fields on DemoPositionLifecycle. */
export type DemoProfitLockState = {
  /**
   * Immutable management policy for this position.
   * null/undefined on pre-policy docs → treat as LEGACY_V1.
   */
  managementPolicy: PositionManagementPolicy | null;
  profitLockStage: ProfitLockStage | null;
  /** Broker hard TP (TP3 when PROFIT_LOCK_V1). Never used as strategy TP1. */
  brokerHardTakeProfit: number | null;
  intendedT1CloseLots: number | null;
  intendedT2CloseLots: number | null;
  /** Broker-reconciled cumulative closed lots (original - remaining). */
  cumulativeClosedLots: number | null;
  profitLockProtectionLevel: ProfitLockProtectionLevel;
  /** ISO timestamp when T1 BE became broker-confirmed. */
  t1SecuredAt: string | null;
  /** Latest completed M5 bar time (unix sec) at/before T1 BE confirm — continuation must be newer. */
  t1SecuredAfterM5BarTime: number | null;
  t2SecuredAt: string | null;
  t2SecuredAfterM5BarTime: number | null;
  /** Completed M5 bar open-time that confirmed T1/T2 continuation. */
  t1ContinuationBarTime: number | null;
  t2ContinuationBarTime: number | null;
  pendingClose: PendingCloseIntent | null;
  pendingAmend: PendingAmendIntent | null;
  /** Last skip/blocker for audit (never fabricated fills). */
  profitLockLastBlocker: string | null;
  /**
   * Remaining capital-at-risk distance (entry→SL).
   * At BE this is ~0; at TP1/TP2 protection the stop is in locked-profit territory,
   * so this field alone does not express locked profit — see lockedProfitDistance.
   */
  /** Distance from entry to current SL when SL is on the profit side (null otherwise). */
  lockedProfitDistance: number | null;
};

export function emptyProfitLockState(): DemoProfitLockState {
  return {
    managementPolicy: null,
    profitLockStage: null,
    brokerHardTakeProfit: null,
    intendedT1CloseLots: null,
    intendedT2CloseLots: null,
    cumulativeClosedLots: null,
    profitLockProtectionLevel: "NONE",
    t1SecuredAt: null,
    t1SecuredAfterM5BarTime: null,
    t2SecuredAt: null,
    t2SecuredAfterM5BarTime: null,
    t1ContinuationBarTime: null,
    t2ContinuationBarTime: null,
    pendingClose: null,
    pendingAmend: null,
    profitLockLastBlocker: null,
    lockedProfitDistance: null
  };
}

export function resolveManagementPolicy(
  policy: PositionManagementPolicy | null | undefined
): PositionManagementPolicy {
  return policy === "PROFIT_LOCK_V1" ? "PROFIT_LOCK_V1" : "LEGACY_V1";
}
