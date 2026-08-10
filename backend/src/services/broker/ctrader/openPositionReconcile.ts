/**
 * Reconcile daily-safety open-position counters with lifecycle + broker reality.
 *
 * Prevents a ghost OPEN counter (order ack recorded, lifecycle missing, broker flat)
 * from permanently blocking Demo Auto via MAX_OPEN_POSITIONS.
 *
 * Ghost clear is recovery only — close accounting must come from broker deals
 * (see demoCloseAccounting), never by inventing CLOSED + null PnL.
 */

import {
  getDailySafetyDoc,
  saveDailySafetyDoc
} from "./dailySafetyStore";
import { listOpenPositionLifecycles } from "./positionLifecycleStore";
import {
  getActiveQualificationAccountId,
  getQualificationDoc,
  saveQualificationDoc
} from "./qualificationStore";
import { reconcileDemoBrokerPositions } from "./demoPositionMutations";
import { getConnection } from "./connectionStore";

export type OpenPositionReconcileResult = {
  before: number;
  after: number;
  lifecycleOpen: number;
  brokerOpen: number | null;
  clearedGhost: boolean;
  brokerChecked: boolean;
  repairAttempted: boolean;
  error: string | null;
};

/**
 * Align demo dailySafety.openPositions with lifecycle docs and, when needed, broker.
 * Fail closed when broker cannot be queried and a positive counter remains ambiguous.
 */
export async function reconcileDemoOpenPositionCounters(
  uid: string
): Promise<OpenPositionReconcileResult> {
  const daily = await getDailySafetyDoc(uid, "demo");
  const lifecycles = await listOpenPositionLifecycles(uid);
  const lifecycleOpen = lifecycles.length;
  const before = daily.openPositions;

  // Lifecycle is authoritative when present.
  if (lifecycleOpen > 0) {
    if (daily.openPositions !== lifecycleOpen) {
      daily.openPositions = lifecycleOpen;
      await saveDailySafetyDoc(daily);
    }
    return {
      before,
      after: daily.openPositions,
      lifecycleOpen,
      brokerOpen: null,
      clearedGhost: false,
      brokerChecked: false,
      repairAttempted: false,
      error: null
    };
  }

  // No lifecycle opens. If counter already 0, still try repair for unaccounted closes.
  if (daily.openPositions <= 0) {
    let repairAttempted = false;
    try {
      const { reconcileClosedTradesWithoutErasingPnl } = await import(
        "./demoCloseAccounting.js"
      );
      await reconcileClosedTradesWithoutErasingPnl(uid);
      repairAttempted = true;
    } catch {
      /* best-effort */
    }
    return {
      before,
      after: 0,
      lifecycleOpen: 0,
      brokerOpen: null,
      clearedGhost: false,
      brokerChecked: false,
      repairAttempted,
      error: null
    };
  }

  // Counter > 0 but no lifecycle — verify broker before clearing (fail closed).
  let brokerOpen: number | null = null;
  try {
    const positions = await reconcileDemoBrokerPositions(uid);
    brokerOpen = positions.length;
  } catch (e) {
    return {
      before,
      after: before,
      lifecycleOpen: 0,
      brokerOpen: null,
      clearedGhost: false,
      brokerChecked: false,
      repairAttempted: false,
      error: e instanceof Error ? e.message : "BROKER_RECONCILE_FAILED"
    };
  }

  if (brokerOpen > 0) {
    // Broker still has exposure — keep blocking new entries; counter mirrors broker.
    if (daily.openPositions !== brokerOpen) {
      daily.openPositions = brokerOpen;
      await saveDailySafetyDoc(daily);
    }
    // Backfill missing lifecycle so UI/management can see the real Demo position.
    try {
      await backfillLifecycleFromBroker(uid);
    } catch {
      /* best-effort */
    }
    return {
      before,
      after: daily.openPositions,
      lifecycleOpen: 0,
      brokerOpen,
      clearedGhost: false,
      brokerChecked: true,
      repairAttempted: false,
      error: null
    };
  }

  // Broker flat + no lifecycle → ghost counter. Clear openPositions, then repair
  // close accounting from broker deals (do NOT invent CLOSED + null pnl).
  daily.openPositions = 0;
  await saveDailySafetyDoc(daily);

  let repairAttempted = false;
  try {
    const { reconcileClosedTradesWithoutErasingPnl } = await import(
      "./demoCloseAccounting.js"
    );
    await reconcileClosedTradesWithoutErasingPnl(uid);
    repairAttempted = true;
  } catch {
    /* best-effort — trades may remain OPEN until deal is available */
  }

  return {
    before,
    after: 0,
    lifecycleOpen: 0,
    brokerOpen: 0,
    clearedGhost: before > 0,
    brokerChecked: true,
    repairAttempted,
    error: null
  };
}

/** Create lifecycle docs for broker opens that lack Firestore tracking. */
async function backfillLifecycleFromBroker(uid: string): Promise<number> {
  // Dynamic import avoids circular dependency with demoPositionLifecycle.
  const { createDemoPositionLifecycle } = await import(
    "./demoPositionLifecycle.js"
  );
  const existing = await listOpenPositionLifecycles(uid);
  const have = new Set(
    existing.map((p) => p.brokerPositionId).filter(Boolean) as string[]
  );
  const positions = await reconcileDemoBrokerPositions(uid);
  const conn = await getConnection(uid);
  const accountId = conn?.selectedAccountId ?? null;
  const accountMasked = conn?.selectedAccountMasked ?? null;
  const accountQualId = await getActiveQualificationAccountId(uid);
  const qual = accountQualId
    ? await getQualificationDoc(uid, accountQualId)
    : null;
  const openTrade = (qual?.demoAutoTrades ?? []).find((t) => t.status === "OPEN");
  let created = 0;
  for (const p of positions) {
    if (!p.positionId || have.has(p.positionId)) continue;
    const correlationId =
      openTrade && !openTrade.brokerPositionId
        ? openTrade.correlationId
        : `broker_${p.positionId}`;
    await createDemoPositionLifecycle({
      uid,
      correlationId,
      brokerOrderId: openTrade?.brokerOrderId ?? null,
      brokerPositionId: p.positionId,
      accountId,
      accountMasked,
      side: p.side,
      entry: p.entryPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      tp1: p.takeProfit,
      tp2: null,
      tp3: null,
      lots: p.volumeLots,
      qualificationStage: qual ? String(qual.state) : null,
      decisionId: openTrade?.signalId ?? null,
      source: "demo_auto",
      openedAt: p.openTimestamp ?? openTrade?.at ?? new Date().toISOString()
    });
    if (openTrade && qual && openTrade.correlationId === correlationId) {
      const demoAutoTrades = qual.demoAutoTrades.map((t) =>
        t.correlationId === correlationId
          ? {
              ...t,
              brokerPositionId: p.positionId,
              ctidTraderAccountId: accountId,
              traderLogin: conn?.selectedTraderLogin ?? t.traderLogin ?? null,
              fillPrice: p.entryPrice ?? t.fillPrice ?? null,
              brokerStopLoss: p.stopLoss ?? t.brokerStopLoss ?? null,
              brokerTakeProfit: p.takeProfit ?? t.brokerTakeProfit ?? null,
              filledVolumeLots: p.volumeLots ?? t.filledVolumeLots ?? null
            }
          : t
      );
      await saveQualificationDoc({ ...qual, demoAutoTrades });
    }
    created += 1;
  }
  return created;
}
