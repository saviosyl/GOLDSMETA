/**
 * In-memory + Firestore persistence for shadow qualification epoch/trades.
 */
import { getFirestoreDb } from "../../firebaseAdmin";
import type {
  GhShadowDecisionRecord,
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "./types";

const memoryEpoch = new Map<string, GhShadowQualificationEpoch>();
const memoryTrades = new Map<string, Map<string, GhShadowTrade>>();
const memoryDecisions = new Map<string, GhShadowDecisionRecord[]>();

export function resetGhShadowQualificationMemoryForTests(): void {
  memoryEpoch.clear();
  memoryTrades.clear();
  memoryDecisions.clear();
}

function epochRef(ownerUid: string) {
  const db = getFirestoreDb();
  if (!db) return null;
  return db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterShadowQualification")
    .doc("epoch");
}

function tradesCol(ownerUid: string) {
  const db = getFirestoreDb();
  if (!db) return null;
  return db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterShadowQualification")
    .doc("epoch")
    .collection("trades");
}

function decisionsCol(ownerUid: string) {
  const db = getFirestoreDb();
  if (!db) return null;
  return db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterShadowQualification")
    .doc("epoch")
    .collection("decisions");
}

export async function loadGhShadowEpoch(
  ownerUid: string
): Promise<GhShadowQualificationEpoch | null> {
  const ref = epochRef(ownerUid);
  if (!ref) return memoryEpoch.get(ownerUid) ?? null;
  const snap = await ref.get();
  return snap.exists ? (snap.data() as GhShadowQualificationEpoch) : null;
}

export async function saveGhShadowEpoch(
  ownerUid: string,
  epoch: GhShadowQualificationEpoch
): Promise<void> {
  const ref = epochRef(ownerUid);
  if (!ref) {
    memoryEpoch.set(ownerUid, epoch);
    return;
  }
  await ref.set(epoch, { merge: true });
}

export async function upsertGhShadowTrade(
  ownerUid: string,
  trade: GhShadowTrade
): Promise<void> {
  const col = tradesCol(ownerUid);
  if (!col) {
    let m = memoryTrades.get(ownerUid);
    if (!m) {
      m = new Map();
      memoryTrades.set(ownerUid, m);
    }
    m.set(trade.tradeId, trade);
    return;
  }
  await col.doc(trade.tradeId).set(trade, { merge: true });
}

export async function listGhShadowTrades(
  ownerUid: string,
  opts?: { formalOnly?: boolean; limit?: number }
): Promise<GhShadowTrade[]> {
  const limit = Math.min(2000, Math.max(1, opts?.limit ?? 500));
  const col = tradesCol(ownerUid);
  let rows: GhShadowTrade[];
  if (!col) {
    rows = [...(memoryTrades.get(ownerUid)?.values() ?? [])];
  } else {
    try {
      const snap = await col.orderBy("signalTs", "desc").limit(limit).get();
      rows = snap.docs.map((d) => d.data() as GhShadowTrade);
    } catch {
      const snap = await col.limit(limit).get();
      rows = snap.docs.map((d) => d.data() as GhShadowTrade);
    }
  }
  if (opts?.formalOnly) {
    rows = rows.filter(
      (t) =>
        t.dataQuality === "FORMAL_ELIGIBLE" &&
        t.status === "CLOSED" &&
        t.simulatedNetPnlEur != null &&
        Number.isFinite(t.simulatedNetPnlEur)
    );
  }
  return rows
    .sort((a, b) => (b.signalTs ?? "").localeCompare(a.signalTs ?? ""))
    .slice(0, limit);
}

export async function appendGhShadowDecision(
  ownerUid: string,
  decision: GhShadowDecisionRecord
): Promise<void> {
  const col = decisionsCol(ownerUid);
  if (!col) {
    const list = memoryDecisions.get(ownerUid) ?? [];
    list.push(decision);
    memoryDecisions.set(ownerUid, list.slice(-5000));
    return;
  }
  await col.doc(decision.decisionId).set(decision);
}

export async function listGhShadowDecisions(
  ownerUid: string,
  limit = 2000
): Promise<GhShadowDecisionRecord[]> {
  const n = Math.min(5000, Math.max(1, limit));
  const col = decisionsCol(ownerUid);
  if (!col) {
    return (memoryDecisions.get(ownerUid) ?? []).slice(-n);
  }
  try {
    const snap = await col.orderBy("at", "asc").limit(n).get();
    return snap.docs.map((d) => d.data() as GhShadowDecisionRecord);
  } catch {
    const snap = await col.limit(n).get();
    return snap.docs.map((d) => d.data() as GhShadowDecisionRecord);
  }
}

/** Storage path documentation for ops. */
export const GH_SHADOW_QUALIFICATION_STORAGE_PATH =
  "users/{ownerUid}/goldHunterShadowQualification/epoch[+ /trades /decisions]";
