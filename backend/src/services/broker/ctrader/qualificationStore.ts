/**
 * Firestore persistence for AutoTrade qualification.
 * Path: users/{uid}/autotradeQualification/{accountId}
 * Pointer: users/{uid}/autotradeQualificationMeta/current
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type {
  ControlledDemoTradeRecord,
  DemoAutoTradeRecord,
  QualificationDocument,
  QualificationPreviewRecord,
  QualificationState,
  QualificationTransition,
  SafetyCheckRecord
} from "./qualificationTypes";
import { QUALIFICATION_GATES } from "./qualificationTypes";

/** Normalize cTrader account ids so number/string forms share one document key. */
export function normalizeAccountId(
  accountId: string | number | null | undefined
): string | null {
  if (accountId == null) return null;
  const s = String(accountId).trim();
  return s.length ? s : null;
}

function docRef(uid: string, accountId: string) {
  const id = normalizeAccountId(accountId);
  if (!id) {
    throw new Error("QUALIFICATION_ACCOUNT_ID_REQUIRED");
  }
  return getFirestore().doc(`users/${uid}/autotradeQualification/${id}`);
}

function metaRef(uid: string) {
  return getFirestore().doc(`users/${uid}/autotradeQualificationMeta/current`);
}

export type ForeignQualificationHit = {
  uid: string;
  accountId: string;
  state: string;
  startedAt: string;
  accountMasked: string | null;
};

export type ForeignLookupResult =
  | { ok: true; hits: ForeignQualificationHit[] }
  | {
      ok: false;
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE";
      message: string;
    };

function hitFromDoc(
  pathUid: string,
  docId: string,
  data: Record<string, unknown>
): ForeignQualificationHit | null {
  const docAccount =
    normalizeAccountId((data.accountId as string | number | undefined) ?? docId) ??
    docId;
  const startedAt =
    typeof data.startedAt === "string" && data.startedAt.trim()
      ? data.startedAt
      : null;
  if (!startedAt) return null;
  return {
    uid: pathUid,
    accountId: docAccount,
    state: (data.state as string) || "UNKNOWN",
    startedAt,
    accountMasked:
      typeof data.accountMasked === "string" ? data.accountMasked : null
  };
}

/**
 * Find started qualification docs for the same Demo account under a different UID.
 * Exact accountId query — never an arbitrary first-N scan.
 * Failures are returned as ok:false (callers must not treat as "no conflict").
 */
export async function findForeignStartedQualifications(
  uid: string,
  accountId: string | number | null | undefined
): Promise<ForeignLookupResult> {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return { ok: true, hits: [] };

  try {
    const db = getFirestore();
    // Query string form (canonical). Also query numeric form for historical docs.
    const queries = [
      db
        .collectionGroup("autotradeQualification")
        .where("accountId", "==", normalized)
        .limit(10)
    ];
    if (/^\d+$/.test(normalized)) {
      const asNum = Number(normalized);
      if (Number.isSafeInteger(asNum)) {
        queries.push(
          db
            .collectionGroup("autotradeQualification")
            .where("accountId", "==", asNum)
            .limit(10)
        );
      }
    }

    const snaps = await Promise.all(queries.map((q) => q.get()));
    const byUid = new Map<string, ForeignQualificationHit>();
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        const pathUid = doc.ref.path.split("/")[1];
        if (!pathUid || pathUid === uid) continue;
        const hit = hitFromDoc(pathUid, doc.id, (doc.data() ?? {}) as Record<string, unknown>);
        if (hit) byUid.set(pathUid, hit);
      }
    }
    return { ok: true, hits: [...byUid.values()] };
  } catch (err) {
    return {
      ok: false,
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE",
      message:
        err instanceof Error
          ? err.message
          : "Qualification ownership lookup failed"
    };
  }
}

