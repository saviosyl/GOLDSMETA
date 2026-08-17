/**
 * Durable FAST execution claim keyed by signal identity + clientOrderId.
 * Prevents a second NewOrderReq for the same signal after an unknown outcome.
 */

import { createHash } from "crypto";

export type FastExecutionClaimState =
  | "RESERVED"
  | "SUBMITTING"
  | "BROKER_SUBMITTED"
  | "BROKER_REJECTED"
  | "BROKER_SUBMIT_ERROR"
  | "BROKER_OUTCOME_UNKNOWN"
  | "BROKER_TIMEOUT_RECONCILED_FILLED"
  | "BROKER_TIMEOUT_RECONCILED_NOT_FOUND";

export type FastExecutionClaim = {
  ownerUid: string;
  signalId: string;
  clientOrderId: string;
  state: FastExecutionClaimState;
  requestSent: boolean;
  newOrderReqCount: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

const memory = new Map<string, FastExecutionClaim>();

function keyOf(ownerUid: string, signalId: string): string {
  return `${ownerUid}::${signalId}`;
}

export function generateFastClientOrderId(signalId: string): string {
  const compact = String(signalId || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 40);
  if (compact.length >= 8) return `fa_${compact}`.slice(0, 50);
  const hash = createHash("sha1")
    .update(String(signalId || "unknown"))
    .digest("hex")
    .slice(0, 16);
  return `fa_${hash}`.slice(0, 50);
}

export function blocksAutomaticResubmit(claim: FastExecutionClaim | null): boolean {
  if (!claim) return false;
  if (claim.state === "BROKER_OUTCOME_UNKNOWN") return true;
  if (claim.state === "SUBMITTING" && claim.requestSent) return true;
  if (claim.state === "BROKER_SUBMITTED") return true;
  if (claim.state === "BROKER_TIMEOUT_RECONCILED_FILLED") return true;
  if (claim.state === "RESERVED" && claim.requestSent) return true;
  return false;
}

export function getFastExecutionClaim(
  ownerUid: string,
  signalId: string
): FastExecutionClaim | null {
  return memory.get(keyOf(ownerUid, signalId)) ?? null;
}

export function reserveFastExecutionClaim(args: {
  ownerUid: string;
  signalId: string;
  clientOrderId: string;
  nowIso?: string;
}):
  | { ok: true; claim: FastExecutionClaim }
  | { ok: false; claim: FastExecutionClaim; reason: "ALREADY_CLAIMED" } {
  const existing = getFastExecutionClaim(args.ownerUid, args.signalId);
  if (existing && blocksAutomaticResubmit(existing)) {
    return { ok: false, claim: existing, reason: "ALREADY_CLAIMED" };
  }
  const now = args.nowIso ?? new Date().toISOString();
  const claim: FastExecutionClaim = {
    ownerUid: args.ownerUid,
    signalId: args.signalId,
    clientOrderId: existing?.clientOrderId || args.clientOrderId,
    state: "RESERVED",
    requestSent: existing?.requestSent ?? false,
    newOrderReqCount: existing?.newOrderReqCount ?? 0,
    errorCode: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  memory.set(keyOf(args.ownerUid, args.signalId), claim);
  return { ok: true, claim };
}

export function updateFastExecutionClaim(
  ownerUid: string,
  signalId: string,
  patch: Partial<
    Pick<
      FastExecutionClaim,
      "state" | "requestSent" | "newOrderReqCount" | "errorCode" | "clientOrderId"
    >
  >
): FastExecutionClaim | null {
  const existing = getFastExecutionClaim(ownerUid, signalId);
  if (!existing) return null;
  const next: FastExecutionClaim = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  memory.set(keyOf(ownerUid, signalId), next);
  return next;
}

export function resetFastExecutionClaimsForTests(): void {
  memory.clear();
}
