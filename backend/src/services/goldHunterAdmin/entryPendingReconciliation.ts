/**
 * Gold Hunter Demo ENTRY PENDING_RECONCILIATION watchdog.
 *
 * Resolves uncertain NewOrder transmission outcomes using authoritative
 * cTrader open-position + ProtoOAOrderList + ProtoOADealList evidence.
 * Never resubmits NewOrder. Never fabricates fills / P/L.
 *
 * Exit-side PENDING_RECONCILIATION (exitReason set) is out of scope —
 * handled by close / ghost-exit settlement (PR #147).
 */
import {
  dealsMatchingOrderOrPosition,
  fetchDemoClosingDealForPosition,
  fetchDemoHistoricalDealEvidence,
  goldHunterEntryHistoryQueryWindow,
  lookupDemoOrderByClientOrderId
} from "../broker/ctrader/demoBrokerHistory";
import type {
  BrokerClosedDeal,
  BrokerHistoricalOrder,
  BrokerOpenPosition
} from "../broker/ctrader/openApiClient";
import { applyBrokerSettledClose } from "./closeSettlement";
import { registerGoldHunterOpenPositionForOwner } from "./demoPositionManager";
import type { BrokerDemoPositionLite } from "./reconcilePositions";
import { updateGoldHunterSignalClaim } from "./signalClaimStore";
import {
  listGoldHunterDemoTrades,
  upsertGoldHunterDemoTrade
} from "./tradeStore";
import {
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "./types";

/** Underlying cTrader sendCommand timeout is ~12s; outer wait ~8s. */
export const GH_ENTRY_SEND_UNCERTAINTY_MS = 15_000;

/** Conservative multi-read confirmation before terminal never-found. */
export const GH_ENTRY_NOT_FOUND_MIN_SUCCESSFUL_READS = 3;

/** Successful empty reads must span at least this long after grace. */
export const GH_ENTRY_NOT_FOUND_MIN_SPAN_MS = 90_000;

const ENTRY_UNCERTAINTY_CODES = new Set([
  "NEWORDER_SEND_TIMEOUT",
  "CTRADER_ORDER_TIMEOUT",
  "BROKER_OUTCOME_UNKNOWN",
  "BROKER_TIMEOUT_RECONCILED_NOT_FOUND"
]);

export type EntryReconcileEvidence = NonNullable<
  GoldHunterDemoTrade["entryReconcileEvidence"]
>;

export type EntryPendingWatchdogResult = {
  inspected: number;
  recoveredOpen: number;
  rejected: number;
  recoveredClosed: number;
  terminalNotFound: number;
  stillPending: number;
  skippedGrace: number;
  brokerUnavailable: number;
};

function emptyEvidence(nowIso: string): EntryReconcileEvidence {
  return {
    reconciliationAttempts: 0,
    firstReconcileAt: nowIso,
    lastReconcileAt: nowIso,
    openPositionChecks: 0,
    orderHistoryChecks: 0,
    dealHistoryChecks: 0,
    lastBrokerReadOk: false,
    terminalReason: null
  };
}

/**
 * Explicit classifier: ENTRY transmission uncertainty only.
 * Do not mix with CLOSE_REQUESTED / exit PENDING_RECONCILIATION.
 */
export function isGoldHunterEntryTransmissionUncertainty(
  trade: GoldHunterDemoTrade
): boolean {
  if (trade.strategy !== GH_ADMIN_STRATEGY_ID || trade.environment !== "DEMO") {
    return false;
  }
  if (trade.status !== "PENDING_RECONCILIATION") return false;
  if (trade.exitReason) return false;
  if (trade.dataQuality === "ENTRY_INVALID" && trade.brokerPositionId) {
    // Broker position known; disappeared-open / entry-invalid path owns this.
    return false;
  }
  const code = trade.errorCode ?? "BROKER_OUTCOME_UNKNOWN";
  if (!ENTRY_UNCERTAINTY_CODES.has(code) && trade.brokerPositionId) {
    return false;
  }
  // Null-position PENDING with known uncertainty codes, or generic unknown.
  if (trade.brokerPositionId) return false;
  return (
    ENTRY_UNCERTAINTY_CODES.has(code) ||
    code === "BROKER_OUTCOME_UNKNOWN" ||
    !trade.errorCode
  );
}

export function goldHunterEntryPendingAgeMs(
  trade: GoldHunterDemoTrade,
  nowMs = Date.now()
): number | null {
  const raw = trade.orderTs ?? trade.signalTs;
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, nowMs - ts);
}

