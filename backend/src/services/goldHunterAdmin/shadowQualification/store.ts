/**
 * Epoch-isolated persistence for shadow qualification.
 *
 * Path:
 *   users/{ownerUid}/goldHunterShadowQualification/{qualificationId}
 *     /trades | /events | /decisions
 *   users/{ownerUid}/goldHunterShadowQualification/__currentEpoch  (pointer)
 */
import type { Firestore } from "firebase-admin/firestore";
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

/** Test override — forces Firestore path (e.g. emulator) instead of memory. */
let firestoreOverrideForTests: Firestore | null = null;

/**
 * Test hook: runs AFTER the patch transaction/memory read of the epoch,
 * BEFORE replay fields are committed. Used to inject ACK=N+1 for TOCTOU proof.
 */
let replayPatchAfterReadHookForTests:
  | ((ctx: {
      ownerUid: string;
      qualificationId: string;
      expectedEvents: number;
      persistAcknowledgedEvents: number;
    }) => void | Promise<void>)
  | null = null;

export function useGhShadowFirestoreForTests(db: Firestore | null): void {
  firestoreOverrideForTests = db;
}

export function setGhShadowReplayPatchAfterReadHookForTests(
  hook:
    | ((ctx: {
        ownerUid: string;
        qualificationId: string;
        expectedEvents: number;
        persistAcknowledgedEvents: number;
      }) => void | Promise<void>)
    | null
): void {
  replayPatchAfterReadHookForTests = hook;
}

export function resetGhShadowQualificationMemoryForTests(): void {
  memoryCurrent.clear();
  memoryEpochs.clear();
  replayPatchAfterReadHookForTests = null;
  // Do not clear firestoreOverrideForTests here — emulator suites manage it.
}

