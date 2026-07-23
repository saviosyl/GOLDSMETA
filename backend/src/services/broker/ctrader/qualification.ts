/**
 * DEMO_AUTO qualification gates — locked; do not reduce.
 */

export interface DemoAutoQualificationState {
  authHealthy: boolean;
  pinnedOwnerVerified: boolean;
  oauthHealthy: boolean;
  pepperstoneDemoConfirmed: boolean;
  xauusdMetadataComplete: boolean;
  completedPreviews: number;
  approvedControlledDemoTrades: number;
  firstDemoTradeAt: string | null;
  unresolvedUnknownOrders: number;
  duplicateOrders: number;
  restartRecoveryTested: boolean;
  emergencyStopTested: boolean;
  dailyLossLockTested: boolean;
  ownerUnlockedDemoAuto: boolean;
}

export interface DemoAutoQualificationResult {
  unlocked: boolean;
  canActivate: false;
  passed: string[];
  failed: string[];
  progress: {
    completedPreviews: number;
    requiredPreviews: 20;
    approvedControlledDemoTrades: number;
    requiredTrades: 5;
    daysSinceFirstTrade: number | null;
    requiredDays: 7;
  };
}

export const DEMO_AUTO_GATES = {
  requiredPreviews: 20,
  requiredTrades: 5,
  requiredDays: 7
} as const;

export function evaluateDemoAutoQualification(
  state: DemoAutoQualificationState,
  now: Date = new Date()
): DemoAutoQualificationResult {
  const passed: string[] = [];
  const failed: string[] = [];
  const check = (ok: boolean, name: string) => {
    if (ok) passed.push(name);
    else failed.push(name);
  };

  check(state.authHealthy, "AUTH_HEALTHY");
  check(state.pinnedOwnerVerified, "PINNED_OWNER_VERIFIED");
  check(state.oauthHealthy, "OAUTH_HEALTHY");
  check(state.pepperstoneDemoConfirmed, "PEPPERSTONE_DEMO_CONFIRMED");
  check(state.xauusdMetadataComplete, "XAUUSD_METADATA_COMPLETE");
  check(state.completedPreviews >= DEMO_AUTO_GATES.requiredPreviews, "PREVIEWS_20");
  check(
    state.approvedControlledDemoTrades >= DEMO_AUTO_GATES.requiredTrades,
    "CONTROLLED_TRADES_5"
  );

  let daysSinceFirstTrade: number | null = null;
  if (state.firstDemoTradeAt) {
    const t = Date.parse(state.firstDemoTradeAt);
    if (!Number.isNaN(t)) {
      daysSinceFirstTrade = Math.floor((now.getTime() - t) / 86_400_000);
    }
  }
  check(
    daysSinceFirstTrade != null && daysSinceFirstTrade >= DEMO_AUTO_GATES.requiredDays,
    "SEVEN_DAYS_SINCE_FIRST_TRADE"
  );
  check(state.unresolvedUnknownOrders === 0, "ZERO_UNKNOWN_ORDERS");
  check(state.duplicateOrders === 0, "ZERO_DUPLICATE_ORDERS");
  check(state.restartRecoveryTested, "RESTART_RECOVERY_TESTED");
  check(state.emergencyStopTested, "EMERGENCY_STOP_TESTED");
  check(state.dailyLossLockTested, "DAILY_LOSS_LOCK_TESTED");
  check(state.ownerUnlockedDemoAuto, "OWNER_UNLOCKED_DEMO_AUTO");

  return {
    unlocked: failed.length === 0,
    canActivate: false, // impossible to activate in this phase
    passed,
    failed,
    progress: {
      completedPreviews: state.completedPreviews,
      requiredPreviews: DEMO_AUTO_GATES.requiredPreviews,
      approvedControlledDemoTrades: state.approvedControlledDemoTrades,
      requiredTrades: DEMO_AUTO_GATES.requiredTrades,
      daysSinceFirstTrade,
      requiredDays: DEMO_AUTO_GATES.requiredDays
    }
  };
}
