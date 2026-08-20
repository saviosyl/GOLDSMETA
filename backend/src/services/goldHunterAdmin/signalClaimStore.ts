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
  | "PRETRANSPORT_BLOCKED"
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
        existing.state === "PRETRANSPORT_BLOCKED" ||
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

function applyMonotonicClaimPatch(
  existing: GoldHunterSignalClaim,
  patch: Partial<GoldHunterSignalClaim>,
  now: string
): { claim: GoldHunterSignalClaim; rejectedRegression: boolean } {
  if (existing.state === "CLOSED") {
    if (patch.state != null && patch.state !== "CLOSED") {
      return { claim: existing, rejectedRegression: true };
    }
    return {
      claim: {
        ...existing,
        ...patch,
        state: "CLOSED",
        signalId: existing.signalId,
        ownerUid: existing.ownerUid,
        updatedAt: now
      },
      rejectedRegression: false
    };
  }
  return {
    claim: { ...existing, ...patch, updatedAt: now, signalId: existing.signalId, ownerUid: existing.ownerUid },
    rejectedRegression: false
  };
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
    const merged = applyMonotonicClaimPatch(cur, patch, now);
    if (merged.rejectedRegression) return merged.claim;
    map.set(signalId, merged.claim);
    return merged.claim;
  }
  const ref = col.doc(signalId);
  return col.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, { ...patch, updatedAt: now, signalId, ownerUid }, { merge: true });
      return {
        ...(patch as GoldHunterSignalClaim),
        signalId,
        ownerUid,
        updatedAt: now
      };
    }
    const existing = snap.data() as GoldHunterSignalClaim;
    const merged = applyMonotonicClaimPatch(existing, patch, now);
    if (merged.rejectedRegression) return merged.claim;
    tx.set(ref, merged.claim, { merge: true });
    return merged.claim;
  });
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

/**
 * Exact claim lookup by goldHunterTradeId (legacy lease recovery).
 * Not a capped recent-list scan — targeted equality query / full memory scan.
 * Throws on ambiguous multi-match (fail closed at caller).
 */
export async function getGoldHunterSignalClaimByGoldHunterTradeId(
  ownerUid: string,
  goldHunterTradeId: string
): Promise<GoldHunterSignalClaim | null> {
  const tradeId = String(goldHunterTradeId ?? "").trim();
  if (!tradeId) return null;

  const col = claimCol(ownerUid);
  if (!col) {
    const matches = [...memMap(ownerUid).values()].filter(
      (c) => c.goldHunterTradeId === tradeId
    );
    if (matches.length > 1) {
      throw Object.assign(new Error("CLAIM_TRADE_ID_AMBIGUOUS"), {
        code: "claim_authority_unknown"
      });
    }
    return matches[0] ?? null;
  }

  const snap = await col
    .where("goldHunterTradeId", "==", tradeId)
    .limit(2)
    .get();
  if (snap.size > 1) {
    throw Object.assign(new Error("CLAIM_TRADE_ID_AMBIGUOUS"), {
      code: "claim_authority_unknown"
    });
  }
  if (snap.empty) return null;
  return snap.docs[0]!.data() as GoldHunterSignalClaim;
}

export async function listGoldHunterSignalClaims(
  ownerUid: string,
  limit = 200
): Promise<GoldHunterSignalClaim[]> {
  const n = Math.min(500, Math.max(1, limit));
  const col = claimCol(ownerUid);
  if (!col) {
    return [...memMap(ownerUid).values()].slice(0, n);
  }
  try {
    const snap = await col.orderBy("updatedAt", "desc").limit(n).get();
    return snap.docs.map((d) => d.data() as GoldHunterSignalClaim);
  } catch {
    const snap = await col.limit(n).get();
    return snap.docs.map((d) => d.data() as GoldHunterSignalClaim);
  }
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
    claim.state === "PRETRANSPORT_BLOCKED" ||
    claim.state === "PENDING_RECONCILIATION" ||
    claim.state === "CLOSED"
  );
}
