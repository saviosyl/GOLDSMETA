/**
 * FAST execution claim — Firestore is authoritative.
 * In-memory cache is an optimisation only and is never the dedupe source
 * in production. Two Cloud Function instances racing the same
 * ownerUid+signalId get exactly one NewOrder reservation.
 */

import { createHash } from "crypto";
import { getFirestoreDb } from "../../../firebaseAdmin";

export type FastExecutionClaimState =
  | "RESERVED"
  | "SUBMITTING"
  | "BROKER_SUBMITTED"
  | "BROKER_ACCEPTED_PENDING_FILL"
  | "BROKER_REJECTED"
  | "BROKER_SUBMIT_ERROR"
  | "BROKER_OUTCOME_UNKNOWN"
  | "BROKER_TIMEOUT_RECONCILED_FILLED"
  | "BROKER_TIMEOUT_RECONCILED_NOT_FOUND";

export type FastPendingOpenSnapshot = {
  direction: "BUY" | "SELL";
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lots: number;
  correlationId: string;
  decisionId: string;
};

export type FastExecutionClaim = {
  ownerUid: string;
  signalId: string;
  clientOrderId: string;
  state: FastExecutionClaimState;
  requestSent: boolean;
  newOrderReqCount: number;
  errorCode: string | null;
  orderId: string | null;
  positionId: string | null;
  tradeCreated: boolean;
  pendingOpenSnapshot?: FastPendingOpenSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

export type ReserveFastClaimResult =
  | { ok: true; claim: FastExecutionClaim }
  | {
      ok: false;
      claim: FastExecutionClaim | null;
      reason: "ALREADY_CLAIMED" | "FIRESTORE_UNAVAILABLE";
    };

export type FastClaimBackend = {
  get(ownerUid: string, signalId: string): Promise<FastExecutionClaim | null>;
  reserve(args: {
    ownerUid: string;
    signalId: string;
    clientOrderId: string;
    nowIso: string;
  }): Promise<ReserveFastClaimResult>;
  update(
    ownerUid: string,
    signalId: string,
    patch: Partial<FastExecutionClaim>
  ): Promise<FastExecutionClaim | null>;
  listPending(ownerUid: string): Promise<FastExecutionClaim[]>;
  clear(): Promise<void>;
};

const PENDING_STATES: FastExecutionClaimState[] = [
  "BROKER_ACCEPTED_PENDING_FILL",
  "BROKER_OUTCOME_UNKNOWN"
];

const cache = new Map<string, FastExecutionClaim>();
let testBackend: FastClaimBackend | null = null;
let defaultTestBackend: FastClaimBackend | null = null;

function cacheKey(ownerUid: string, signalId: string): string {
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

export function claimDocId(signalId: string): string {
  const raw = String(signalId || "unknown");
  if (/^[A-Za-z0-9_\-.]{1,700}$/.test(raw)) return raw;
  return `h_${createHash("sha1").update(raw).digest("hex")}`;
}

export function blocksAutomaticResubmit(claim: FastExecutionClaim | null): boolean {
  if (!claim) return false;
  if (claim.state === "BROKER_OUTCOME_UNKNOWN") return true;
  if (claim.state === "BROKER_ACCEPTED_PENDING_FILL") return true;
  if (claim.state === "BROKER_SUBMITTED") return true;
  if (claim.state === "BROKER_TIMEOUT_RECONCILED_FILLED") return true;
  if (claim.state === "RESERVED") return true;
  if (claim.state === "SUBMITTING") return true;
  if (claim.requestSent) return true;
  return false;
}

export function shouldReconcileInsteadOfResubmit(
  claim: FastExecutionClaim | null
): boolean {
  if (!claim || claim.tradeCreated) return false;
  return (
    claim.state === "BROKER_ACCEPTED_PENDING_FILL" ||
    claim.state === "BROKER_OUTCOME_UNKNOWN" ||
    claim.state === "BROKER_TIMEOUT_RECONCILED_NOT_FOUND" ||
    claim.state === "SUBMITTING" ||
    claim.state === "RESERVED" ||
    claim.requestSent
  );
}

function freshClaim(args: {
  ownerUid: string;
  signalId: string;
  clientOrderId: string;
  nowIso: string;
}): FastExecutionClaim {
  return {
    ownerUid: args.ownerUid,
    signalId: args.signalId,
    clientOrderId: args.clientOrderId,
    state: "RESERVED",
    requestSent: false,
    newOrderReqCount: 0,
    errorCode: null,
    orderId: null,
    positionId: null,
    tradeCreated: false,
    createdAt: args.nowIso,
    updatedAt: args.nowIso
  };
}

function remember(claim: FastExecutionClaim): FastExecutionClaim {
  cache.set(cacheKey(claim.ownerUid, claim.signalId), claim);
  return claim;
}

/** Atomic in-memory backend for tests — serializes reserve like a transaction. */
export function createAtomicMemoryClaimBackend(): FastClaimBackend {
  const map = new Map<string, FastExecutionClaim>();
  let chain = Promise.resolve();
  const serialize = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  return {
    async get(ownerUid, signalId) {
      return map.get(cacheKey(ownerUid, signalId)) ?? null;
    },
    reserve(args) {
      return serialize(() => {
        const key = cacheKey(args.ownerUid, args.signalId);
        const existing = map.get(key) ?? null;
        if (existing && blocksAutomaticResubmit(existing)) {
          return { ok: false as const, claim: existing, reason: "ALREADY_CLAIMED" as const };
        }
        const claim = freshClaim(args);
        if (existing?.clientOrderId) claim.clientOrderId = existing.clientOrderId;
        if (existing?.createdAt) claim.createdAt = existing.createdAt;
        map.set(key, claim);
        return { ok: true as const, claim };
      });
    },
    async update(ownerUid, signalId, patch) {
      const key = cacheKey(ownerUid, signalId);
      const existing = map.get(key);
      if (!existing) return null;
      const next: FastExecutionClaim = {
        ...existing,
        ...patch,
        ownerUid,
        signalId,
        updatedAt: new Date().toISOString()
      };
      map.set(key, next);
      return next;
    },
    async listPending(ownerUid) {
      return [...map.values()].filter(
        (c) => c.ownerUid === ownerUid && PENDING_STATES.includes(c.state)
      );
    },
    async clear() {
      map.clear();
    }
  };
}

export function createFirestoreClaimBackend(db: NonNullable<
  ReturnType<typeof getFirestoreDb>
>): FastClaimBackend {
  return {
    async get(ownerUid, signalId) {
      const snap = await db
        .collection("users")
        .doc(ownerUid)
        .collection("fastExecutionClaims")
        .doc(claimDocId(signalId))
        .get();
      return snap.exists ? (snap.data() as FastExecutionClaim) : null;
    },
    async reserve(args) {
      const ref = db
        .collection("users")
        .doc(args.ownerUid)
        .collection("fastExecutionClaims")
        .doc(claimDocId(args.signalId));
      try {
        return await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (snap.exists) {
            const existing = snap.data() as FastExecutionClaim;
            if (blocksAutomaticResubmit(existing)) {
              return {
                ok: false as const,
                claim: existing,
                reason: "ALREADY_CLAIMED" as const
              };
            }
            const claim = freshClaim(args);
            if (existing.clientOrderId) claim.clientOrderId = existing.clientOrderId;
            if (existing.createdAt) claim.createdAt = existing.createdAt;
            tx.set(ref, claim);
            return { ok: true as const, claim };
          }
          const claim = freshClaim(args);
          tx.create(ref, claim);
          return { ok: true as const, claim };
        });
      } catch {
        const again = await ref.get();
        if (again.exists) {
          return {
            ok: false,
            claim: again.data() as FastExecutionClaim,
            reason: "ALREADY_CLAIMED"
          };
        }
        return { ok: false, claim: null, reason: "FIRESTORE_UNAVAILABLE" };
      }
    },
    async update(ownerUid, signalId, patch) {
      const ref = db
        .collection("users")
        .doc(ownerUid)
        .collection("fastExecutionClaims")
        .doc(claimDocId(signalId));
      const now = new Date().toISOString();
      await ref.set({ ...patch, updatedAt: now }, { merge: true });
      const snap = await ref.get();
      return snap.exists ? (snap.data() as FastExecutionClaim) : null;
    },
    async listPending(ownerUid) {
      const snap = await db
        .collection("users")
        .doc(ownerUid)
        .collection("fastExecutionClaims")
        .where("state", "in", PENDING_STATES)
        .get();
      return snap.docs.map((d) => d.data() as FastExecutionClaim);
    },
    async clear() {
      /* production no-op */
    }
  };
}

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.APP_ENV === "test" ||
    process.env.VITEST === "true"
  );
}

