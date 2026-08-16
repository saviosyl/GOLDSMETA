/**
 * Production Gold Hunter Demo reconciliation runner.
 * Resolves PENDING_RECONCILIATION / ACCEPTED_PENDING_FILL /
 * CLOSE_*_SETTLEMENT without blind order retry.
 */
import { reconcileDemoBrokerPositions } from "../broker/ctrader/demoPositionMutations";
import type {
  BrokerClosedDeal,
  BrokerOpenPosition
} from "../broker/ctrader/openApiClient";
import { getOwnerQueue } from "./boundedQueue";
import {
  isGoldHunterCloseSettlementPending,
  settleGoldHunterCloseFromBroker
} from "./closeSettlement";
import {
  restoreGoldHunterPositionManager,
  registerGoldHunterOpenPositionForOwner
} from "./demoPositionManager";
import {
  reconcileGoldHunterDemoPositions,
  type BrokerDemoPositionLite
} from "./reconcilePositions";
import {
  getGoldHunterSignalClaim,
  updateGoldHunterSignalClaim
} from "./signalClaimStore";
import {
  listGoldHunterDemoTrades,
  upsertGoldHunterDemoTrade
} from "./tradeStore";
import {
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "./types";

export type ReconcileRuntimeHooks = {
  listPositions?: (ownerUid: string) => Promise<BrokerOpenPosition[]>;
  settleClose?: typeof settleGoldHunterCloseFromBroker;
};

let hooks: ReconcileRuntimeHooks = {};

/** Min interval between full reconcile passes per owner (ms). */
export const GH_RECONCILE_MIN_INTERVAL_MS = 30_000;

const lastReconcileAt = new Map<string, number>();

export function setGoldHunterReconcileHooksForTests(
  h: ReconcileRuntimeHooks
): void {
  hooks = h;
}

export function resetGoldHunterReconcileRuntimeForTests(): void {
  hooks = {};
  lastReconcileAt.clear();
}

function toLite(p: BrokerOpenPosition): BrokerDemoPositionLite {
  const raw = p as BrokerOpenPosition & {
    label?: string | null;
    comment?: string | null;
  };
  return {
    positionId: p.positionId,
    side: p.side,
    volumeLots: p.volumeLots,
    entryPrice: p.entryPrice,
    stopLoss: p.stopLoss,
    label: raw.label ?? null,
    comment: raw.comment ?? null
  };
}

function isProvenGhPosition(
  pos: BrokerDemoPositionLite,
  trade?: GoldHunterDemoTrade | null
): boolean {
  if (trade?.brokerPositionId && trade.brokerPositionId === pos.positionId) {
    return true;
  }
  const comment = String(pos.comment ?? "");
  const label = String(pos.label ?? "");
  if (comment.includes(GH_ADMIN_STRATEGY_ID)) return true;
  if (label.startsWith("GH-D-")) return true;
  if (trade?.goldHunterTradeId && label === trade.goldHunterTradeId) return true;
  if (trade?.clientOrderId && /gh_/i.test(String(pos.label ?? ""))) return true;
  return false;
}

/**
 * Resolve ACCEPTED_PENDING_FILL / PENDING_RECONCILIATION (entry path).
 * Never resubmits broker orders.
 */
export async function reconcileGoldHunterPendingEntries(args: {
  ownerUid: string;
  brokerPositions: BrokerDemoPositionLite[];
}): Promise<{
  recoveredOpen: number;
  rejected: number;
  stillPending: number;
}> {
  const trades = await listGoldHunterDemoTrades(args.ownerUid, { limit: 200 });
  const pending = trades.filter(
    (t) =>
      t.status === "ACCEPTED_PENDING_FILL" ||
      (t.status === "PENDING_RECONCILIATION" && !t.exitReason)
  );
  let recoveredOpen = 0;
  let rejected = 0;
  let stillPending = 0;

  for (const trade of pending) {
    const byPos =
      trade.brokerPositionId != null
        ? args.brokerPositions.find(
            (p) => p.positionId === String(trade.brokerPositionId)
          )
        : null;
    const byLabel = args.brokerPositions.find(
      (p) =>
        p.label === trade.goldHunterTradeId ||
        (trade.signalId != null &&
          String(p.label ?? "").includes(String(trade.signalId).slice(0, 12)))
    );
    const match = byPos ?? byLabel ?? null;

    if (match && isProvenGhPosition(match, trade)) {
      const now = new Date().toISOString();
      const recovered: GoldHunterDemoTrade = {
        ...trade,
        status: "FILLED",
        result: "OPEN",
        brokerPositionId: match.positionId,
        entry: match.entryPrice ?? trade.entry,
        stop: match.stopLoss ?? trade.stop,
        fillTs: trade.fillTs ?? now,
        filledVolumeLots: match.volumeLots ?? trade.filledVolumeLots,
        errorCode: null
      };
      await upsertGoldHunterDemoTrade(args.ownerUid, recovered);
      registerGoldHunterOpenPositionForOwner({
        ownerUid: args.ownerUid,
        trade: recovered,
        bid: recovered.entry ?? 0,
        ask: recovered.entry ?? 0
      });
      if (trade.signalId) {
        await updateGoldHunterSignalClaim(args.ownerUid, trade.signalId, {
          state: "OPEN",
          brokerPositionId: match.positionId,
          goldHunterTradeId: trade.goldHunterTradeId
        });
      }
      recoveredOpen += 1;
      continue;
    }

    // No matching open position — if claim already rejected, mirror; else stay pending.
    if (trade.signalId) {
      const claim = await getGoldHunterSignalClaim(args.ownerUid, trade.signalId);
      if (claim?.state === "BROKER_REJECTED") {
        await upsertGoldHunterDemoTrade(args.ownerUid, {
          ...trade,
          status: "BROKER_REJECTED",
          errorCode: claim.errorCode ?? "BROKER_REJECTED"
        });
        rejected += 1;
        continue;
      }
    }
    stillPending += 1;
  }

  return { recoveredOpen, rejected, stillPending };
}

/**
 * Retry settlement for closes awaiting broker deal P/L.
 */
export async function reconcileGoldHunterCloseSettlements(args: {
  ownerUid: string;
}): Promise<{ settled: number; stillPending: number }> {
  const trades = await listGoldHunterDemoTrades(args.ownerUid, { limit: 200 });
  const pending = trades.filter((t) =>
    isGoldHunterCloseSettlementPending(t.status)
  );
  let settled = 0;
  let stillPending = 0;
  const settle = hooks.settleClose ?? settleGoldHunterCloseFromBroker;
  for (const trade of pending) {
    const r = await settle({ ownerUid: args.ownerUid, trade });
    if (r.settled) settled += 1;
    else stillPending += 1;
  }
  return { settled, stillPending };
}

export type GoldHunterReconcilePassResult = {
  skipped: boolean;
  restored: number;
  unmatched: number;
  recoveredOpen: number;
  closesSettled: number;
  closesPending: number;
};

/**
 * Full safe reconcile pass — read-only broker queries + local state repair.
 * Never places orders.
 */
export async function runGoldHunterReconcilePass(args: {
  ownerUid: string;
  force?: boolean;
  nowMs?: number;
}): Promise<GoldHunterReconcilePassResult> {
  const now = args.nowMs ?? Date.now();
  const last = lastReconcileAt.get(args.ownerUid) ?? 0;
  if (!args.force && now - last < GH_RECONCILE_MIN_INTERVAL_MS) {
    return {
      skipped: true,
      restored: 0,
      unmatched: 0,
      recoveredOpen: 0,
      closesSettled: 0,
      closesPending: 0
    };
  }
  lastReconcileAt.set(args.ownerUid, now);

  const list =
    hooks.listPositions ??
    ((uid: string) => reconcileDemoBrokerPositions(uid));
  let positions: BrokerOpenPosition[] = [];
  try {
    positions = await list(args.ownerUid);
  } catch {
    positions = [];
  }
  const lite = positions.map(toLite);

  const pos = await reconcileGoldHunterDemoPositions({
    ownerUid: args.ownerUid,
    brokerPositions: lite
  });
  await restoreGoldHunterPositionManager(args.ownerUid);

  const entries = await reconcileGoldHunterPendingEntries({
    ownerUid: args.ownerUid,
    brokerPositions: lite
  });
  const closes = await reconcileGoldHunterCloseSettlements({
    ownerUid: args.ownerUid
  });

  return {
    skipped: false,
    restored: pos.restored.length,
    unmatched: pos.unmatched.length,
    recoveredOpen: entries.recoveredOpen,
    closesSettled: closes.settled,
    closesPending: closes.stillPending
  };
}

/** Enqueue reconcile off the quote hot path. */
export function enqueueGoldHunterReconcilePass(
  ownerUid: string,
  force = false
): boolean {
  const q = getOwnerQueue("gh-demo-reconcile", ownerUid, 1);
  return q.enqueue(async () => {
    await runGoldHunterReconcilePass({ ownerUid, force });
  });
}

export async function drainGoldHunterReconcileForTests(
  ownerUid: string
): Promise<void> {
  await getOwnerQueue("gh-demo-reconcile", ownerUid, 1).drainForTests();
}

/** Re-export for settle tests that inject BrokerClosedDeal. */
export type { BrokerClosedDeal };
