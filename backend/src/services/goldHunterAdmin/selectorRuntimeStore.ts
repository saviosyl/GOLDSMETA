/**
 * Persist Gold Hunter selector runtime snapshot for status / multi-instance reads.
 */
import { getFirestoreDb } from "../firebaseAdmin";
import type {
  GoldHunterSelectedCandidate,
  GoldHunterSelectorReadiness
} from "./strategySelector";
import {
  GH_FAST_MARKET_DATA_NORMALIZATION_VERSION
} from "./abc";

export type GoldHunterSelectorRuntimeSnapshot = {
  ownerUid: string;
  readiness: GoldHunterSelectorReadiness;
  lastCandidate: GoldHunterSelectedCandidate | null;
  lastObservationAt: string | null;
  depthValidity: string | null;
  spotAgeMs: number | null;
  depthAgeMs: number | null;
  normalizationVersion: typeof GH_FAST_MARKET_DATA_NORMALIZATION_VERSION;
  updatedAt: string;
  protectionGeometryConnected: boolean;
};

const memory = new Map<string, GoldHunterSelectorRuntimeSnapshot>();

export function resetGoldHunterSelectorRuntimeMemory(): void {
  memory.clear();
}

function runtimeDoc(ownerUid: string) {
  const db = getFirestoreDb();
  if (!db) return null;
  return db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterSelector")
    .doc("runtime");
}

export async function saveGoldHunterSelectorRuntime(
  snap: GoldHunterSelectorRuntimeSnapshot
): Promise<void> {
  memory.set(snap.ownerUid, snap);
  const ref = runtimeDoc(snap.ownerUid);
  if (!ref) return;
  await ref.set(snap, { merge: true });
}

export async function loadGoldHunterSelectorRuntime(
  ownerUid: string
): Promise<GoldHunterSelectorRuntimeSnapshot | null> {
  const mem = memory.get(ownerUid);
  if (mem) return mem;
  const ref = runtimeDoc(ownerUid);
  if (!ref) return null;
  try {
    const snap = await ref.get();
    if (!snap.exists) return null;
    return snap.data() as GoldHunterSelectorRuntimeSnapshot;
  } catch {
    return null;
  }
}
