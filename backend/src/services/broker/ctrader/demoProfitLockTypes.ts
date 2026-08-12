/**
 * Deterministic Demo T1/T2/T3 profit-lock ladder types.
 * Position management only — never invents strategy targets.
 */

export const PROFIT_LOCK_T1_CUMULATIVE_FRACTION = 0.5;
export const PROFIT_LOCK_T2_CUMULATIVE_FRACTION = 0.8;
export const PROFIT_LOCK_T3_CUMULATIVE_FRACTION = 1.0;

/**
 * Irreversible lifecycle stages for the Demo profit-lock manager.
 * Names are explicit so repeated tp1Hit evaluations cannot re-fire partials.
 */
export type ProfitLockStage =
  | "OPEN"
  | "T1_TRIGGERED"
  | "T1_PARTIAL_DONE_SL_PENDING"
  | "T1_SECURED_BE"
  | "T1_CONTINUATION_CONFIRMED"
  | "T1_PROTECTED"
  | "T2_TRIGGERED"
  | "T2_PARTIAL_DONE"
  | "T2_SECURED"
  | "T2_CONTINUATION_CONFIRMED"
  | "T2_PROTECTED"
  | "T3_TRIGGERED"
  | "CLOSE_RECONCILIATION_PENDING"
  | "CLOSED";

export type ProfitLockProtectionLevel = "NONE" | "BE" | "TP1" | "TP2";

/** Stage rank — only advance, never regress. */
export const PROFIT_LOCK_STAGE_RANK: Record<ProfitLockStage, number> = {
  OPEN: 0,
  T1_TRIGGERED: 10,
  T1_PARTIAL_DONE_SL_PENDING: 20,
  T1_SECURED_BE: 30,
  T1_CONTINUATION_CONFIRMED: 40,
  T1_PROTECTED: 50,
  T2_TRIGGERED: 60,
  T2_PARTIAL_DONE: 70,
  T2_SECURED: 80,
  T2_CONTINUATION_CONFIRMED: 90,
  T2_PROTECTED: 100,
  T3_TRIGGERED: 110,
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

/** Persisted profit-lock fields on DemoPositionLifecycle. */
export type DemoProfitLockState = {
  profitLockStage: ProfitLockStage | null;
  /** Strategy TP3 mirrored as broker hard TP when ladder is active. */
  brokerHardTakeProfit: number | null;
  intendedT1CloseLots: number | null;
  intendedT2CloseLots: number | null;
  /** Broker-reconciled cumulative closed lots (original - remaining). */
  cumulativeClosedLots: number | null;
  profitLockProtectionLevel: ProfitLockProtectionLevel;
  /** Completed M5 bar open-time (unix seconds) that confirmed T1 continuation. */
  t1ContinuationBarTime: number | null;
  t2ContinuationBarTime: number | null;
  /** Last skip/blocker for audit (never fabricated fills). */
  profitLockLastBlocker: string | null;
};

export function emptyProfitLockState(): DemoProfitLockState {
  return {
    profitLockStage: null,
    brokerHardTakeProfit: null,
    intendedT1CloseLots: null,
    intendedT2CloseLots: null,
    cumulativeClosedLots: null,
    profitLockProtectionLevel: "NONE",
    t1ContinuationBarTime: null,
    t2ContinuationBarTime: null,
    profitLockLastBlocker: null
  };
}