export function emptySafetyChecks(_nowIso: string): SafetyCheckRecord[] {
  const checks: SafetyCheckRecord[] = [
    {
      id: "emergency_stop",
      label: "Emergency Stop behaviour verified",
      ok: false,
      source: "SYSTEM_CERTIFIED",
      detail: "Pending account readiness",
      verifiedAt: null
    },
    {
      id: "daily_loss_lock",
      label: "Daily loss lock verified",
      ok: false,
      source: "SYSTEM_CERTIFIED",
      detail: "Pending risk settings",
      verifiedAt: null
    },
    {
      id: "duplicate_order_protection",
      label: "Duplicate-order protection verified",
      ok: false,
      source: "SYSTEM_CERTIFIED",
      detail: "Pending",
      verifiedAt: null
    },
    {
      id: "restart_recovery",
      label: "Restart/recovery verified",
      ok: false,
      source: "SYSTEM_CERTIFIED",
      detail: "Pending connection health",
      verifiedAt: null
    },
    {
      id: "stale_quote_spread_guards",
      label: "Stale quote/spread guards verified",
      ok: false,
      source: "SYSTEM_CERTIFIED",
      detail: "Pending",
      verifiedAt: null
    },
    {
      id: "sl_risk_sizing",
      label: "SL / risk sizing protection verified",
      ok: false,
      source: "SYSTEM_CERTIFIED",
      detail: "Pending",
      verifiedAt: null
    }
  ];
  return checks;
}

export function createEmptyQualificationDoc(args: {
  uid: string;
  accountId: string;
  accountMasked: string | null;
  buildSha?: string | null;
}): QualificationDocument {
  const now = new Date().toISOString();
  const accountId = normalizeAccountId(args.accountId) ?? String(args.accountId);
  return {
    uid: args.uid,
    accountId,
    accountMasked: args.accountMasked,
    environment: "DEMO",
    state: "READY_TO_QUALIFY",
    pausedFrom: null,
    startedAt: null,
    updatedAt: now,
    previewCount: 0,
    previewSignalIds: [],
    previews: [],
    controlledTradeCount: 0,
    controlledBlockedAttempts: 0,
    controlledOpenCount: 0,
    controlledTrades: [],
    firstControlledDemoTradeAt: null,
    demoAutoEnabledAt: null,
    firstDemoAutoTradeAt: null,
    demoAutoTradeCount: 0,
    demoAutoTrades: [],
    criticalSafetyFailures: 0,
    safetyChecks: emptySafetyChecks(now),
    transitions: [],
    lastError: null,
    buildSha: args.buildSha ?? null
  };
}

function normalize(raw: Record<string, unknown>, uid: string, accountId: string): QualificationDocument {
  const base = createEmptyQualificationDoc({
    uid,
    accountId,
    accountMasked: (raw.accountMasked as string | null) ?? null,
    buildSha: (raw.buildSha as string | null) ?? null
  });
  return {
    ...base,
    ...raw,
    uid,
    accountId,
    environment: "DEMO",
    previewSignalIds: Array.isArray(raw.previewSignalIds)
      ? (raw.previewSignalIds as unknown[]).map((v) => String(v))
      : [],
    previews: Array.isArray(raw.previews)
      ? (raw.previews as QualificationPreviewRecord[])
      : [],
    controlledTrades: Array.isArray(raw.controlledTrades)
      ? (raw.controlledTrades as ControlledDemoTradeRecord[])
      : [],
    demoAutoTrades: Array.isArray(raw.demoAutoTrades)
      ? (raw.demoAutoTrades as DemoAutoTradeRecord[])
      : [],
    safetyChecks: Array.isArray(raw.safetyChecks)
      ? (raw.safetyChecks as SafetyCheckRecord[])
      : emptySafetyChecks(new Date().toISOString()),
    transitions: Array.isArray(raw.transitions)
      ? (raw.transitions as QualificationTransition[])
      : [],
    state: (raw.state as QualificationState) || "READY_TO_QUALIFY"
  };
}

export async function getQualificationDoc(
  uid: string,
  accountId: string
): Promise<QualificationDocument | null> {
  const id = normalizeAccountId(accountId);
  if (!id) return null;
  const snap = await docRef(uid, id).get();
  if (!snap.exists) return null;
  return normalize(snap.data() ?? {}, uid, id);
}

export async function getActiveQualificationAccountId(uid: string): Promise<string | null> {
  const snap = await metaRef(uid).get();
  if (!snap.exists) return null;
  return normalizeAccountId(snap.data()?.accountId as string | number | undefined);
}