function resolveFirestore(): Firestore | null {
  return firestoreOverrideForTests ?? getFirestoreDb();
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
  const db = resolveFirestore();
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

export async function loadGhShadowTrade(
  ownerUid: string,
  tradeId: string,
  qualificationId?: string
): Promise<GhShadowTrade | null> {
  const qid =
    qualificationId ?? (await getCurrentQualificationId(ownerUid));
  if (!qid) return null;
  const doc = epochDoc(ownerUid, qid);
  if (!doc) {
    return bucket(ownerUid, qid)?.trades.get(tradeId) ?? null;
  }
  const snap = await doc.collection("trades").doc(tradeId).get();
  return snap.exists ? (snap.data() as GhShadowTrade) : null;
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
  // Idempotent upsert by decisionId (retries must not duplicate).
  if (!doc) {
    const b = bucket(ownerUid, decision.qualificationId);
    if (b) {
      const idx = b.decisions.findIndex((d) => d.decisionId === decision.decisionId);
      if (idx >= 0) b.decisions[idx] = decision;
      else b.decisions.push(decision);
    }
    return;
  }
  await doc.collection("decisions").doc(decision.decisionId).set(decision);
}

export async function listGhShadowDecisions(
  ownerUid: string,
  opts?: { qualificationId?: string; limit?: number }
): Promise<GhShadowDecisionRecord[]> {
  // Legacy bounded helper for status/UI. Formal replay must use
  // listAllGhShadowDecisions (paginated, no silent 2000 ceiling).
  const n = Math.min(5000, Math.max(1, opts?.limit ?? 2000));
  const all = await listAllGhShadowDecisions(ownerUid, {
    qualificationId: opts?.qualificationId,
    pageSize: Math.min(5_000, n)
  });
  return all.slice(0, n);
}

export type GhShadowDecisionPageCursor = {
  receiveSeq: number;
  decisionId: string;
};

function decisionSortKey(d: GhShadowDecisionRecord): string {
  return `${String(d.receiveSeq).padStart(16, "0")}:${d.decisionId}`;
}

/**
 * One page of decisions ordered by (receiveSeq, decisionId).
 * Deterministic pagination — no silent 2000 ceiling for formal replay markers.
 */
export async function listGhShadowDecisionsPage(
  ownerUid: string,
  opts: {
    qualificationId?: string;
    pageSize?: number;
    startAfter?: GhShadowDecisionPageCursor | null;
    /** When set, only these kinds are returned (still paginated over full set). */
    kinds?: Array<GhShadowDecisionRecord["kind"]>;
  }
): Promise<{
  decisions: GhShadowDecisionRecord[];
  nextCursor: GhShadowDecisionPageCursor | null;
}> {
  const pageSize = Math.max(1, Math.min(10_000, opts.pageSize ?? 5_000));
  const qid =
    opts.qualificationId ?? (await getCurrentQualificationId(ownerUid));
  if (!qid) return { decisions: [], nextCursor: null };

  const after = opts.startAfter ?? null;
  const kindSet =
    opts.kinds && opts.kinds.length > 0 ? new Set(opts.kinds) : null;
  const doc = epochDoc(ownerUid, qid);

  const filterRow = (d: GhShadowDecisionRecord) =>
    d.qualificationId === qid && (kindSet == null || kindSet.has(d.kind));

  if (!doc) {
    let rows = (bucket(ownerUid, qid)?.decisions ?? [])
      .filter(filterRow)
      .sort((a, b) => decisionSortKey(a).localeCompare(decisionSortKey(b)));
    if (after) {
      const afterKey = `${String(after.receiveSeq).padStart(16, "0")}:${after.decisionId}`;
      rows = rows.filter((d) => decisionSortKey(d) > afterKey);
    }
    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    return {
      decisions: page,
      nextCursor:
        page.length === pageSize && last
          ? { receiveSeq: last.receiveSeq, decisionId: last.decisionId }
          : null
    };
  }

  // Firestore may lack composite index; load + sort + page for determinism.
  try {
    const snap = await doc.collection("decisions").get();
    let rows = snap.docs
      .map((d) => d.data() as GhShadowDecisionRecord)
      .filter(filterRow)
      .sort((a, b) => decisionSortKey(a).localeCompare(decisionSortKey(b)));
    if (after) {
      const afterKey = `${String(after.receiveSeq).padStart(16, "0")}:${after.decisionId}`;
      rows = rows.filter((d) => decisionSortKey(d) > afterKey);
    }
    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    return {
      decisions: page,
      nextCursor:
        page.length === pageSize && last
          ? { receiveSeq: last.receiveSeq, decisionId: last.decisionId }
          : null
    };
  } catch {
    return { decisions: [], nextCursor: null };
  }
}

/** Retrieve ALL decisions via deterministic pagination (no 2000 ceiling). */
export async function listAllGhShadowDecisions(
  ownerUid: string,
  opts?: {
    qualificationId?: string;
    pageSize?: number;
    kinds?: Array<GhShadowDecisionRecord["kind"]>;
    fetchPage?: typeof listGhShadowDecisionsPage;
  }
): Promise<GhShadowDecisionRecord[]> {
  const fetchPage = opts?.fetchPage ?? listGhShadowDecisionsPage;
  const out: GhShadowDecisionRecord[] = [];
  let cursor: GhShadowDecisionPageCursor | null = null;
  for (;;) {
    const page = await fetchPage(ownerUid, {
      qualificationId: opts?.qualificationId,
      pageSize: opts?.pageSize ?? 5_000,
      startAfter: cursor,
      kinds: opts?.kinds
    });
    out.push(...page.decisions);
    if (!page.nextCursor || page.decisions.length === 0) break;
    cursor = page.nextCursor;
  }
  return out;
}

/**
 * All OPEN/EXIT replay markers — paginated, no silent ceiling.
 */
export async function listAllGhShadowReplayMarkerDecisions(
  ownerUid: string,
  opts?: { qualificationId?: string; pageSize?: number }
): Promise<GhShadowDecisionRecord[]> {
  return listAllGhShadowDecisions(ownerUid, {
    qualificationId: opts?.qualificationId,
    pageSize: opts?.pageSize,
    kinds: ["OPEN", "EXIT"]
  });
}

/** Retrieve ALL trades for formal replay (no silent 2000 ceiling). */
export async function listAllGhShadowTrades(
  ownerUid: string,
  opts?: { qualificationId?: string }
): Promise<GhShadowTrade[]> {
  const qid =
    opts?.qualificationId ?? (await getCurrentQualificationId(ownerUid));
  if (!qid) return [];
  const doc = epochDoc(ownerUid, qid);
  let rows: GhShadowTrade[];
  if (!doc) {
    rows = [...(bucket(ownerUid, qid)?.trades.values() ?? [])];
  } else {
    const snap = await doc.collection("trades").get();
    rows = snap.docs.map((d) => d.data() as GhShadowTrade);
  }
  return rows
    .filter((t) => t.qualificationId === qid)
    .sort((a, b) => (a.signalTs ?? "").localeCompare(b.signalTs ?? ""));
}

export type GhShadowReplayPatchCurrency = "CURRENT" | "STALE" | "MISSING";

export type GhShadowReplayPatchResult = {
  currency: GhShadowReplayPatchCurrency;
  writtenStatus: GhShadowQualificationEpoch["lastReplayStatus"] | null;
  epoch: GhShadowQualificationEpoch | null;
  persistAcknowledgedEvents: number | null;
  qualificationId: string | null;
};

const REPLAY_FIELD_KEYS = [
  "lastReplayStatus",
  "lastReplayDetail",
  "updatedAt"
] as const;

function applyReplayFieldsOnly(
  epoch: GhShadowQualificationEpoch,
  status: GhShadowQualificationEpoch["lastReplayStatus"],
  detail: GhShadowQualificationEpoch["lastReplayDetail"]
): void {
  epoch.lastReplayStatus = status;
  epoch.lastReplayDetail = detail ? { ...detail } : null;
  epoch.updatedAt = new Date().toISOString();
}

/**
 * Atomic replay-field finalisation.
 *
 * Firestore: ONE transaction — read epoch, verify qualificationId (+ ACK when
 * requireCurrentAck), then write ONLY lastReplayStatus / lastReplayDetail /
 * updatedAt. Never writes integrity/activity/ACK from a stale snapshot.
 *
 * Memory: equivalent semantics (field-only mutate on the live bucket object;
 * after-read hook can replace the bucket epoch to simulate concurrent ACK).
 */
export async function patchGhShadowEpochReplayFields(
  ownerUid: string,
  args: {
    qualificationId: string;
    /** ACK count the replay was computed against. */
    expectedEvents: number;
    /**
     * When true, LIVE_REPLAY_OK / current writes require
     * persistAcknowledgedEvents === expectedEvents. On mismatch write
     * REPLAY_STALE instead and return currency=STALE.
     */
    requireCurrentAck: boolean;
    lastReplayStatus: GhShadowQualificationEpoch["lastReplayStatus"];
    lastReplayDetail: GhShadowQualificationEpoch["lastReplayDetail"];
  }
): Promise<GhShadowReplayPatchResult> {
  const intendedStatus = args.lastReplayStatus;
  const intendedDetail = args.lastReplayDetail
    ? { ...args.lastReplayDetail }
    : null;

  const doc = epochDoc(ownerUid, args.qualificationId);
  const db = resolveFirestore();

  if (doc && db) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(doc);
      if (!snap.exists) {
        return {
          currency: "MISSING" as const,
          writtenStatus: null,
          epoch: null,
          persistAcknowledgedEvents: null,
          qualificationId: null
        };
      }
      const current = snap.data() as GhShadowQualificationEpoch;
      // NOTE: do NOT await same-document writes here (deadlocks the emulator /
      // transactional lock). Memory path below supports the after-read hook for
      // deterministic TOCTOU injection. Firestore concurrency is enforced by
      // transaction retry on conflicting writes + field-only merge.

      const ack = current.integrity?.persistAcknowledgedEvents ?? -1;
      const qidOk = current.qualificationId === args.qualificationId;
      const ackOk = ack === args.expectedEvents;
      const stillCurrent = qidOk && (!args.requireCurrentAck || ackOk);

      let writtenStatus = intendedStatus;
      let writtenDetail = intendedDetail;
      let currency: GhShadowReplayPatchCurrency = "CURRENT";

      if (!stillCurrent) {
        currency = "STALE";
        writtenStatus = "REPLAY_STALE";
        writtenDetail = {
          capturedEvents: intendedDetail?.capturedEvents ?? 0,
          replayedEvents: intendedDetail?.replayedEvents ?? 0,
          expectedEvents: args.expectedEvents,
          firstDivergenceSeq: null,
          divergenceDetail: `replay_patch_stale expectedAck=${args.expectedEvents} nowAck=${ack} qidOk=${qidOk}`,
          completedAt: new Date().toISOString()
        };
      }

      const updatedAt = new Date().toISOString();
      // FIELD-ONLY write — never pass the full epoch object.
      tx.set(
        doc,
        {
          lastReplayStatus: writtenStatus,
          lastReplayDetail: writtenDetail,
          updatedAt
        },
        { merge: true }
      );

      return {
        currency,
        writtenStatus,
        epoch: {
          ...current,
          lastReplayStatus: writtenStatus,
          lastReplayDetail: writtenDetail,
          updatedAt
        },
        persistAcknowledgedEvents: ack,
        qualificationId: current.qualificationId
      };
    });
  }

  // ---- memory path (equivalent field-only semantics) ----
  const b = bucket(ownerUid, args.qualificationId);
  if (!b) {
    return {
      currency: "MISSING",
      writtenStatus: null,
      epoch: null,
      persistAcknowledgedEvents: null,
      qualificationId: null
    };
  }

  const ackAtRead = b.epoch.integrity.persistAcknowledgedEvents;
  if (replayPatchAfterReadHookForTests) {
    await replayPatchAfterReadHookForTests({
      ownerUid,
      qualificationId: args.qualificationId,
      expectedEvents: args.expectedEvents,
      persistAcknowledgedEvents: ackAtRead
    });
  }

  // Hook may have replaced the bucket epoch with ACK=N+1.
  const live = bucket(ownerUid, args.qualificationId)?.epoch;
  if (!live) {
    return {
      currency: "MISSING",
      writtenStatus: null,
      epoch: null,
      persistAcknowledgedEvents: null,
      qualificationId: null
    };
  }

  const ack = live.integrity.persistAcknowledgedEvents;
  const qidOk = live.qualificationId === args.qualificationId;
  const ackOk = ack === args.expectedEvents;
  const stillCurrent = qidOk && (!args.requireCurrentAck || ackOk);

  let writtenStatus = intendedStatus;
  let writtenDetail = intendedDetail;
  let currency: GhShadowReplayPatchCurrency = "CURRENT";

  if (!stillCurrent) {
    currency = "STALE";
    writtenStatus = "REPLAY_STALE";
    writtenDetail = {
      capturedEvents: intendedDetail?.capturedEvents ?? 0,
      replayedEvents: intendedDetail?.replayedEvents ?? 0,
      expectedEvents: args.expectedEvents,
      firstDivergenceSeq: null,
      divergenceDetail: `replay_patch_stale expectedAck=${args.expectedEvents} nowAck=${ack} qidOk=${qidOk}`,
      completedAt: new Date().toISOString()
    };
  }

  // Mutate ONLY replay fields on the live object — never replace integrity.
  applyReplayFieldsOnly(live, writtenStatus, writtenDetail);
  void REPLAY_FIELD_KEYS;

  return {
    currency,
    writtenStatus,
    epoch: live,
    persistAcknowledgedEvents: live.integrity.persistAcknowledgedEvents,
    qualificationId: live.qualificationId
  };
}

