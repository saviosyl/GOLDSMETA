/**
 * Single authority helper for Pepperstone Demo Auto execution permission.
 *
 * Legacy autoTradeRiskState.mode (OFF/SHADOW/…) must not silently disagree with
 * qualification + autotradeSettings/demo for whether Demo orders may submit.
 */

import { allowsDemoOrderSubmission } from "./qualificationMachine";
import type { QualificationState } from "./qualificationTypes";

export type DemoAutoExecutionAuthorityInput = {
  qualificationState: QualificationState | string | null | undefined;
  autoTradeEnabledIntent: boolean;
  autoTradePaused: boolean;
  emergencyStopActive: boolean;
  selectedAccountIsLive: boolean;
  /** Runtime Demo submission flag (CTRADER_DEMO_ORDER_SUBMISSION_ENABLED). */
  demoOrderSubmissionEnabled: boolean;
};

export type DemoAutoExecutionAuthority = {
  /** True when the Pepperstone Demo Auto path may submit an order. */
  demoExecutionEnabled: boolean;
  /** Stable label for API/status surfaces (not the legacy risk.mode). */
  authorityLabel: "DEMO_AUTO" | "DEMO_AUTO_PAUSED" | "DEMO_AUTO_LOCKED_LIVE" | "OFF";
  reasons: string[];
};

export function evaluateDemoAutoExecutionAuthority(
  input: DemoAutoExecutionAuthorityInput
): DemoAutoExecutionAuthority {
  const reasons: string[] = [];
  const state = (input.qualificationState ?? null) as QualificationState | null;

  if (input.selectedAccountIsLive) {
    return {
      demoExecutionEnabled: false,
      authorityLabel: "DEMO_AUTO_LOCKED_LIVE",
      reasons: ["SELECTED_ACCOUNT_IS_LIVE"]
    };
  }
  if (input.emergencyStopActive) {
    reasons.push("EMERGENCY_STOP");
  }
  if (input.autoTradePaused) {
    reasons.push("AUTOTRADE_PAUSED");
  }
  if (!input.autoTradeEnabledIntent) {
    reasons.push("INTENT_OFF");
  }
  if (!input.demoOrderSubmissionEnabled) {
    reasons.push("DEMO_SUBMISSION_FLAG_OFF");
  }
  if (!state || !allowsDemoOrderSubmission(state)) {
    reasons.push("QUALIFICATION_STATE_BLOCKS_ORDERS");
  }

  const demoExecutionEnabled =
    !input.selectedAccountIsLive &&
    !input.emergencyStopActive &&
    !input.autoTradePaused &&
    input.autoTradeEnabledIntent &&
    input.demoOrderSubmissionEnabled &&
    Boolean(state && allowsDemoOrderSubmission(state));

  let authorityLabel: DemoAutoExecutionAuthority["authorityLabel"] = "OFF";
  if (input.selectedAccountIsLive) authorityLabel = "DEMO_AUTO_LOCKED_LIVE";
  else if (demoExecutionEnabled) authorityLabel = "DEMO_AUTO";
  else if (
    input.autoTradeEnabledIntent &&
    state &&
    allowsDemoOrderSubmission(state) &&
    input.autoTradePaused
  ) {
    authorityLabel = "DEMO_AUTO_PAUSED";
  }

  return { demoExecutionEnabled, authorityLabel, reasons };
}

/**
 * Detect silent disagreement between legacy risk mode and Demo Auto authority.
 * Used in tests and diagnostics — does not change either store by itself.
 */
export function demoAutoAuthorityConflictsWithLegacyMode(args: {
  legacyMode: string | null | undefined;
  authority: DemoAutoExecutionAuthority;
}): boolean {
  const legacy = String(args.legacyMode ?? "OFF").toUpperCase();
  if (args.authority.demoExecutionEnabled && legacy === "OFF") return true;
  if (!args.authority.demoExecutionEnabled && (legacy === "DEMO" || legacy === "LIVE")) {
    return true;
  }
  return false;
}