export async function setActiveQualificationAccount(
  uid: string,
  accountId: string,
  accountMasked: string | null
): Promise<void> {
  const id = normalizeAccountId(accountId);
  if (!id) return;
  await metaRef(uid).set(
    {
      accountId: id,
      accountMasked,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function saveQualificationDoc(doc: QualificationDocument): Promise<void> {
  const accountId = normalizeAccountId(doc.accountId);
  if (!accountId) {
    throw new Error("QUALIFICATION_ACCOUNT_ID_REQUIRED");
  }
  const payload = {
    ...doc,
    accountId,
    updatedAt: new Date().toISOString()
  };
  await docRef(doc.uid, accountId).set(payload, { merge: true });
  await setActiveQualificationAccount(doc.uid, accountId, doc.accountMasked);
}

/**
 * Increment the reject counter without rewriting trade arrays.
 * Concurrent FAST fills must not be clobbered by a later blocked-attempt save.
 */
export async function incrementQualificationBlockedAttempts(
  uid: string,
  accountId: string | number | null | undefined,
  extras?: { lastError?: string | null }
): Promise<void> {
  const id = normalizeAccountId(accountId);
  if (!id) return;
  try {
    await docRef(uid, id).set(
      {
        controlledBlockedAttempts: FieldValue.increment(1),
        updatedAt: new Date().toISOString(),
        ...(extras?.lastError != null ? { lastError: extras.lastError } : {})
      },
      { merge: true }
    );
  } catch {
    /* best-effort counter — never block fill persistence */
  }
}

export async function appendTransition(
  doc: QualificationDocument,
  to: QualificationState,
  reason: string,
  buildSha?: string | null
): Promise<QualificationDocument> {
  if (doc.state === to) return doc;
  const transition: QualificationTransition = {
    at: new Date().toISOString(),
    from: doc.state,
    to,
    reason,
    buildSha: buildSha ?? doc.buildSha ?? null
  };
  const next: QualificationDocument = {
    ...doc,
    state: to,
    transitions: [...doc.transitions, transition].slice(-40),
    updatedAt: transition.at,
    buildSha: buildSha ?? doc.buildSha
  };
  return next;
}

/** Idempotent preview record — returns null if signal already counted. */
export function tryAddPreview(
  doc: QualificationDocument,
  preview: QualificationPreviewRecord
): QualificationDocument | null {
  if (doc.previewSignalIds.includes(preview.signalId)) return null;
  if (doc.previewCount >= QUALIFICATION_GATES.requiredPreviews) return null;
  return {
    ...doc,
    previewCount: doc.previewCount + 1,
    previewSignalIds: [...doc.previewSignalIds, preview.signalId].slice(-200),
    previews: [...doc.previews, preview].slice(-100),
    updatedAt: new Date().toISOString()
  };
}

export function recountControlled(doc: QualificationDocument): QualificationDocument {
  const counted = doc.controlledTrades.filter((t) => t.counted && t.status === "CLOSED");
  const open = doc.controlledTrades.filter(
    (t) => t.status === "OPEN" || t.status === "SUBMITTED"
  ).length;
  return {
    ...doc,
    controlledTradeCount: counted.length,
    controlledOpenCount: open
  };
}

export function recountDemoAuto(doc: QualificationDocument): QualificationDocument {
  const counted = doc.demoAutoTrades.filter((t) => t.counted && t.status === "CLOSED");
  return {
    ...doc,
    demoAutoTradeCount: counted.length
  };
}

export function qualificationTradeKeysMatch(
  existing: { signalId?: string | null; correlationId?: string | null; brokerOrderId?: string | null; brokerPositionId?: string | null; clientOrderId?: string | null },
  incoming: { signalId?: string | null; correlationId?: string | null; brokerOrderId?: string | null; brokerPositionId?: string | null; clientOrderId?: string | null }
): boolean {
  if (incoming.correlationId && existing.correlationId === incoming.correlationId) return true;
  if (incoming.signalId && existing.signalId === incoming.signalId) return true;
  if (incoming.brokerPositionId && existing.brokerPositionId === incoming.brokerPositionId) return true;
  if (incoming.brokerOrderId && existing.brokerOrderId === incoming.brokerOrderId) return true;
  if (incoming.clientOrderId && existing.clientOrderId === incoming.clientOrderId) return true;
  return false;
}

function preferEconomic(
  current: number | null | undefined,
  incoming: number | null | undefined
): number | null | undefined {
  if (incoming === 0) return current === 0 ? null : current;
  if (incoming != null) return incoming;
  if (current === 0) return null;
  return current;
}

export function mergeQualificationOpenTrade<
  T extends ControlledDemoTradeRecord | DemoAutoTradeRecord
>(existing: T, incoming: T): T {
  const existingDemo = existing as DemoAutoTradeRecord;
  const incomingDemo = incoming as DemoAutoTradeRecord;
  return {
    ...existing,
    ...incoming,
    entry: preferEconomic(existing.entry, incoming.entry) ?? null,
    lots: preferEconomic(existing.lots, incoming.lots) ?? null,
    fillPrice: preferEconomic(existingDemo.fillPrice, incomingDemo.fillPrice) ?? null,
    filledVolumeLots:
      preferEconomic(existingDemo.filledVolumeLots, incomingDemo.filledVolumeLots) ??
      null,
    brokerOrderId: existing.brokerOrderId ?? incoming.brokerOrderId,
    brokerPositionId: existing.brokerPositionId ?? incoming.brokerPositionId,
    clientOrderId: existingDemo.clientOrderId ?? incomingDemo.clientOrderId,
    correlationId: existing.correlationId || incoming.correlationId
  };
}

export function applyQualificationOpenTrade(
  doc: QualificationDocument,
  trade: ControlledDemoTradeRecord | DemoAutoTradeRecord,
  bucket: "controlled" | "demoAuto"
): QualificationDocument {
  if (bucket === "controlled") {
    const idx = doc.controlledTrades.findIndex((t) =>
      qualificationTradeKeysMatch(t, trade)
    );
    const next =
      idx >= 0
        ? doc.controlledTrades.map((t, i) =>
            i === idx
              ? mergeQualificationOpenTrade(t, trade as ControlledDemoTradeRecord)
              : t
          )
        : [...doc.controlledTrades, trade as ControlledDemoTradeRecord];
    return recountControlled({
      ...doc,
      controlledTrades: next,
      firstControlledDemoTradeAt: doc.firstControlledDemoTradeAt ?? trade.at
    });
  }
  const idx = doc.demoAutoTrades.findIndex((t) =>
    qualificationTradeKeysMatch(t, trade)
  );
  const next =
    idx >= 0
      ? doc.demoAutoTrades.map((t, i) =>
          i === idx ? mergeQualificationOpenTrade(t, trade as DemoAutoTradeRecord) : t
        )
      : [...doc.demoAutoTrades, trade as DemoAutoTradeRecord];
  return recountDemoAuto({
    ...doc,
    demoAutoTrades: next,
    firstDemoAutoTradeAt: doc.firstDemoAutoTradeAt ?? trade.at
  });
}

/**
 * Transactional open-trade write. One confirmed FAST fill → one record.
 * Concurrent reject increments cannot clobber the new trade array.
 */
export async function upsertQualificationOpenTrade(args: {
  uid: string;
  accountId: string;
  trade: ControlledDemoTradeRecord | DemoAutoTradeRecord;
  bucket: "controlled" | "demoAuto";
}): Promise<QualificationDocument | null> {
  const accountId = normalizeAccountId(args.accountId);
  if (!accountId) return null;
  const ref = docRef(args.uid, accountId);
  try {
    return await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const current = normalize(snap.data() ?? {}, args.uid, accountId);
      const next = applyQualificationOpenTrade(current, args.trade, args.bucket);
      tx.set(
        ref,
        { ...next, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return next;
    });
  } catch {
    const current = await getQualificationDoc(args.uid, accountId);
    if (!current) return null;
    const next = applyQualificationOpenTrade(current, args.trade, args.bucket);
    await saveQualificationDoc(next);
    return next;
  }
}

export { FieldValue, QUALIFICATION_GATES };
