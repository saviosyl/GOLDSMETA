/**
 * T212 Practice order intent state machine + idempotency helpers.
 */

import { createHash } from "crypto";
import type { T212Environment, T212ProxyAction } from "./types";

export type T212AutomationMode =
  | "MANUAL"
  | "CONFIRM"
  | "PRACTICE_AUTO"
  | "LIVE_LOCKED"
  | "OFF";

export type T212OrderIntentState =
  | "PREPARED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "FILLED"
  | "PARTIALLY_FILLED"
  | "REJECTED"
  | "UNKNOWN"
  | "CANCELLED";

export const T212_UNRESOLVED_INTENT_STATES: T212OrderIntentState[] = [
  "PREPARED",
  "SUBMITTING",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "PARTIALLY_FILLED",
  "UNKNOWN"
];

export interface T212OrderIntent {
  intentId: string;
  intentKey: string;
  userId: string;
  broker: "T212_INVEST";
  environment: T212Environment;
  decisionId: string;
  proposalId: string | null;
  ticker: string;
  instrumentId: string;
  action: T212ProxyAction;
  side: "BUY" | "SELL";
  quantity: number;
  signedQuantity: number;
  estimatedValue: number | null;
  indicativePrice: number | null;
  requestFingerprint: string;
  state: T212OrderIntentState;
  brokerOrderId: string | null;
  brokerStatus: string | null;
  filledQuantity: number | null;
  averageFillPrice: number | null;
  rejectionReason: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  submittedAt: string | null;
  lastReconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
  dryRunOnly: boolean;
  riskEvaluation: Record<string, unknown>;
}

export function buildT212IntentKey(args: {
  userId: string;
  broker?: "T212_INVEST";
  environment: T212Environment;
  decisionId: string;
  ticker: string;
  action: T212ProxyAction;
}): string {
  const material = [
    args.userId,
    args.broker ?? "T212_INVEST",
    args.environment,
    args.decisionId,
    args.ticker,
    args.action
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export function intentIdFromKey(intentKey: string): string {
  return `t212i_${createHash("sha256").update(intentKey).digest("hex").slice(0, 28)}`;
}

export function buildRequestFingerprint(args: {
  intentKey: string;
  ticker: string;
  signedQuantity: number;
  environment: T212Environment;
  decisionId: string;
}): string {
  const material = [
    args.intentKey,
    args.ticker,
    String(args.signedQuantity),
    args.environment,
    args.decisionId
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export function isUnresolvedIntentState(state: T212OrderIntentState): boolean {
  return T212_UNRESOLVED_INTENT_STATES.includes(state);
}

export function mapBrokerOrderStatusToIntentState(
  brokerStatus: string | null | undefined
): T212OrderIntentState | null {
  if (!brokerStatus) return null;
  const s = brokerStatus.toUpperCase();
  if (s === "NEW" || s === "PENDING" || s === "WORKING") return "SUBMITTED";
  if (s === "CONFIRMED" || s === "ACKNOWLEDGED") return "ACKNOWLEDGED";
  if (s === "FILLED" || s === "COMPLETED") return "FILLED";
  if (s === "PARTIALLY_FILLED" || s === "PARTIAL") return "PARTIALLY_FILLED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "REJECTED" || s === "FAILED") return "REJECTED";
  return null;
}

/** Practice risk limits for order automation (server authoritative). */
export const PRACTICE_ORDER_RISK_LIMITS = {
  maxOrderValueEur: 50,
  maxOpenEglnPositions: 1,
  maxSubmittedOrdersPerDay: 3,
  minConfidence: 80,
  maxSignalAgeSeconds: 90,
  priceSafetyBufferPct: 0.02,
  maxAccountDataAgeSeconds: 60,
  maxPositionDataAgeSeconds: 60,
  requireConfirmedCandle: true,
  currency: "EUR" as const,
  ticker: "EGLNl_EQ"
};

export interface PracticeAutoQualificationState {
  userId: string;
  authHealthy: boolean;
  pinnedOwnerVerified: boolean;
  completedDryRunDecisions: number;
  successfulControlledPracticeOrders: number;
  firstPracticeOrderAt: string | null;
  unresolvedUnknownOrders: number;
  duplicateOrdersDetected: number;
  emergencyStopTested: boolean;
  restartRecoveryTested: boolean;
  eglnConfirmed: boolean;
  ownerUnlockedPracticeAuto: boolean;
  updatedAt: string;
}

export const PRACTICE_AUTO_GATES = {
  requiredDryRuns: 20,
  requiredSuccessfulPracticeOrders: 5,
  requiredCalendarDaysSinceFirstOrder: 7
} as const;
