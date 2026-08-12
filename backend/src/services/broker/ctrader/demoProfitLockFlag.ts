/**
 * Demo-only feature flag for the T1/T2/T3 profit-lock ladder.
 * Default FALSE — never silently activate in production.
 */

import type { UserAutoTradeSettings } from "./userAutoTradeSettings";

export function isDemoProfitLockLadderEnabled(
  settings: Pick<
    UserAutoTradeSettings,
    "environment" | "demoProfitLockLadderEnabled"
  >
): boolean {
  return (
    settings.environment === "demo" &&
    settings.demoProfitLockLadderEnabled === true
  );
}
