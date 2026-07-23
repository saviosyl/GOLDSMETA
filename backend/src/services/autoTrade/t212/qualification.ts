/**
 * PRACTICE_AUTO qualification gates — do not reduce.
 */

import {
  PRACTICE_AUTO_GATES,
  type PracticeAutoQualificationState
} from "./orderIntent";

export interface QualificationGateResult {
  locked: boolean;
  unlocked: boolean;
  failedGates: string[];
  passedGates: string[];
  state: PracticeAutoQualificationState;
}

export function evaluatePracticeAutoQualification(
  state: PracticeAutoQualificationState,
  now: Date = new Date()
): QualificationGateResult {
  const failed: string[] = [];
  const passed: string[] = [];

  const check = (ok: boolean, code: string) => {
    if (ok) passed.push(code);
    else failed.push(code);
  };

  check(state.authHealthy, "AUTH_HEALTHY");
  check(state.pinnedOwnerVerified, "PINNED_OWNER_VERIFIED");
  check(
    state.completedDryRunDecisions >= PRACTICE_AUTO_GATES.requiredDryRuns,
    "DRY_RUNS_20"
  );
  check(
    state.successfulControlledPracticeOrders >=
      PRACTICE_AUTO_GATES.requiredSuccessfulPracticeOrders,
    "PRACTICE_ORDERS_5"
  );

  let daysOk = false;
  if (state.firstPracticeOrderAt) {
    const first = Date.parse(state.firstPracticeOrderAt);
    if (!Number.isNaN(first)) {
      const days = (now.getTime() - first) / (24 * 60 * 60 * 1000);
      daysOk = days >= PRACTICE_AUTO_GATES.requiredCalendarDaysSinceFirstOrder;
    }
  }
  check(daysOk, "CALENDAR_DAYS_7");
  check(state.unresolvedUnknownOrders === 0, "ZERO_UNKNOWN");
  check(state.duplicateOrdersDetected === 0, "ZERO_DUPLICATES");
  check(state.emergencyStopTested, "EMERGENCY_STOP_TESTED");
  check(state.restartRecoveryTested, "RESTART_RECOVERY_TESTED");
  check(state.eglnConfirmed, "EGLN_CONFIRMED");
  check(state.ownerUnlockedPracticeAuto, "OWNER_UNLOCK");

  const unlocked = failed.length === 0;
  return {
    locked: !unlocked,
    unlocked,
    failedGates: failed,
    passedGates: passed,
    state
  };
}

export function defaultQualificationState(
  userId: string,
  nowIso: string
): PracticeAutoQualificationState {
  return {
    userId,
    authHealthy: false,
    pinnedOwnerVerified: false,
    completedDryRunDecisions: 0,
    successfulControlledPracticeOrders: 0,
    firstPracticeOrderAt: null,
    unresolvedUnknownOrders: 0,
    duplicateOrdersDetected: 0,
    emergencyStopTested: false,
    restartRecoveryTested: false,
    eglnConfirmed: false,
    ownerUnlockedPracticeAuto: false,
    updatedAt: nowIso
  };
}