function isProvenGhOpenMatch(
  pos: BrokerDemoPositionLite,
  trade: GoldHunterDemoTrade
): boolean {
  if (trade.brokerPositionId && trade.brokerPositionId === pos.positionId) {
    return true;
  }
  if (trade.goldHunterTradeId && pos.label === trade.goldHunterTradeId) {
    return true;
  }
  const comment = String(pos.comment ?? "");
  if (comment.includes(GH_ADMIN_STRATEGY_ID)) return true;
  if (String(pos.label ?? "").startsWith("GH-D-")) return true;
  return false;
}

function matchOpenByClientOrderId(
  positions: readonly BrokerDemoPositionLite[],
  trade: GoldHunterDemoTrade,
  order: BrokerHistoricalOrder | null
): BrokerDemoPositionLite | null {
  if (order?.positionId) {
    const byId = positions.find((p) => p.positionId === String(order.positionId));
    if (byId && isProvenGhOpenMatch(byId, trade)) return byId;
    if (byId) return byId; // exact positionId from order history is authoritative
  }
  if (trade.brokerPositionId) {
    const byId = positions.find(
      (p) => p.positionId === String(trade.brokerPositionId)
    );
    if (byId) return byId;
  }
  return (
    positions.find(
      (p) =>
        p.label === trade.goldHunterTradeId ||
        (trade.signalId != null &&
          String(p.label ?? "").includes(String(trade.signalId).slice(0, 12)))
    ) ?? null
  );
}

async function persistEvidence(
  ownerUid: string,
  trade: GoldHunterDemoTrade,
  evidence: EntryReconcileEvidence
): Promise<void> {
  await upsertGoldHunterDemoTrade(ownerUid, {
    ...trade,
    entryReconcileEvidence: evidence
  });
}

async function recoverOpenFromPosition(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  match: BrokerDemoPositionLite;
  order: BrokerHistoricalOrder | null;
  evidence: EntryReconcileEvidence;
}): Promise<GoldHunterDemoTrade> {
  const { trade, match, order } = args;
  const now = new Date().toISOString();
  const entryPrice = match.entryPrice ?? order?.executionPrice ?? null;
  if (entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    const pending: GoldHunterDemoTrade = {
      ...trade,
      brokerPositionId: match.positionId,
      brokerOrderId: order?.orderId ?? trade.brokerOrderId,
      status: "PENDING_RECONCILIATION",
      dataQuality: "ENTRY_INVALID",
      errorCode: "ENTRY_PRICE_INVALID",
      entry: null,
      entryReconcileEvidence: {
        ...args.evidence,
        lastBrokerReadOk: true,
        terminalReason: null
      }
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, pending);
    return pending;
  }
  const recovered: GoldHunterDemoTrade = {
    ...trade,
    status: "FILLED",
    result: "OPEN",
    brokerPositionId: match.positionId,
    brokerOrderId: order?.orderId ?? trade.brokerOrderId,
    entry: entryPrice,
    stop: match.stopLoss ?? trade.stop,
    fillTs: trade.fillTs ?? order?.updatedAt ?? order?.createdAt ?? now,
    filledVolumeLots:
      match.volumeLots ?? order?.executedVolumeLots ?? trade.filledVolumeLots,
    errorCode: null,
    dataQuality: null,
    entryReconcileEvidence: {
      ...args.evidence,
      lastBrokerReadOk: true,
      terminalReason: "RECOVERED_OPEN"
    }
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
      brokerOrderId: recovered.brokerOrderId,
      goldHunterTradeId: trade.goldHunterTradeId,
      errorCode: null
    });
  }
  return recovered;
}

