/**
 * Single-worker lease lock in Firestore so only one persistent quote worker
 * owns the Spotware WebSocket per owner at a time.
 *
 * Heartbeat alone is insufficient — locks that stop recording successful
 * XAUUSD quotes become stealable so a healthy worker (or restart) can recover.
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_LOCK_QUOTE_STALE_MS,
  isWorkerLockQuoteStale
} from "./quoteStreamHealth";

const LOCK_DOC = "ctraderQuoteWorkerLock";
const DEFAULT_LEASE_MS = 45_000;

export type WorkerLockHandle = {
  ownerUid: string;
  lockId: string;
  release: () => Promise<void>;
  renew: (meta?: {
    lastSuccessfulQuoteAt?: string | null;
  }) => Promise<boolean>;
};

export type AcquireWorkerLockOptions = {
  leaseMs?: number;
  lockId?: string;
  /** Steal lock when lastSuccessfulQuoteAt older than this (ms). */
  quoteStaleMs?: number;
};

function lockRef(ownerUid: string) {
  return getFirestore().doc(`users/${ownerUid}/${LOCK_DOC}/current`);
}

export async function acquireWorkerLock(
  ownerUid: string,
  opts?: AcquireWorkerLockOptions
): Promise<WorkerLockHandle | null> {
  const leaseMs = opts?.leaseMs ?? DEFAULT_LEASE_MS;
  const quoteStaleMs = opts?.quoteStaleMs ?? DEFAULT_LOCK_QUOTE_STALE_MS;
  const lockId = opts?.lockId ?? randomUUID();
  const ref = lockRef(ownerUid);
  const now = Date.now();
  const expiresAt = new Date(now + leaseMs).toISOString();

  const acquired = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as
      | {
          lockId?: string | null;
          expiresAt?: string | null;
          lastSuccessfulQuoteAt?: string | null;
        }
      | undefined;
    const existingExpiry = data?.expiresAt ? Date.parse(data.expiresAt) : 0;
    const heldByOther =
      Boolean(data?.lockId) &&
      data!.lockId !== lockId &&
      Number.isFinite(existingExpiry) &&
      existingExpiry > now;
    if (heldByOther) {
      const quoteStale = isWorkerLockQuoteStale({
        nowMs: now,
        lastSuccessfulQuoteAt: data?.lastSuccessfulQuoteAt,
        staleAfterMs: quoteStaleMs
      });
      if (!quoteStale) return false;
    }
    tx.set(
      ref,
      {
        lockId,
        ownerUid,
        acquiredAt: new Date(now).toISOString(),
        expiresAt,
        heartbeatAt: new Date(now).toISOString(),
        // Preserve prior quote timestamp until this worker persists a fresh one.
        lastSuccessfulQuoteAt: data?.lastSuccessfulQuoteAt ?? null,
        stolenFromLockId:
          heldByOther && data?.lockId ? data.lockId : FieldValue.delete()
      },
      { merge: true }
    );
    return true;
  });

  if (!acquired) return null;

  return {
    ownerUid,
    lockId,
    renew: async (meta) => {
      const nextExpiry = new Date(Date.now() + leaseMs).toISOString();
      const ok = await getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as { lockId?: string } | undefined;
        if (data?.lockId !== lockId) return false;
        const patch: Record<string, unknown> = {
          expiresAt: nextExpiry,
          heartbeatAt: new Date().toISOString()
        };
        if (meta && "lastSuccessfulQuoteAt" in meta) {
          patch.lastSuccessfulQuoteAt = meta.lastSuccessfulQuoteAt ?? null;
        }
        tx.set(ref, patch, { merge: true });
        return true;
      });
      return ok;
    },
    release: async () => {
      await getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as { lockId?: string } | undefined;
        if (data?.lockId !== lockId) return;
        tx.set(
          ref,
          {
            lockId: null,
            expiresAt: null,
            releasedAt: new Date().toISOString(),
            heartbeatAt: FieldValue.delete()
          },
          { merge: true }
        );
      });
    }
  };
}