export async function appendGhShadowCapturedEvent(
  ownerUid: string,
  event: GhShadowCapturedEvent
): Promise<void> {
  const doc = epochDoc(ownerUid, event.qualificationId);
  if (!doc) {
    const b = bucket(ownerUid, event.qualificationId);
    if (b) {
      // Idempotent upsert by eventId (retries must not duplicate).
      const idx = b.events.findIndex((e) => e.eventId === event.eventId);
      if (idx >= 0) b.events[idx] = event;
      else b.events.push(event);
    }
    return;
  }
  await doc.collection("events").doc(event.eventId).set(event);
}

export type GhShadowEventPageCursor = {
  receiveSeq: number;
  eventId: string;
};

/**
 * One page of captured events ordered by (receiveSeq, eventId).
 * Deterministic pagination — no fixed 50k ceiling for formal completeness.
 */
export async function listGhShadowCapturedEventsPage(
  ownerUid: string,
  opts: {
    qualificationId?: string;
    pageSize?: number;
    startAfter?: GhShadowEventPageCursor | null;
  }
): Promise<{
  events: GhShadowCapturedEvent[];
  nextCursor: GhShadowEventPageCursor | null;
}> {
  const pageSize = Math.max(1, Math.min(10_000, opts.pageSize ?? 5_000));
  const qid =
    opts.qualificationId ?? (await getCurrentQualificationId(ownerUid));
  if (!qid) return { events: [], nextCursor: null };

  const after = opts.startAfter ?? null;
  const doc = epochDoc(ownerUid, qid);

  const sortKey = (e: GhShadowCapturedEvent) =>
    `${String(e.receiveSeq).padStart(16, "0")}:${e.eventId}`;

  if (!doc) {
    let rows = (bucket(ownerUid, qid)?.events ?? [])
      .filter((e) => e.qualificationId === qid)
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    if (after) {
      const afterKey = `${String(after.receiveSeq).padStart(16, "0")}:${after.eventId}`;
      rows = rows.filter((e) => sortKey(e) > afterKey);
    }
    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    return {
      events: page,
      nextCursor:
        page.length === pageSize && last
          ? { receiveSeq: last.receiveSeq, eventId: last.eventId }
          : null
    };
  }

  try {
    let q = doc
      .collection("events")
      .orderBy("receiveSeq", "asc")
      .orderBy("eventId", "asc")
      .limit(pageSize) as {
      startAfter: (...args: unknown[]) => typeof q;
      get: () => Promise<{ docs: Array<{ data: () => unknown }> }>;
    };
    if (after) {
      q = q.startAfter(after.receiveSeq, after.eventId);
    }
    const snap = await q.get();
    const events = snap.docs
      .map((d) => d.data() as GhShadowCapturedEvent)
      .filter((e) => e.qualificationId === qid);
    const last = events[events.length - 1];
    return {
      events,
      nextCursor:
        events.length === pageSize && last
          ? { receiveSeq: last.receiveSeq, eventId: last.eventId }
          : null
    };
  } catch {
    // Fallback: load + sort in memory (still pages via cursor filter).
    const snap = await doc.collection("events").get();
    let rows = snap.docs
      .map((d) => d.data() as GhShadowCapturedEvent)
      .filter((e) => e.qualificationId === qid)
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    if (after) {
      const afterKey = `${String(after.receiveSeq).padStart(16, "0")}:${after.eventId}`;
      rows = rows.filter((e) => sortKey(e) > afterKey);
    }
    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    return {
      events: page,
      nextCursor:
        page.length === pageSize && last
          ? { receiveSeq: last.receiveSeq, eventId: last.eventId }
          : null
    };
  }
}

