/**
 * Persistence for the single internal AutoTrade armed candidate per user.
 * Path: users/{uid}/autotradeArmedCandidate/current
 *
 * Analysis/execution engine only — not exposed as UI state.
 */

import { getFirestore } from "firebase-admin/firestore";
import type { ArmedCandidate } from "./armedCandidate";

function docRef(uid: string) {
  return getFirestore().doc(`users/${uid}/autotradeArmedCandidate/current`);
}

/** Test/in-process override — avoids Firestore in unit tests. */
const memory = new Map<string, ArmedCandidate | null>();
let useMemory = false;

export function useArmedCandidateMemoryStore(enabled = true): void {
  useMemory = enabled;
  if (!enabled) memory.clear();
}

export function resetArmedCandidateMemoryStore(): void {
  memory.clear();
}

export async function getArmedCandidate(uid: string): Promise<ArmedCandidate | null> {
  if (useMemory) {
    return memory.get(uid) ?? null;
  }
  const snap = await docRef(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() as ArmedCandidate;
  if (!data || data.status !== "ARMED") return null;
  return data;
}

export async function saveArmedCandidate(candidate: ArmedCandidate): Promise<ArmedCandidate> {
  if (useMemory) {
    memory.set(candidate.uid, candidate.status === "ARMED" ? candidate : null);
    return candidate;
  }
  if (candidate.status !== "ARMED") {
    await docRef(candidate.uid).delete().catch(async () => {
      await docRef(candidate.uid).set({ ...candidate, cleared: true });
    });
    return candidate;
  }
  await docRef(candidate.uid).set(candidate);
  return candidate;
}

export async function clearArmedCandidate(uid: string): Promise<void> {
  if (useMemory) {
    memory.set(uid, null);
    return;
  }
  await docRef(uid).delete().catch(() => undefined);
}
