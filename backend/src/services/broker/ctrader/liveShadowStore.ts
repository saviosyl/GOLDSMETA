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

export type SignalFreshnessClass = "FRESH_SIGNAL" | "STALE_SIGNAL";

/** Exact ProtoOANewOrderReq-shaped payload that WOULD be sent — never submitted. */
export type CTraderWouldBeOrderPayload = {
  ctidTraderAccountIdMasked: string;
  symbolId: number;
  orderType: 1; // MARKET
  tradeSide: 1 | 2; // BUY=1 SELL=2
  volume: number; // protocol cents
  relativeStopLoss: number | null;
  relativeTakeProfit: number | null;
  clientOrderId: string;
  label: string;
  comment: string;
};

export type LiveShadowWouldSubmitOrder = {
  side: "BUY" | "SELL";
  symbolId: string;
  symbolName: string;
  lots: number;
  volumeUnits: number;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfits: Array<{ label: string; price: number }>;
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
  plannedEntry: number | null;
  slippage: number | null;
  riskAmount: number | null;
  riskPercent: number | null;
  stopDistance: number | null;
  rawLotSize: number | null;
  roundedLotSize: number | null;
  ctraderOrderPayload: CTraderWouldBeOrderPayload | null;
};

export type LiveShadowPlanSnapshot = {
  plannedEntry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  confidence: number | null;
  confidenceLabel: string | null;
  setupScore: number | null;
  generatedAt: string | null;
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
  isCTraderLiveExecutionOwnerApproved: false;
  protoOANewOrderReqCallCount: 0;
  accountMasked: string | null;
  symbolId: string | null;
  symbolName: string | null;
  wouldSubmit: LiveShadowWouldSubmitOrder | null;
  plan: LiveShadowPlanSnapshot | null;
  signalFreshnessClass: SignalFreshnessClass | null;
  decisionTimestamp: string | null;
  quoteTimestamp: string | null;
  executableEntry: number | null;
  calculatedSlippage: number | null;
  maxSlippageAllowed: number | null;
  riskAmount: number | null;
  riskPercent: number | null;
  stopDistance: number | null;
  rawLotSize: number | null;
  roundedLotSize: number | null;
  volumeUnits: number | null;
  marginEligible: boolean | null;
  duplicateCheck: "NEW" | "DUPLICATE" | "UNKNOWN";
  reconcileOk: boolean | null;
  marketOpen: boolean | null;
  passedGates: string[];
  failedGates: string[];
  rejectionReasons: string[];
  balance: number | null;
  equity: number | null;
  freeMargin: number | null;
  usedMargin: number | null;
  currency: string | null;
  leverage: number | null;
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
      const existing = snap.data() as LiveShadowExecutionRecord;
      return {
        created: false,
        record: { ...existing, duplicateCheck: "DUPLICATE" }
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
  limit = 50
): Promise<LiveShadowExecutionRecord[]> {
  const snap = await getFirestore()
    .collection(`users/${ownerUid}/ctraderLiveShadowExecutions`)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as LiveShadowExecutionRecord);
}

export async function listLiveShadowSince(
  ownerUid: string,
  sinceIso: string,
  limit = 100
): Promise<LiveShadowExecutionRecord[]> {
  const snap = await getFirestore()
    .collection(`users/${ownerUid}/ctraderLiveShadowExecutions`)
    .where("createdAt", ">=", sinceIso)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as LiveShadowExecutionRecord);
}