async function persistRejected(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  order: BrokerHistoricalOrder;
  evidence: EntryReconcileEvidence;
}): Promise<void> {
  const next: GoldHunterDemoTrade = {
    ...args.trade,
    status: "BROKER_REJECTED",
    brokerOrderId: args.order.orderId,
    brokerPositionId: args.order.positionId,
    errorCode: "ORDER_STATUS_REJECTED",
    entryReconcileEvidence: {
      ...args.evidence,
      lastBrokerReadOk: true,
      terminalReason: "HISTORICAL_ORDER_REJECTED"
    }
  };
  await upsertGoldHunterDemoTrade(args.ownerUid, next);
  if (args.trade.signalId) {
    await updateGoldHunterSignalClaim(args.ownerUid, args.trade.signalId, {
      state: "BROKER_REJECTED",
      brokerOrderId: args.order.orderId,
      brokerPositionId: args.order.positionId,
      goldHunterTradeId: args.trade.goldHunterTradeId,
      errorCode: "ORDER_STATUS_REJECTED"
    });
  }
}

async function persistClosedFromDeals(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  order: BrokerHistoricalOrder;
  deal: BrokerClosedDeal;
  evidence: EntryReconcileEvidence;
}): Promise<void> {
  const entry =
    args.deal.entryPrice ??
    args.order.executionPrice ??
    args.trade.entry ??
    null;
  const base: GoldHunterDemoTrade = {
    ...args.trade,
    brokerOrderId: args.order.orderId,
    brokerPositionId:
      args.order.positionId ?? args.deal.positionId ?? args.trade.brokerPositionId,
    entry,
    fillTs:
      args.trade.fillTs ??
      args.order.updatedAt ??
      args.order.createdAt ??
      args.deal.closedAt,
    filledVolumeLots:
      args.deal.closedVolumeLots ??
      args.order.executedVolumeLots ??
      args.trade.filledVolumeLots,
    entryReconcileEvidence: {
      ...args.evidence,
      lastBrokerReadOk: true,
      terminalReason: "RECOVERED_CLOSED_FROM_HISTORY"
    }
  };
  const closed = applyBrokerSettledClose({
    trade: base,
    deal: args.deal,
    exitReason: args.trade.exitReason ?? "BROKER_HISTORY_CLOSED"
  });
  await upsertGoldHunterDemoTrade(args.ownerUid, closed);
  if (args.trade.signalId) {
    await updateGoldHunterSignalClaim(args.ownerUid, args.trade.signalId, {
      state: "CLOSED",
      brokerOrderId: closed.brokerOrderId,
      brokerPositionId: closed.brokerPositionId,
      goldHunterTradeId: args.trade.goldHunterTradeId,
      errorCode: null
    });
  }
}

async function persistNeverFound(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  evidence: EntryReconcileEvidence;
}): Promise<void> {
  const next: GoldHunterDemoTrade = {
    ...args.trade,
    status: "BROKER_SUBMIT_ERROR",
    errorCode: "NEWORDER_RECONCILED_NOT_FOUND",
    entryReconcileEvidence: {
      ...args.evidence,
      lastBrokerReadOk: true,
      terminalReason: "NEWORDER_RECONCILED_NOT_FOUND"
    }
  };
  await upsertGoldHunterDemoTrade(args.ownerUid, next);
  if (args.trade.signalId) {
    await updateGoldHunterSignalClaim(args.ownerUid, args.trade.signalId, {
      state: "BROKER_SUBMIT_ERROR",
      goldHunterTradeId: args.trade.goldHunterTradeId,
      clientOrderId: args.trade.clientOrderId ?? null,
      errorCode: "NEWORDER_RECONCILED_NOT_FOUND"
    });
  }
}

function canTerminalNeverFound(evidence: EntryReconcileEvidence): boolean {
  if (
    evidence.openPositionChecks < GH_ENTRY_NOT_FOUND_MIN_SUCCESSFUL_READS ||
    evidence.orderHistoryChecks < GH_ENTRY_NOT_FOUND_MIN_SUCCESSFUL_READS ||
    evidence.dealHistoryChecks < GH_ENTRY_NOT_FOUND_MIN_SUCCESSFUL_READS
  ) {
    return false;
  }
  const first = Date.parse(evidence.firstReconcileAt);
  const last = Date.parse(evidence.lastReconcileAt);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
  return last - first >= GH_ENTRY_NOT_FOUND_MIN_SPAN_MS;
}

