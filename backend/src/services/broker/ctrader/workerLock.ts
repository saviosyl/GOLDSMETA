/**
 * Single-worker lease lock in Firestore so only one persistent quote worker
 * owns the Spotware WebSocket per owner at a time.
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";

const LOCK_DOC = "ctraderQuoteWorkerLock";
const DEFAULT_LEASE_MS = 45_000;

export type WorkerLockHandle = {
  ownerUid: string;
  lockId: string;
  release: () => Promise<void>;
  renew: () => Promise<boolean>;
};

function lockRef(ownerUid: string) {
  return getFirestore().doc(`users/${ownerUid}/${LOCK_DOC}/current`);
}

export async function acquireWorkerLock(
  ownerUid: string,
  opts?: { leaseMs?: number; lockId?: string }
): Promise<WorkerLockHandle | null> {
  const leaseMs = opts?.leaseMs ?? DEFAULT_LEASE_MS;
  const lockId = opts?.lockId ?? randomUUID();
  const ref = lockRef(ownerUid);
  const now = Date.now();
  const expiresAt = new Date(now + leaseMs).toISOString();

  const acquired = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as
      | { lockId?: string; expiresAt?: string }
      | undefined;
    const existingExpiry = data?.expiresAt ? Date.parse(data.expiresAt) : 0;
    if (
      data?.lockId &&
      Number.isFinite(existingExpiry) &&
      existingExpiry > now &&
      data.lockId !== lockId
    ) {
      return false;
    }
    tx.set(
      ref,
      {
        lockId,
        ownerUid,
        acquiredAt: new Date(now).toISOString(),
        expiresAt,
        heartbeatAt: new Date(now).toISOString()
      },
      { merge: true }
    );
    return true;
  });

  if (!acquired) return null;

  return {
    ownerUid,
    lockId,
    renew: async () => {
      const nextExpiry = new Date(Date.now() + leaseMs).toISOString();
      const ok = await getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as { lockId?: string } | undefined;
        if (data?.lockId !== lockId) return false;
        tx.set(
          ref,
          {
            expiresAt: nextExpiry,
            heartbeatAt: new Date().toISOString()
          },
          { merge: true }
        );
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
