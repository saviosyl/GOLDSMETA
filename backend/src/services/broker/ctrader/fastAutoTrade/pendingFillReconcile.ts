/**
 * Reconcile a durable FAST claim after ORDER_ACCEPTED / unknown outcome.
 * Never sends ProtoOANewOrderReq. Match is clientOrderId only.
 */

import { getConnection } from "../connectionStore";
import { ensureFreshAccessToken } from "../connectionService";
import { withFastDemoSession } from "./demoSession";
import {
  lookupReconcileByClientOrderId,
  setFastReconcileForTests,
  type ReconcileLookup
} from "./orderReconcile";

export { setFastReconcileForTests };
import {
  listPendingFastExecutionClaims,
  shouldReconcileInsteadOfResubmit,
  updateFastExecutionClaim,
  type FastExecutionClaim
} from "./executionClaimStore";
import {
  getActiveQualificationAccountId,
  getQualificationDoc,
  recountControlled,
  recountDemoAuto,
  saveQualificationDoc
} from "../qualificationStore";
import { createDemoPositionLifecycle } from "../demoPositionLifecycle";
import { FAST_AUTOTRADE_STRATEGY_ID } from "./types";

export type PendingFillReconcileResult = {
  filled: boolean;
  claim: FastExecutionClaim;
  orderId: string | null;
  positionId: string | null;
};

async function loadDemoReconcileSnapshot(ownerUid: string) {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.APP_ENV === "test" ||
    process.env.VITEST === "true"
  ) {
    return null;
  }
  try {
    const connection = await getConnection(ownerUid);
    if (!connection || connection.selectedAccountIsLive) return null;
    const accountId = connection.selectedAccountId;
    const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
    if (!accountId || !clientId || !clientSecret) return null;
    const fresh = await ensureFreshAccessToken(connection);
    return await withFastDemoSession(
      {
        accessToken: fresh.accessToken,
        clientId,
        clientSecret,
        ctidTraderAccountId: String(accountId)
      },
      (session) => session.reconcile()
    );
  } catch {
    return null;
  }
}

export async function lookupFastClientOrder(
  ownerUid: string,
  clientOrderId: string
): Promise<ReconcileLookup> {
  return lookupReconcileByClientOrderId(clientOrderId, async () => {
    const snapshot = await loadDemoReconcileSnapshot(ownerUid);
    return snapshot ?? { orders: [], positions: [] };
  });
}

export async function tryReconcileExistingFastClaim(args: {
  ownerUid: string;
  claim: FastExecutionClaim;
}): Promise<PendingFillReconcileResult> {
  const { ownerUid, claim } = args;
  if (claim.tradeCreated && claim.positionId) {
    return {
      filled: true,
      claim,
      orderId: claim.orderId,
      positionId: claim.positionId
    };
  }
  if (
    claim.positionId &&
    (claim.state === "BROKER_SUBMITTED" ||
      claim.state === "BROKER_TIMEOUT_RECONCILED_FILLED")
  ) {
    return {
      filled: true,
      claim,
      orderId: claim.orderId,
      positionId: claim.positionId
    };
  }
  if (!shouldReconcileInsteadOfResubmit(claim) && !claim.positionId) {
    return {
      filled: false,
      claim,
      orderId: claim.orderId,
      positionId: claim.positionId
    };
  }

  const match = await lookupFastClientOrder(ownerUid, claim.clientOrderId);
  if (match.matched && match.positionId) {
    const next = await updateFastExecutionClaim(ownerUid, claim.signalId, {
      state: "BROKER_TIMEOUT_RECONCILED_FILLED",
      orderId: match.orderId,
      positionId: match.positionId,
      errorCode: null
    });
    return {
      filled: true,
      claim: next ?? { ...claim, positionId: match.positionId, orderId: match.orderId },
      orderId: match.orderId,
      positionId: match.positionId
    };
  }
  return {
    filled: false,
    claim,
    orderId: claim.orderId,
    positionId: null
  };
}

async function appendPromotedOpenTrade(
  ownerUid: string,
  claim: FastExecutionClaim
): Promise<void> {
  if (claim.tradeCreated || !claim.positionId || !claim.pendingOpenSnapshot) return;
  const snap = claim.pendingOpenSnapshot;
  const accountId = await getActiveQualificationAccountId(ownerUid);
  if (!accountId) return;
  const doc = await getQualificationDoc(ownerUid, accountId);
  if (!doc) return;
  const already =
    doc.demoAutoTrades.some((t) => t.signalId === claim.signalId) ||
    doc.controlledTrades.some((t) => t.signalId === claim.signalId);
  if (already) {
    await updateFastExecutionClaim(ownerUid, claim.signalId, { tradeCreated: true });
    return;
  }
  const openedAt = new Date().toISOString();
  const trade = {
    id: `tr_promo_${claim.signalId}`.slice(0, 80),
    correlationId: snap.correlationId,
    signalId: claim.signalId,
    at: openedAt,
    closedAt: null,
    direction: snap.direction,
    entry: snap.entry,
    stopLoss: snap.stopLoss,
    takeProfit: snap.takeProfit,
    lots: snap.lots,
    brokerOrderId: claim.orderId,
    brokerPositionId: claim.positionId,
    requestedVolumeLots: snap.lots,
    filledVolumeLots: null,
    requestedEntry: snap.entry,
    fillPrice: null,
    openTimestamp: openedAt,
    status: "OPEN" as const,
    pnl: null,
    counted: false
  };
  if (doc.state === "CONTROLLED_DEMO_QUALIFICATION") {
    const next = recountControlled({
      ...doc,
      controlledTrades: [...doc.controlledTrades, trade]
    });
    await saveQualificationDoc(next);
  } else {
    const next = recountDemoAuto({
      ...doc,
      demoAutoTrades: [...doc.demoAutoTrades, trade]
    });
    await saveQualificationDoc(next);
  }
  await createDemoPositionLifecycle({
    uid: ownerUid,
    correlationId: snap.correlationId,
    brokerOrderId: claim.orderId,
    brokerPositionId: claim.positionId,
    accountId,
    accountMasked: doc.accountMasked,
    side: snap.direction,
    entry: snap.entry,
    stopLoss: snap.stopLoss,
    takeProfit: snap.takeProfit,
    lots: snap.lots,
    qualificationStage: doc.state,
    decisionId: snap.decisionId,
    source:
      doc.state === "CONTROLLED_DEMO_QUALIFICATION"
        ? "qualification_controlled"
        : "demo_auto",
    openedAt,
    strategyId: FAST_AUTOTRADE_STRATEGY_ID
  }).catch(() => undefined);
  await updateFastExecutionClaim(ownerUid, claim.signalId, {
    tradeCreated: true,
    state: "BROKER_SUBMITTED"
  });
}

export async function promotePendingFastFills(ownerUid: string): Promise<{
  promoted: number;
  stillPending: number;
}> {
  const pending = await listPendingFastExecutionClaims(ownerUid);
  let promoted = 0;
  let stillPending = 0;
  for (const claim of pending) {
    try {
      const result = await tryReconcileExistingFastClaim({ ownerUid, claim });
      if (result.filled) {
        await appendPromotedOpenTrade(ownerUid, result.claim).catch(() => undefined);
        promoted += 1;
      } else stillPending += 1;
    } catch {
      stillPending += 1;
    }
  }
  return { promoted, stillPending };
}
