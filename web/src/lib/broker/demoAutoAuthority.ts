/** Mirrors backend DemoAutoAuthorityApi — single source of truth for Demo Auto UI. */

import type { QualificationState } from "./qualificationTypes";

export type DemoAutoAuthorityApi = {
  /** A) Owner Demo Auto ENABLED */
  enabled: boolean;
  label: "ON" | "OFF" | "PAUSED" | "LOCKED_LIVE";
  reasons: string[];
  qualificationState: QualificationState | null;
  intentEnabled: boolean;
  paused: boolean;
  emergencyStop: boolean;
  demoSubmissionFlag: boolean;
  selectedDemoAccount: string | null;
  tradingScope: "accounts" | "trading" | null;
  quoteHealthy: boolean;
  /** B) Submission AUTHORIZED (enabled + Demo + trading OAuth) */
  submissionAuthorized?: boolean;
  /** C) Execution ELIGIBLE NOW (authorized + quote/market) */
  executionEligible: boolean;
  /** Human label for C */
  executionNowLabel?: string;
  authorityLabel: "DEMO_AUTO" | "DEMO_AUTO_PAUSED" | "DEMO_AUTO_LOCKED_LIVE" | "OFF";
  startedAt: string | null;
  demoAutoEnabledAt: string | null;
  quoteAgeSeconds: number | null;
  quoteExecutable: boolean | null;
  marketStatus: string | null;
};

export function demoAutoLabelFromAuthority(
  authority: DemoAutoAuthorityApi | null | undefined
): "ON" | "OFF" | "PAUSED" | "LOCKED" {
  if (!authority) return "OFF";
  if (authority.label === "LOCKED_LIVE") return "LOCKED";
  if (authority.label === "PAUSED") return "PAUSED";
  if (authority.enabled) return "ON";
  return "OFF";
}