/**
 * Independent of new trading opportunities. Safe to run from quote-worker
 * reconcile cadence (~30s). Never places ProtoOANewOrderReq.
 */
export async function reconcileGoldHunterEntryPendingWatchdog(args: {
  ownerUid: string;
  brokerPositions: BrokerDemoPositionLite[];
  positionsReadOk: boolean;
  nowMs?: number;
  /** Test override — default GH_ENTRY_SEND_UNCERTAINTY_MS. */
  graceMs?: number;
}): Promise<EntryPendingWatchdogResult> {
  const nowMs = args.nowMs ?? Date.now();
  const graceMs = args.graceMs ?? GH_ENTRY_SEND_UNCERTAINTY_MS;
  const nowIso = new Date(nowMs).toISOString();
  const trades = await listGoldHunterDemoTrades(args.ownerUid, { limit: 200 });

  const pending = trades.filter(isGoldHunterEntryTransmissionUncertainty);
  const result: EntryPendingWatchdogResult = {
    inspected: pending.length,
    recoveredOpen: 0,
    rejected: 0,
    recoveredClosed: 0,
    terminalNotFound: 0,
    stillPending: 0,
    skippedGrace: 0,
    brokerUnavailable: 0
  };

  for (const trade of pending) {
    const age = goldHunterEntryPendingAgeMs(trade, nowMs);
    if (age == null || age < graceMs) {
      result.skippedGrace += 1;
      result.stillPending += 1;
      continue;
    }

    const clientOrderId = String(trade.clientOrderId ?? "").trim();
    if (!clientOrderId) {
      // Cannot correlate without clientOrderId — fail closed.
      result.stillPending += 1;
      continue;
    }

    let evidence: EntryReconcileEvidence = {
      ...(trade.entryReconcileEvidence ?? emptyEvidence(nowIso)),
      reconciliationAttempts:
        (trade.entryReconcileEvidence?.reconciliationAttempts ?? 0) + 1,
      lastReconcileAt: nowIso,
      firstReconcileAt:
        trade.entryReconcileEvidence?.firstReconcileAt ?? nowIso
    };

    // --- Open positions (Case A) ---
    let openCheckOk = args.positionsReadOk;
    let openMatch: BrokerDemoPositionLite | null = null;

    const orderLookup = await lookupDemoOrderByClientOrderId({
      ownerUid: args.ownerUid,
      clientOrderId,
      orderTs: trade.orderTs,
      nowMs
    });
    const orderOk = orderLookup.ok;
    const order = orderOk ? orderLookup.value.order : null;
    if (orderOk) {
      evidence = {
        ...evidence,
        orderHistoryChecks: evidence.orderHistoryChecks + 1
      };
    }

    if (openCheckOk) {
      evidence = {
        ...evidence,
        openPositionChecks: evidence.openPositionChecks + 1
      };
      openMatch = matchOpenByClientOrderId(
        args.brokerPositions,
        trade,
        order
      );
      if (openMatch && (order || isProvenGhOpenMatch(openMatch, trade))) {
        await recoverOpenFromPosition({
          ownerUid: args.ownerUid,
          trade,
          match: openMatch,
          order,
          evidence: { ...evidence, lastBrokerReadOk: true }
        });
        result.recoveredOpen += 1;
        continue;
      }
    }

    // --- Historical order (Cases B / C / D) ---
    if (!orderOk) {
      evidence = { ...evidence, lastBrokerReadOk: false };
      await persistEvidence(args.ownerUid, trade, evidence);
      result.brokerUnavailable += 1;
      result.stillPending += 1;
      continue;
    }

    if (order && order.orderStatusCode === 3) {
      // CASE B — ORDER_STATUS_REJECTED
      await persistRejected({
        ownerUid: args.ownerUid,
        trade,
        order,
        evidence
      });
      result.rejected += 1;
      continue;
    }

    if (
      order &&
      (order.orderStatusCode === 1 || order.orderStatusCode === 2) &&
      openMatch == null
    ) {
      // Order accepted/filled but no open position — try closed reconstruction.
      const window = goldHunterEntryHistoryQueryWindow({
        orderTs: trade.orderTs,
        nowMs
      });
      const dealsRead = await fetchDemoHistoricalDealEvidence({
        ownerUid: args.ownerUid,
        ...window
      });
      if (!dealsRead.ok) {
        evidence = { ...evidence, lastBrokerReadOk: false };
        await persistEvidence(args.ownerUid, trade, evidence);
        result.brokerUnavailable += 1;
        result.stillPending += 1;
        continue;
      }
      evidence = {
        ...evidence,
        dealHistoryChecks: evidence.dealHistoryChecks + 1,
        lastBrokerReadOk: true
      };

      const matchedDeals = dealsMatchingOrderOrPosition({
        deals: dealsRead.value,
        orderId: order.orderId,
        positionId: order.positionId
      });
      const closingFromEvidence = matchedDeals
        .map((d) => d.close)
        .filter((c): c is BrokerClosedDeal => c != null && c.netPnl != null);

      let closing: BrokerClosedDeal | null =
        closingFromEvidence.length > 0
          ? closingFromEvidence.sort(
              (a, b) =>
                Date.parse(a.closedAt ?? "") - Date.parse(b.closedAt ?? "")
            )[closingFromEvidence.length - 1]!
          : null;

      if (!closing && order.positionId) {
        const byPos = await fetchDemoClosingDealForPosition({
          ownerUid: args.ownerUid,
          positionId: order.positionId,
          ...window
        });
        if (!byPos.ok) {
          evidence = { ...evidence, lastBrokerReadOk: false };
          await persistEvidence(args.ownerUid, trade, evidence);
          result.brokerUnavailable += 1;
          result.stillPending += 1;
          continue;
        }
        evidence = {
          ...evidence,
          dealHistoryChecks: evidence.dealHistoryChecks + 1
        };
        closing = byPos.value;
      }

      if (closing && closing.netPnl != null) {
        // CASE C — filled and closed
        await persistClosedFromDeals({
          ownerUid: args.ownerUid,
          trade,
          order,
          deal: closing,
          evidence
        });
        result.recoveredClosed += 1;
        continue;
      }

      // CASE D — order exists / accepted but not yet resolved
      await persistEvidence(args.ownerUid, trade, {
        ...evidence,
        lastBrokerReadOk: true,
        terminalReason: null
      });
      result.stillPending += 1;
      continue;
    }

    if (order) {
      // Order present with non-terminal / non-fill status — keep pending.
      await persistEvidence(args.ownerUid, trade, {
        ...evidence,
        lastBrokerReadOk: true,
        terminalReason: null
      });
      result.stillPending += 1;
      continue;
    }

    // No order found for exact clientOrderId — deal history must also be empty.
    const window = goldHunterEntryHistoryQueryWindow({
      orderTs: trade.orderTs,
      nowMs
    });
    const dealsRead = await fetchDemoHistoricalDealEvidence({
      ownerUid: args.ownerUid,
      ...window
    });
    if (!dealsRead.ok) {
      evidence = { ...evidence, lastBrokerReadOk: false };
      await persistEvidence(args.ownerUid, trade, evidence);
      result.brokerUnavailable += 1;
      result.stillPending += 1;
      continue;
    }
    evidence = {
      ...evidence,
      dealHistoryChecks: evidence.dealHistoryChecks + 1,
      lastBrokerReadOk: openCheckOk && orderOk
    };

    // Any deal that could belong to this clientOrderId requires orderId —
    // without an order we cannot correlate deals by clientOrderId alone.
    // Empty successful deal list + empty order + empty open = candidate for Case F.
    if (!openCheckOk) {
      evidence = { ...evidence, lastBrokerReadOk: false };
      await persistEvidence(args.ownerUid, trade, evidence);
      result.brokerUnavailable += 1;
      result.stillPending += 1;
      continue;
    }

    if (canTerminalNeverFound(evidence)) {
      // CASE F — authoritative multi-read never-found
      await persistNeverFound({ ownerUid: args.ownerUid, trade, evidence });
      result.terminalNotFound += 1;
      continue;
    }

    // CASE E / incomplete confirmation — keep pending
    await persistEvidence(args.ownerUid, trade, evidence);
    result.stillPending += 1;
  }

  return result;
}

/** Test helper — map BrokerOpenPosition → lite. */
export function toEntryWatchdogPositionLite(
  p: BrokerOpenPosition
): BrokerDemoPositionLite {
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
