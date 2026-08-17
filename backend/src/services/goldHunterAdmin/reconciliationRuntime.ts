/**
 * Production Gold Hunter Demo reconciliation runner.
 * Resolves PENDING_RECONCILIATION / ACCEPTED_PENDING_FILL /
 * CLOSE_*_SETTLEMENT / broker-disappeared open positions
 * without blind order retry.
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

function isLocallyOpenGhTrade(t: GoldHunterDemoTrade): boolean {
  if (t.strategy !== GH_ADMIN_STRATEGY_ID || t.environment !== "DEMO") {
    return false;
  }
  if (!t.brokerPositionId) return false;
  if (t.status === "CLOSED") return false;
  if (isGoldHunterCloseSettlementPending(t.status)) return false;
  return (
    t.status === "FILLED" ||
    t.status === "PROTECTED" ||
    (t.result === "OPEN" &&
      t.status !== "BROKER_REJECTED" &&
      t.status !== "BROKER_SUBMIT_ERROR")
  );
}

/**
 * Authoritative broker open-position read.
 * Failure must NOT be coerced to an empty account.
 */
export async function readGoldHunterBrokerOpenPositions(
  ownerUid: string
): Promise<{ ok: true; positions: BrokerOpenPosition[] } | { ok: false }> {
  const list =
    hooks.listPositions ??
    ((uid: string) => reconcileDemoBrokerPositions(uid));
  try {
    const positions = await list(ownerUid);
    return { ok: true, positions: Array.isArray(positions) ? positions : [] };
  } catch {
    return { ok: false };
  }
}

/**
 * Resolve ACCEPTED_PENDING_FILL / PENDING_RECONCILIATION (entry path).
 * Never resubmits broker orders.
 * Caller must only invoke when positionsReadOk === true.
 */
