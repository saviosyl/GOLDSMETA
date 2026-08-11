/**
 * Demo Auto readiness row for AutoTrade overview.
 * Mirrors existing backend authority inputs already on the page —
 * does not invent a second source of truth or change execution.
 */

import type { QualificationState } from "./broker/qualificationTypes";

/** Qualification states that may submit Pepperstone Demo orders (never Live). */
const DEMO_ORDER_STATES: QualificationState[] = [
  "CONTROLLED_DEMO_QUALIFICATION",
  "DEMO_AUTO_ENABLED",
  "LIVE_QUALIFICATION"
];

export type DemoAutoPermissionReadiness = {
  ok: boolean;
  pending: boolean;
  label: string;
  detail: string;
};

export function deriveDemoAutoPermissionReadiness(args: {
  /** Live account selected — Live approval path (unchanged messaging). */
  isLiveSelected: boolean;
  /** Demo account connected + masked id present. */
  demoAccountConnected: boolean;
  autoTradeEnabledIntent: boolean | null | undefined;
  autoTradePaused?: boolean | null;
  emergencyStopActive?: boolean | null;
  qualificationState: QualificationState | null | undefined;
  /** From qualification.demoAuto.enabled (LIVE_QUALIFICATION / DEMO_AUTO_ENABLED …). */
  demoAutoEnabled: boolean | null | undefined;
  qualificationNextAction?: string | null;
}): DemoAutoPermissionReadiness {
  if (args.isLiveSelected) {
    return {
      ok: false,
      pending: true,
      label: "Owner/live approval pending",
      detail: "Required for live"
    };
  }

  if (!args.demoAccountConnected) {
    return {
      ok: false,
      pending: true,
      label: "AutoTrade setup incomplete",
      detail: "Connect and select account"
    };
  }

  const state = args.qualificationState ?? null;
  const qualAllowsOrders =
    Boolean(args.demoAutoEnabled) ||
    (state != null && DEMO_ORDER_STATES.includes(state));

  const intentOn = args.autoTradeEnabledIntent === true;
  const paused = Boolean(args.autoTradePaused);
  const emergency = Boolean(args.emergencyStopActive);

  const enabled = intentOn && qualAllowsOrders && !paused && !emergency;

  if (enabled) {
    return {
      ok: true,
      pending: false,
      label: "Demo trading permission / execution requirement",
      detail: "Demo Auto enabled"
    };
  }

  let detail = "Demo Auto not enabled";
  if (emergency) {
    detail = "Emergency stop active";
  } else if (paused) {
    detail = "Demo Auto paused";
  } else if (intentOn && !qualAllowsOrders) {
    detail =
      (args.qualificationNextAction && args.qualificationNextAction.trim()) ||
      (state ? `Qualification: ${state.replace(/_/g, " ")}` : "Demo Auto not enabled");
  } else if (!intentOn) {
    detail = "Demo Auto not enabled";
  }

  return {
    ok: false,
    pending: true,
    label: "Demo trading permission / execution requirement",
    detail
  };
}
