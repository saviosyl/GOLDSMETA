/**
 * Epoch-isolated persistence for shadow qualification.
 *
 * Path:
 *   users/{ownerUid}/goldHunterShadowQualification/{qualificationId}
 *     /trades | /events | /decisions
 *   users/{ownerUid}/goldHunterShadowQualification/__currentEpoch  (pointer)
 */
import { getFirestoreDb } from "../../firebaseAdmin";
import type {
  GhShadowCapturedEvent,
  GhShadowDecisionRecord,
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "./types";

export const GH_SHADOW_QUALIFICATION_STORAGE_PATH =
  "users/{ownerUid}/goldHunterShadowQualification/{qualificationId}[+ /trades /events /decisions] + __currentEpoch pointer" as const;

const CURRENT_EPOCH_DOC = "__currentEpoch";

type MemEpochBucket = {
  epoch: GhShadowQualificationEpoch;
  trades: Map<string, GhShadowTrade>;
  events: GhShadowCapturedEvent[];
  decisions: GhShadowDecisionRecord[];
};

const memoryCurrent = new Map<string, string>();
const memoryEpochs = new Map<string, Map<string, MemEpochBucket>>();

export function resetGhShadowQualificationMemoryForTests(): void {
  memoryCurrent.clear();
  memoryEpochs.clear();
}

function ownerEpochs(ownerUid: string): Map<string, MemEpochBucket> {
  let m = memoryEpochs.get(ownerUid);
  if (!m) {
    m = new Map();
    memoryEpochs.set(ownerUid, m);
  }
  return m;
}

function bucket(ownerUid: string, qualificationId: string): MemEpochBucket | null {
  return ownerEpochs(ownerUid).get(qualificationId) ?? null;
}

function ensureBucket(
  ownerUid: string,
  epoch: GhShadowQualificationEpoch
): MemEpochBucket {
  const map = ownerEpochs(ownerUid);
  let b = map.get(epoch.qualificationId);
  if (!b) {
    b = { epoch, trades: new Map(), events: [], decisions: [] };
    map.set(epoch.qualificationId, b);
  } else {
    b.epoch = epoch;
  }
  return b;
}

function rootCol(ownerUid: string) {
  const db = getFirestoreDb();
  if (!db) return null;
  return db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterShadowQualification");
}

function epochDoc(ownerUid: string, qualificationId: string) {
  const root = rootCol(ownerUid);
  if (!root) return null;
  return root.doc(qualificationId);
}

export async function getCurrentQualificationId(
  ownerUid: string
): Promise<string | null> {
  const root = rootCol(ownerUid);
  if (!root) return memoryCurrent.get(ownerUid) ?? null;
  const snap = await root.doc(CURRENT_EPOCH_DOC).get();
  if (!snap.exists) return null;
  const id = (snap.data() as { qualificationId?: string } | undefined)
    ?.qualificationId;
  return id && typeof id === "string" ? id : null;
}

export async function setCurrentQualificationId(
  ownerUid: string,
  qualificationId: string
): Promise<void> {
  const root = rootCol(ownerUid);
  if (!root) {
    memoryCurrent.set(ownerUid, qualificationId);
    return;
  }
  await root.doc(CURRENT_EPOCH_DOC).set(
    { qualificationId, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function loadGhShadowEpoch(
  ownerUid: string,
  qualificationId?: string
): Promise<GhShadowQualificationEpoch | null> {
  const id = qualificationId ?? (await getCurrentQualificationId(ownerUid));
  if (!id || id === CURRENT_EPOCH_DOC) return null;
  const doc = epochDoc(ownerUid, id);
  if (!doc) return bucket(ownerUid, id)?.epoch ?? null;
  const snap = await doc.get();
  return snap.exists ? (snap.data() as GhShadowQualificationEpoch) : null;
}

export async function saveGhShadowEpoch(
  ownerUid: string,
  epoch: GhShadowQualificationEpoch
): Promise<void> {
  const doc = epochDoc(ownerUid, epoch.qualificationId);
  if (!doc) {
    ensureBucket(ownerUid, epoch);
    memoryCurrent.set(ownerUid, epoch.qualificationId);
    return;
  }
  await doc.set(epoch, { merge: true });
  await setCurrentQualificationId(ownerUid, epoch.qualificationId);
}

export async function upsertGhShadowTrade(
  ownerUid: string,
  trade: GhShadowTrade
): Promise<void> {
  const doc = epochDoc(ownerUid, trade.qualificationId);
  if (!doc) {
    const b = bucket(ownerUid, trade.qualificationId);
    if (b) b.trades.set(trade.tradeId, trade);
    return;
  }
  await doc.collection("trades").doc(trade.tradeId).set(trade, { merge: true });
}

export async function listGhShadowTrades(
  ownerUid: string,
  opts?: {
    qualificationId?: string;
    formalOnly?: boolean;
    limit?: number;
  }
): Promise<GhShadowTrade[]> {
  const limit = Math.min(2000, Math.max(1, opts?.limit ?? 500));
  const qid =
    opts?.qualificationId ?? (await getCurrentQualificationId(ownerUid));
  if (!qid) return [];

  const doc = epochDoc(ownerUid, qid);
  let rows: GhShadowTrade[];
  if (!doc) {
    rows = [...(bucket(ownerUid, qid)?.trades.values() ?? [])];
  } else {
    try {
      const snap = await doc
        .collection("trades")
        .orderBy("signalTs", "desc")
        .limit(limit)
        .get();
      rows = snap.docs.map((d) => d.data() as GhShadowTrade);
    } catch {
      const snap = await doc.collection("trades").limit(limit).get();
      rows = snap.docs.map((d) => d.data() as GhShadowTrade);
    }
  }

  rows = rows.filter((t) => t.qualificationId === qid);

  if (opts?.formalOnly) {
    rows = rows.filter(
      (t) =>
        t.dataQuality === "FORMAL_ELIGIBLE" &&
        t.status === "CLOSED" &&
        t.entryPrice != null &&
        t.entryPrice > 0
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
  const doc = epochDoc(ownerUid, decision.qualificationId);
  if (!doc) {
    const b = bucket(ownerUid, decision.qualificationId);
    if (b) {
      b.decisions.push(decision);
      if (b.decisions.length > 5000) {
        b.decisions.splice(0, b.decisions.length - 5000);
      }
    }
    return;
  }
  await doc.collection("decisions").doc(decision.decisionId).set(decision);
}

export async function listGhShadowDecisions(
  ownerUid: string,
  opts?: { qualificationId?: string; limit?: number }
): Promise<GhShadowDecisionRecord[]> {
  const n = Math.min(5000, Math.max(1, opts?.limit ?? 2000));
  const qid =
    opts?.qualificationId ?? (await getCurrentQualificationId(ownerUid));
  if (!qid) return [];
  const doc = epochDoc(ownerUid, qid);
  if (!doc) {
    return (bucket(ownerUid, qid)?.decisions ?? [])
      .filter((d) => d.qualificationId === qid)
      .slice(-n);
  }
  try {
    const snap = await doc
      .collection("decisions")
      .orderBy("at", "asc")
      .limit(n)
      .get();
    return snap.docs
      .map((d) => d.data() as GhShadowDecisionRecord)
      .filter((d) => d.qualificationId === qid);
  } catch {
    const snap = await doc.collection("decisions").limit(n).get();
    return snap.docs
      .map((d) => d.data() as GhShadowDecisionRecord)
      .filter((d) => d.qualificationId === qid);
  }
}

export async function appendGhShadowCapturedEvent(
  ownerUid: string,
  event: GhShadowCapturedEvent
): Promise<void> {
  const doc = epochDoc(ownerUid, event.qualificationId);
  if (!doc) {
    const b = bucket(ownerUid, event.qualificationId);
    if (b) {
      b.events.push(event);
      if (b.events.length > 50_000) {
        b.events.splice(0, b.events.length - 50_000);
      }
    }
    return;
  }
  await doc.collection("events").doc(event.eventId).set(event);
}

export async function listGhShadowCapturedEvents(
  ownerUid: string,
  opts?: { qualificationId?: string; limit?: number }
): Promise<GhShadowCapturedEvent[]> {
  const n = Math.min(50_000, Math.max(1, opts?.limit ?? 10_000));
  const qid =
    opts?.qualificationId ?? (await getCurrentQualificationId(ownerUid));
  if (!qid) return [];
  const doc = epochDoc(ownerUid, qid);
  if (!doc) {
    return (bucket(ownerUid, qid)?.events ?? [])
      .filter((e) => e.qualificationId === qid)
      .sort((a, b) => a.receiveSeq - b.receiveSeq)
      .slice(0, n);
  }
  try {
    const snap = await doc
      .collection("events")
      .orderBy("receiveSeq", "asc")
      .limit(n)
      .get();
    return snap.docs
      .map((d) => d.data() as GhShadowCapturedEvent)
      .filter((e) => e.qualificationId === qid);
  } catch {
    const snap = await doc.collection("events").limit(n).get();
    return snap.docs
      .map((d) => d.data() as GhShadowCapturedEvent)
      .filter((e) => e.qualificationId === qid)
      .sort((a, b) => a.receiveSeq - b.receiveSeq);
  }
}
