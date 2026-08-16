/**
 * Durable Gold Hunter signal claim — acquire BEFORE broker submission.
 * Same signalId → at most one broker submission across retries/restarts.
 */
import { getFirestoreDb } from "../firebaseAdmin";
import { GH_ADMIN_STRATEGY_ID } from "./types";

export type GoldHunterClaimState =
  | "CANDIDATE_SELECTED"
  | "CLAIMED"
  | "SUBMITTING"
  | "ACCEPTED"
  | "OPEN"
  | "BROKER_REJECTED"
  | "BROKER_SUBMIT_ERROR"
  | "PENDING_RECONCILIATION"
  | "CLOSED";

export type GoldHunterSignalClaim = {
  signalId: string;
  strategy: typeof GH_ADMIN_STRATEGY_ID;
  environment: "DEMO";
  ownerUid: string;
  state: GoldHunterClaimState;
  goldHunterTradeId: string | null;
  clientOrderId: string | null;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  setup: "A" | "B" | "C" | null;
  side: "BUY" | "SELL" | null;
};

const memoryClaims = new Map<string, Map<string, GoldHunterSignalClaim>>();

export function resetGoldHunterSignalClaimsForTests(): void {
  memoryClaims.clear();
}

function claimCol(ownerUid: string) {
  const db = getFirestoreDb();
  if (!db) return null;
  return db.collection("users").doc(ownerUid).collection("goldHunterSignalClaims");
}

function memMap(ownerUid: string): Map<string, GoldHunterSignalClaim> {
  let m = memoryClaims.get(ownerUid);
  if (!m) {
    m = new Map();
    memoryClaims.set(ownerUid, m);
  }
  return m;
}

export type ClaimAcquireResult =
  | { ok: true; claim: GoldHunterSignalClaim; created: boolean }
  | {
      ok: false;
      reason: "ALREADY_CLAIMED" | "TERMINAL" | "IN_FLIGHT";
      claim: GoldHunterSignalClaim;
    };

/**
 * Atomic create-if-absent claim. Returns ok only when this caller owns CLAIMED.
 */
export async function acquireGoldHunterSignalClaim(args: {
  ownerUid: string;
  signalId: string;
  goldHunterTradeId: string;
  clientOrderId: string;
  setup: "A" | "B" | "C" | null;
  side: "BUY" | "SELL" | null;
}): Promise<ClaimAcquireResult> {
  const now = new Date().toISOString();
  const fresh: GoldHunterSignalClaim = {
    signalId: args.signalId,
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    ownerUid: args.ownerUid,
    state: "CLAIMED",
    goldHunterTradeId: args.goldHunterTradeId,
    clientOrderId: args.clientOrderId,
    brokerOrderId: null,
    brokerPositionId: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
    claimedAt: now,
    setup: args.setup,
    side: args.side
  };

  const col = claimCol(args.ownerUid);
  if (!col) {
    const map = memMap(args.ownerUid);
    const existing = map.get(args.signalId);
    if (existing) {
      if (
        existing.state === "CLAIMED" ||
        existing.state === "SUBMITTING" ||
        existing.state === "PENDING_RECONCILIATION"
      ) {
        return { ok: false, reason: "IN_FLIGHT", claim: existing };
      }
      if (
        existing.state === "ACCEPTED" ||
        existing.state === "OPEN" ||
        existing.state === "BROKER_REJECTED" ||
        existing.state === "BROKER_SUBMIT_ERROR" ||
        existing.state === "CLOSED"
      ) {
        return { ok: false, reason: "ALREADY_CLAIMED", claim: existing };
      }
    }
    map.set(args.signalId, fresh);
    return { ok: true, claim: fresh, created: true };
  }

  try {
    const result = await col.firestore.runTransaction(async (tx) => {
      const ref = col.doc(args.signalId);
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = snap.data() as GoldHunterSignalClaim;
        if (
          existing.state === "CLAIMED" ||
          existing.state === "SUBMITTING" ||
          existing.state === "PENDING_RECONCILIATION"
        ) {
          return { ok: false as const, reason: "IN_FLIGHT" as const, claim: existing };
        }
        return {
          ok: false as const,
          reason: "ALREADY_CLAIMED" as const,
          claim: existing
        };
      }
      tx.create(ref, fresh);
      return { ok: true as const, claim: fresh, created: true as const };
    });
    return result;
  } catch (e) {
    // Concurrent create → treat as already claimed
    const again = await col.doc(args.signalId).get();
    if (again.exists) {
      const existing = again.data() as GoldHunterSignalClaim;
      return { ok: false, reason: "ALREADY_CLAIMED", claim: existing };
    }
    throw e;
  }
}

export async function updateGoldHunterSignalClaim(
  ownerUid: string,
  signalId: string,
  patch: Partial<GoldHunterSignalClaim>
): Promise<GoldHunterSignalClaim | null> {
  const now = new Date().toISOString();
  const col = claimCol(ownerUid);
  if (!col) {
    const map = memMap(ownerUid);
    const cur = map.get(signalId);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: now, signalId, ownerUid };
    map.set(signalId, next);
    return next;
  }
  const ref = col.doc(signalId);
  await ref.set({ ...patch, updatedAt: now }, { merge: true });
  const snap = await ref.get();
  return snap.exists ? (snap.data() as GoldHunterSignalClaim) : null;
}

export async function getGoldHunterSignalClaim(
  ownerUid: string,
  signalId: string
): Promise<GoldHunterSignalClaim | null> {
  const col = claimCol(ownerUid);
  if (!col) return memMap(ownerUid).get(signalId) ?? null;
  const snap = await col.doc(signalId).get();
  return snap.exists ? (snap.data() as GoldHunterSignalClaim) : null;
}

export async function isGoldHunterSignalDurablyConsumed(
  ownerUid: string,
  signalId: string
): Promise<boolean> {
  const claim = await getGoldHunterSignalClaim(ownerUid, signalId);
  if (!claim) return false;
  return (
    claim.state === "CLAIMED" ||
    claim.state === "SUBMITTING" ||
    claim.state === "ACCEPTED" ||
    claim.state === "OPEN" ||
    claim.state === "BROKER_REJECTED" ||
    claim.state === "BROKER_SUBMIT_ERROR" ||
    claim.state === "PENDING_RECONCILIATION" ||
    claim.state === "CLOSED"
  );
}