/** Retrieve ALL captured events via deterministic pagination (no 50k ceiling). */
export async function listAllGhShadowCapturedEvents(
  ownerUid: string,
  opts?: {
    qualificationId?: string;
    pageSize?: number;
    /** Test/mock hook: override page fetcher. */
    fetchPage?: typeof listGhShadowCapturedEventsPage;
  }
): Promise<GhShadowCapturedEvent[]> {
  const fetchPage = opts?.fetchPage ?? listGhShadowCapturedEventsPage;
  const out: GhShadowCapturedEvent[] = [];
  let cursor: GhShadowEventPageCursor | null = null;
  for (;;) {
    const page = await fetchPage(ownerUid, {
      qualificationId: opts?.qualificationId,
      pageSize: opts?.pageSize ?? 5_000,
      startAfter: cursor
    });
    out.push(...page.events);
    if (!page.nextCursor || page.events.length === 0) break;
    cursor = page.nextCursor;
  }
  return out;
}

export async function listGhShadowCapturedEvents(
  ownerUid: string,
  opts?: { qualificationId?: string; limit?: number }
): Promise<GhShadowCapturedEvent[]> {
  // Legacy single-shot helper — prefer listAllGhShadowCapturedEvents for replay.
  const n = Math.max(1, opts?.limit ?? 10_000);
  const all = await listAllGhShadowCapturedEvents(ownerUid, {
    qualificationId: opts?.qualificationId,
    pageSize: Math.min(5_000, n)
  });
  return all.slice(0, n);
}
