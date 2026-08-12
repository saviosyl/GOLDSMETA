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

/**
 * Find started qualification docs for the same Demo account under a different UID.
 * Used to surface QUALIFICATION ACCOUNT MISMATCH instead of a silent 0/20 restart.
 */
export async function findForeignStartedQualifications(
  uid: string,
  accountId: string | number | null | undefined
): Promise<ForeignQualificationHit[]> {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return [];
  try {
    const snap = await getFirestore()
      .collectionGroup("autotradeQualification")
      .limit(80)
      .get();
    const hits: ForeignQualificationHit[] = [];
    for (const doc of snap.docs) {
      const pathUid = doc.ref.path.split("/")[1];
      if (!pathUid || pathUid === uid) continue;
      const data = doc.data() as Record<string, unknown>;
      const docAccount =
        normalizeAccountId((data.accountId as string | number | undefined) ?? doc.id) ??
        doc.id;
      if (docAccount !== normalized) continue;
      const startedAt =
        typeof data.startedAt === "string" && data.startedAt.trim()
          ? data.startedAt
          : null;
      if (!startedAt) continue;
      hits.push({
        uid: pathUid,
        accountId: docAccount,
        state: (data.state as string) || "UNKNOWN",
        startedAt,
        accountMasked:
          typeof data.accountMasked === "string" ? data.accountMasked : null
      });
    }
    return hits;
  } catch {
    return [];
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
  return {
    uid: args.uid,
    accountId: args.accountId,
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

export { FieldValue, QUALIFICATION_GATES };
