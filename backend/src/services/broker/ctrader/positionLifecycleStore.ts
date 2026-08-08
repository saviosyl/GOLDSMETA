/**
 * Firestore store for Demo position lifecycle documents.
 * Path: users/{uid}/autotradePositions/{correlationId}
 */

import { getFirestore } from "firebase-admin/firestore";
import type { DemoPositionLifecycle } from "./positionLifecycleTypes";
export { appendLifecycleEvent } from "./positionLifecycleTypes";

function col(uid: string) {
  return getFirestore().collection(`users/${uid}/autotradePositions`);
}

export async function getPositionLifecycle(
  uid: string,
  correlationId: string
): Promise<DemoPositionLifecycle | null> {
  const snap = await col(uid).doc(correlationId).get();
  if (!snap.exists) return null;
  return snap.data() as DemoPositionLifecycle;
}

export async function savePositionLifecycle(
  doc: DemoPositionLifecycle
): Promise<void> {
  await col(doc.uid).doc(doc.correlationId).set(
    {
      ...doc,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function listOpenPositionLifecycles(
  uid: string
): Promise<DemoPositionLifecycle[]> {
  const [openSnap, pendingSnap] = await Promise.all([
    col(uid).where("status", "==", "OPEN").limit(20).get(),
    col(uid)
      .where("status", "==", "CLOSE_RECONCILIATION_PENDING")
      .limit(20)
      .get()
  ]);
  const byId = new Map<string, DemoPositionLifecycle>();
  for (const d of [...openSnap.docs, ...pendingSnap.docs]) {
    const row = d.data() as DemoPositionLifecycle;
    byId.set(row.correlationId, row);
  }
  return [...byId.values()];
}

export async function listOpenPositionOwners(
  limit = 50
): Promise<string[]> {
  const [openSnap, pendingSnap] = await Promise.all([
    getFirestore()
      .collectionGroup("autotradePositions")
      .where("status", "==", "OPEN")
      .where("environment", "==", "DEMO")
      .limit(limit)
      .get(),
    getFirestore()
      .collectionGroup("autotradePositions")
      .where("status", "==", "CLOSE_RECONCILIATION_PENDING")
      .where("environment", "==", "DEMO")
      .limit(limit)
      .get()
  ]);
  const uids = new Set<string>();
  for (const d of [...openSnap.docs, ...pendingSnap.docs]) {
    const data = d.data() as DemoPositionLifecycle;
    if (data.uid) uids.add(data.uid);
  }
  return [...uids];
}
