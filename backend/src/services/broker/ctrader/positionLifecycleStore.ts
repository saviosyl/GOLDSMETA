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
  const snap = await col(uid).where("status", "==", "OPEN").limit(20).get();
  return snap.docs.map((d) => d.data() as DemoPositionLifecycle);
}

export async function listOpenPositionOwners(
  limit = 50
): Promise<string[]> {
  const snap = await getFirestore()
    .collectionGroup("autotradePositions")
    .where("status", "==", "OPEN")
    .where("environment", "==", "DEMO")
    .limit(limit)
    .get();
  const uids = new Set<string>();
  for (const d of snap.docs) {
    const data = d.data() as DemoPositionLifecycle;
    if (data.uid) uids.add(data.uid);
  }
  return [...uids];
}