export async function reconcileGoldHunterPendingEntries(args: {
  ownerUid: string;
  brokerPositions: BrokerDemoPositionLite[];
  positionsReadOk: boolean;
}): Promise<{
  recoveredOpen: number;
  rejected: number;
  stillPending: number;
  skipped: boolean;
}> {
  if (!args.positionsReadOk) {
    return {
      recoveredOpen: 0,
      rejected: 0,
      stillPending: 0,
      skipped: true
    };
  }
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
      const entryPrice = match.entryPrice;
      if (
        entryPrice == null ||
        !Number.isFinite(entryPrice) ||
        entryPrice <= 0
      ) {
        // Broker position exists but entry still invalid — do not mark FILLED.
        await upsertGoldHunterDemoTrade(args.ownerUid, {
          ...trade,
          brokerPositionId: match.positionId,
          status: "PENDING_RECONCILIATION",
          dataQuality: "ENTRY_INVALID",
          errorCode: "ENTRY_PRICE_INVALID",
          entry: null,
          mfe: null,
          mae: null
        });
        stillPending += 1;
        continue;
      }
      const recovered: GoldHunterDemoTrade = {
        ...trade,
        status: "FILLED",
        result: "OPEN",
        brokerPositionId: match.positionId,
        entry: entryPrice,
        stop: match.stopLoss ?? trade.stop,
        fillTs: trade.fillTs ?? now,
        filledVolumeLots: match.volumeLots ?? trade.filledVolumeLots,
        errorCode: null,
        dataQuality: null
      };
      await upsertGoldHunterDemoTrade(args.ownerUid, recovered);
      registerGoldHunterOpenPositionForOwner({
        ownerUid: args.ownerUid,
        trade: recovered,
        bid: recovered.entry!,
        ask: recovered.entry!
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

  return { recoveredOpen, rejected, stillPending, skipped: false };
}

/**
 * Local OPEN/PROTECTED GH trades whose brokerPositionId is absent from a
 * SUCCESSFUL broker open-position snapshot → settle via closing deals.
 * Never invent P/L. Never run when positionsReadOk is false.
 */
export async function reconcileGoldHunterDisappearedOpenPositions(args: {
  ownerUid: string;
  brokerPositions: BrokerDemoPositionLite[];
  positionsReadOk: boolean;
}): Promise<{
  skipped: boolean;
  settled: number;
  settlementPending: number;
  stillOpen: number;
}> {
  if (!args.positionsReadOk) {
    return {
      skipped: true,
      settled: 0,
      settlementPending: 0,
      stillOpen: 0
    };
  }

  const openIds = new Set(
    args.brokerPositions.map((p) => String(p.positionId))
  );
  const trades = await listGoldHunterDemoTrades(args.ownerUid, { limit: 200 });
  const openLocals = trades.filter(isLocallyOpenGhTrade);

  let settled = 0;
  let settlementPending = 0;
  let stillOpen = 0;
  const settle = hooks.settleClose ?? settleGoldHunterCloseFromBroker;

  for (const trade of openLocals) {
    const posId = String(trade.brokerPositionId);
    if (openIds.has(posId)) {
      const live = args.brokerPositions.find((p) => p.positionId === posId);
      if (
        live &&
        ((live.volumeLots != null &&
          live.volumeLots > 0 &&
          live.volumeLots !== trade.filledVolumeLots) ||
          (live.stopLoss != null && live.stopLoss !== trade.stop))
      ) {
        await upsertGoldHunterDemoTrade(args.ownerUid, {
          ...trade,
          filledVolumeLots: live.volumeLots ?? trade.filledVolumeLots,
          stop: live.stopLoss ?? trade.stop
        });
      }
      stillOpen += 1;
      continue;
    }

    const pending: GoldHunterDemoTrade = {
      ...trade,
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      exitReason: trade.exitReason ?? "BROKER_EXTERNAL_CLOSE",
      result: null,
      netPnlEur: null,
      grossPnlEur: null,
      errorCode: "BROKER_POSITION_ABSENT_SETTLEMENT_PENDING"
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, pending);

    const r = await settle({ ownerUid: args.ownerUid, trade: pending });
    if (r.settled) {
      if (
        r.trade.exitReason == null ||
        r.trade.exitReason === "BROKER_EXTERNAL_CLOSE"
      ) {
        await upsertGoldHunterDemoTrade(args.ownerUid, {
          ...r.trade,
          exitReason: "BROKER_EXTERNAL_CLOSE"
        });
      }
      settled += 1;
    } else {
      settlementPending += 1;
    }
  }

  return { skipped: false, settled, settlementPending, stillOpen };
}

/**
 * Exit-side PENDING_RECONCILIATION (e.g. CLOSE_VOLUME_UNKNOWN after exit
 * decision) with a known brokerPositionId.
 *
 * These are excluded from pending-entry reconcile (exitReason present) and
 * from disappeared-open reconcile (not FILLED/PROTECTED / result OPEN).
 * Without this path they orphan forever and block maxOpen.
 *
 * Only runs when positionsReadOk === true. Broker read failure → leave alone.
 */
export function isGoldHunterExitPendingReconciliation(
  t: GoldHunterDemoTrade
): boolean {
  if (t.strategy !== GH_ADMIN_STRATEGY_ID || t.environment !== "DEMO") {
    return false;
  }
  if (t.status !== "PENDING_RECONCILIATION") return false;
  if (!t.exitReason || String(t.exitReason).trim() === "") return false;
  if (!t.brokerPositionId || String(t.brokerPositionId).trim() === "") {
    return false;
  }
  return true;
}

export async function reconcileGoldHunterPendingExitReconciliations(args: {
  ownerUid: string;
  brokerPositions: BrokerDemoPositionLite[];
  positionsReadOk: boolean;
}): Promise<{
  skipped: boolean;
  stillOpen: number;
  settled: number;
  settlementPending: number;
}> {
  if (!args.positionsReadOk) {
    return {
      skipped: true,
      stillOpen: 0,
      settled: 0,
      settlementPending: 0
    };
  }

  const openIds = new Set(
    args.brokerPositions.map((p) => String(p.positionId))
  );
  const trades = await listGoldHunterDemoTrades(args.ownerUid, { limit: 200 });
  const pending = trades.filter(isGoldHunterExitPendingReconciliation);
  const settle = hooks.settleClose ?? settleGoldHunterCloseFromBroker;

  let stillOpen = 0;
  let settled = 0;
  let settlementPending = 0;

  for (const trade of pending) {
    const posId = String(trade.brokerPositionId);
    if (openIds.has(posId)) {
      // Broker still shows exposure — keep PENDING_RECONCILIATION (maxOpen blocks).
      stillOpen += 1;
      continue;
    }

    // Broker proven absent — do NOT issue another close mutation.
    // Transition to close-settlement and apply closing deal when available.
    const pendingSettle: GoldHunterDemoTrade = {
      ...trade,
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      result: null,
      netPnlEur: null,
      grossPnlEur: null,
      errorCode: "BROKER_POSITION_ABSENT_SETTLEMENT_PENDING"
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, pendingSettle);

    const r = await settle({ ownerUid: args.ownerUid, trade: pendingSettle });
    if (r.settled) {
      settled += 1;
    } else {
      settlementPending += 1;
    }
  }

  return { skipped: false, stillOpen, settled, settlementPending };
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
  /** True only when broker open-position query succeeded. */
  positionsReadOk: boolean;
  restored: number;
  unmatched: number;
  recoveredOpen: number;
  disappearedSettled: number;
  disappearedPending: number;
  exitPendingSettled: number;
  exitPendingSettlementPending: number;
  exitPendingStillOpen: number;
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
      positionsReadOk: false,
      restored: 0,
      unmatched: 0,
      recoveredOpen: 0,
      disappearedSettled: 0,
      disappearedPending: 0,
      exitPendingSettled: 0,
      exitPendingSettlementPending: 0,
      exitPendingStillOpen: 0,
      closesSettled: 0,
      closesPending: 0
    };
  }
  lastReconcileAt.set(args.ownerUid, now);

  const read = await readGoldHunterBrokerOpenPositions(args.ownerUid);
  const positionsReadOk = read.ok;
  const positions = read.ok ? read.positions : [];
  const lite = positions.map(toLite);

  let restored = 0;
  let unmatched = 0;
  let recoveredOpen = 0;
  let disappearedSettled = 0;
  let disappearedPending = 0;
  let exitPendingSettled = 0;
  let exitPendingSettlementPending = 0;
  let exitPendingStillOpen = 0;

  if (positionsReadOk) {
    const pos = await reconcileGoldHunterDemoPositions({
      ownerUid: args.ownerUid,
      brokerPositions: lite
    });
    restored = pos.restored.length;
    unmatched = pos.unmatched.length;

    const entries = await reconcileGoldHunterPendingEntries({
      ownerUid: args.ownerUid,
      brokerPositions: lite,
      positionsReadOk: true
    });
    recoveredOpen = entries.recoveredOpen;

    const disappeared = await reconcileGoldHunterDisappearedOpenPositions({
      ownerUid: args.ownerUid,
      brokerPositions: lite,
      positionsReadOk: true
    });
    disappearedSettled = disappeared.settled;
    disappearedPending = disappeared.settlementPending;

    const exitPending = await reconcileGoldHunterPendingExitReconciliations({
      ownerUid: args.ownerUid,
      brokerPositions: lite,
      positionsReadOk: true
    });
    exitPendingSettled = exitPending.settled;
    exitPendingSettlementPending = exitPending.settlementPending;
    exitPendingStillOpen = exitPending.stillOpen;

    await restoreGoldHunterPositionManager(args.ownerUid);
  }
  // positionsReadOk === false → do NOT treat as empty account; leave opens alone.

  const closes = await reconcileGoldHunterCloseSettlements({
    ownerUid: args.ownerUid
  });

  return {
    skipped: false,
    positionsReadOk,
    restored,
    unmatched,
    recoveredOpen,
    disappearedSettled,
    disappearedPending,
    exitPendingSettled,
    exitPendingSettlementPending,
    exitPendingStillOpen,
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
