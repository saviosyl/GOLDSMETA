/**
 * Reconcile daily-safety open-position counters with lifecycle + broker reality.
 *
 * Prevents a ghost OPEN counter (order ack recorded, lifecycle missing, broker flat)
 * from permanently blocking Demo Auto via MAX_OPEN_POSITIONS.
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

export type OpenPositionReconcileResult = {
  before: number;
  after: number;
  lifecycleOpen: number;
  brokerOpen: number | null;
  clearedGhost: boolean;
  brokerChecked: boolean;
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
      error: null
    };
  }

  // No lifecycle opens. If counter already 0, nothing to do.
  if (daily.openPositions <= 0) {
    return {
      before,
      after: 0,
      lifecycleOpen: 0,
      brokerOpen: null,
      clearedGhost: false,
      brokerChecked: false,
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
      error: e instanceof Error ? e.message : "BROKER_RECONCILE_FAILED"
    };
  }

  if (brokerOpen > 0) {
    // Broker still has exposure — keep blocking new entries; counter mirrors broker.
    if (daily.openPositions !== brokerOpen) {
      daily.openPositions = brokerOpen;
      await saveDailySafetyDoc(daily);
    }
    return {
      before,
      after: daily.openPositions,
      lifecycleOpen: 0,
      brokerOpen,
      clearedGhost: false,
      brokerChecked: true,
      error: null
    };
  }

  // Broker flat + no lifecycle → ghost counter. Clear and close untracked OPEN records.
  daily.openPositions = 0;
  await saveDailySafetyDoc(daily);
  await markGhostDemoAutoTradesReconciled(uid);

  return {
    before,
    after: 0,
    lifecycleOpen: 0,
    brokerOpen: 0,
    clearedGhost: before > 0,
    brokerChecked: true,
    error: null
  };
}

async function markGhostDemoAutoTradesReconciled(uid: string): Promise<void> {
  const accountId = await getActiveQualificationAccountId(uid);
  if (!accountId) return;
  const doc = await getQualificationDoc(uid, accountId);
  if (!doc) return;
  let changed = false;
  const demoAutoTrades = doc.demoAutoTrades.map((t) => {
    if (t.status !== "OPEN") return t;
    changed = true;
    return {
      ...t,
      status: "CLOSED" as const,
      closedAt: new Date().toISOString(),
      counted: false,
      pnl: t.pnl
    };
  });
  if (!changed) return;
  await saveQualificationDoc({ ...doc, demoAutoTrades });
}