function firestoreBackend(): FastClaimBackend | null {
  const db = getFirestoreDb();
  return db ? createFirestoreClaimBackend(db) : null;
}

function backend(): FastClaimBackend {
  if (testBackend) return testBackend;
  const fs = firestoreBackend();
  if (fs) return fs;
  if (isTestRuntime()) {
    if (!defaultTestBackend) defaultTestBackend = createAtomicMemoryClaimBackend();
    return defaultTestBackend;
  }
  return {
    async get() {
      return null;
    },
    async reserve() {
      return { ok: false, claim: null, reason: "FIRESTORE_UNAVAILABLE" };
    },
    async update() {
      return null;
    },
    async listPending() {
      return [];
    },
    async clear() {
      /* no-op */
    }
  };
}

export function useFastExecutionClaimBackendForTests(next: FastClaimBackend | null): void {
  testBackend = next;
}

export async function getFastExecutionClaim(
  ownerUid: string,
  signalId: string
): Promise<FastExecutionClaim | null> {
  const cached = cache.get(cacheKey(ownerUid, signalId));
  const authoritative = await backend().get(ownerUid, signalId);
  if (authoritative) return remember(authoritative);
  if (cached && !getFirestoreDb() && isTestRuntime()) return cached;
  return authoritative;
}

export async function reserveFastExecutionClaim(args: {
  ownerUid: string;
  signalId: string;
  clientOrderId: string;
  nowIso?: string;
}): Promise<ReserveFastClaimResult> {
  const result = await backend().reserve({
    ownerUid: args.ownerUid,
    signalId: args.signalId,
    clientOrderId: args.clientOrderId,
    nowIso: args.nowIso ?? new Date().toISOString()
  });
  if (result.claim) remember(result.claim);
  return result;
}

export async function updateFastExecutionClaim(
  ownerUid: string,
  signalId: string,
  patch: Partial<
    Pick<
      FastExecutionClaim,
      | "state"
      | "requestSent"
      | "newOrderReqCount"
      | "errorCode"
      | "clientOrderId"
      | "orderId"
      | "positionId"
      | "tradeCreated"
      | "pendingOpenSnapshot"
    >
  >
): Promise<FastExecutionClaim | null> {
  const next = await backend().update(ownerUid, signalId, patch);
  if (next) remember(next);
  return next;
}

export async function listPendingFastExecutionClaims(
  ownerUid: string
): Promise<FastExecutionClaim[]> {
  return backend().listPending(ownerUid);
}

export async function resetFastExecutionClaimsForTests(): Promise<void> {
  cache.clear();
  await backend().clear();
  if (defaultTestBackend) await defaultTestBackend.clear();
}

export function dropFastExecutionClaimCacheForTests(): void {
  cache.clear();
}
