/**
 * Firestore persistence for Pepperstone LIVE AutoTrade SHADOW evaluations.
 * Never stores tokens, ciphertext, or full account ids.
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { maskAccountId } from "./tokenCrypto";

export type LiveShadowOutcome =
  | "SHADOW_WOULD_SUBMIT"
  | "SHADOW_BLOCKED"
  | "SHADOW_SKIPPED"
  | "SHADOW_DUPLICATE";

export type LiveShadowWouldSubmitOrder = {
  side: "BUY" | "SELL";
  symbolId: string;
  symbolName: string;
  lots: number;
  volumeUnits: number;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  relativeStopLoss: number | null;
  relativeTakeProfit: number | null;
  accountMasked: string;
  environment: "LIVE";
  spread: number | null;
  bid: number | null;
  ask: number | null;
  quoteFreshness: string | null;
  quoteSequence: number | null;
  brokerTimestamp: string | null;
};

export type LiveShadowExecutionRecord = {
  intentKey: string;
  ownerUid: string;
  decisionId: string;
  decision: string;
  confidence: number | null;
  outcome: LiveShadowOutcome;
  mode: "SHADOW";
  liveOrderEndpointCalled: false;
  isCTraderLiveEnabled: false;
  accountMasked: string | null;
  symbolId: string | null;
  symbolName: string | null;
  wouldSubmit: LiveShadowWouldSubmitOrder | null;
  passedGates: string[];
  failedGates: string[];
  rejectionReasons: string[];
  balance: number | null;
  equity: number | null;
  freeMargin: number | null;
  openPositionsCount: number | null;
  pendingOrdersCount: number | null;
  createdAt: string;
  updatedAt: string;
};

function shadowDoc(ownerUid: string, intentKey: string) {
  return getFirestore().doc(
    `users/${ownerUid}/ctraderLiveShadowExecutions/${intentKey}`
  );
}

function auditCol(ownerUid: string) {
  return getFirestore().collection(`users/${ownerUid}/ctraderLiveShadowAudit`);
}

export function maskAccountForShadow(
  accountId: string | null | undefined
): string | null {
  if (!accountId) return null;
  return maskAccountId(accountId);
}

/**
 * Idempotent write: first write wins for a given intentKey.
 * Returns existing record when duplicate.
 */
export async function persistLiveShadowExecution(
  record: LiveShadowExecutionRecord
): Promise<{ created: boolean; record: LiveShadowExecutionRecord }> {
  const ref = shadowDoc(record.ownerUid, record.intentKey);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return {
        created: false,
        record: snap.data() as LiveShadowExecutionRecord
      };
    }
    tx.set(ref, record);
    tx.set(auditCol(record.ownerUid).doc(), {
      ...record,
      auditId: FieldValue.serverTimestamp(),
      auditKind: "LIVE_SHADOW_EVALUATION"
    });
    return { created: true, record };
  });
}

export async function getLiveShadowExecution(
  ownerUid: string,
  intentKey: string
): Promise<LiveShadowExecutionRecord | null> {
  const snap = await shadowDoc(ownerUid, intentKey).get();
  if (!snap.exists) return null;
  return snap.data() as LiveShadowExecutionRecord;
}

export async function listRecentLiveShadowExecutions(
  ownerUid: string,
  limit = 20
): Promise<LiveShadowExecutionRecord[]> {
  const snap = await getFirestore()
    .collection(`users/${ownerUid}/ctraderLiveShadowExecutions`)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as LiveShadowExecutionRecord);
}
