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
  fetchDemoHistoricalDealEvidenceExhaustive,
  goldHunterEntryHistoryQueryWindow,
  lookupDemoOrderByClientOrderId,
  resolvePositionIdFromDeals
} from "../broker/ctrader/demoBrokerHistory";
import type {
  BrokerClosedDeal,
  BrokerDealEvidence,
  BrokerHistoricalOrder,
  BrokerOpenPosition
} from "../broker/ctrader/openApiClient";
import {
  aggregateClosingDeals,
  classifyExactLabelledDeals,
  isSuccessfulExecutionDealStatus,
  normalizeBrokerDealStatus,
  type BrokerDealStatusKind
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

/** Complete empty-proof cycles required before terminal never-found. */
export const GH_ENTRY_NOT_FOUND_MIN_EMPTY_PROOF_CYCLES = 3;

/** Complete empty-proof span across first→last successful cycle. */
export const GH_ENTRY_NOT_FOUND_MIN_SPAN_MS = 90_000;

/** @deprecated Use GH_ENTRY_NOT_FOUND_MIN_EMPTY_PROOF_CYCLES. */
export const GH_ENTRY_NOT_FOUND_MIN_SUCCESSFUL_READS =
  GH_ENTRY_NOT_FOUND_MIN_EMPTY_PROOF_CYCLES;

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
    lastReconcileAt: nowIso,
    lastBrokerReadOk: false,
    successfulEmptyProofCycles: 0,
    firstSuccessfulEmptyProofAt: null,
    lastSuccessfulEmptyProofAt: null,
    lastHistoryComplete: false,
    terminalReason: null
  };
}

function normalizeEvidence(
  prior: GoldHunterDemoTrade["entryReconcileEvidence"] | null | undefined,
  nowIso: string
): EntryReconcileEvidence {
  const base = prior ?? emptyEvidence(nowIso);
  const next: EntryReconcileEvidence = {
    reconciliationAttempts: base.reconciliationAttempts ?? 0,
    lastReconcileAt: nowIso,
    lastBrokerReadOk: base.lastBrokerReadOk ?? false,
    successfulEmptyProofCycles: base.successfulEmptyProofCycles ?? 0,
    firstSuccessfulEmptyProofAt: base.firstSuccessfulEmptyProofAt ?? null,
    lastSuccessfulEmptyProofAt: base.lastSuccessfulEmptyProofAt ?? null,
    lastHistoryComplete: base.lastHistoryComplete ?? false,
    terminalReason: base.terminalReason ?? null
  };
  // Omit optional legacy counters when absent — Firestore rejects `undefined`.
  if (typeof base.openPositionChecks === "number") {
    next.openPositionChecks = base.openPositionChecks;
  }
  if (typeof base.orderHistoryChecks === "number") {
    next.orderHistoryChecks = base.orderHistoryChecks;
  }
  if (typeof base.dealHistoryChecks === "number") {
    next.dealHistoryChecks = base.dealHistoryChecks;
  }
  if (typeof base.firstReconcileAt === "string") {
    next.firstReconcileAt = base.firstReconcileAt;
  }
  return next;
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
    return false;
  }
  const code = trade.errorCode ?? "BROKER_OUTCOME_UNKNOWN";
  if (!ENTRY_UNCERTAINTY_CODES.has(code) && trade.brokerPositionId) {
    return false;
  }
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

function matchOpenByPositionId(
  positions: readonly BrokerDemoPositionLite[],
  positionId: string | null | undefined
): BrokerDemoPositionLite | null {
  if (!positionId) return null;
  return positions.find((p) => p.positionId === String(positionId)) ?? null;
}

function matchOpenByClientOrderId(
  positions: readonly BrokerDemoPositionLite[],
  trade: GoldHunterDemoTrade,
  order: BrokerHistoricalOrder | null,
  resolvedPositionId: string | null
): BrokerDemoPositionLite | null {
  const byResolved = matchOpenByPositionId(positions, resolvedPositionId);
  if (byResolved) return byResolved;
  if (order?.positionId) {
    const byId = matchOpenByPositionId(positions, order.positionId);
    if (byId) return byId;
  }
  if (trade.brokerPositionId) {
    const byId = matchOpenByPositionId(positions, trade.brokerPositionId);
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

function recordEmptyProofCycle(
  evidence: EntryReconcileEvidence,
  nowIso: string
): EntryReconcileEvidence {
  const cycles = (evidence.successfulEmptyProofCycles ?? 0) + 1;
  return {
    ...evidence,
    successfulEmptyProofCycles: cycles,
    firstSuccessfulEmptyProofAt:
      evidence.firstSuccessfulEmptyProofAt ?? nowIso,
    lastSuccessfulEmptyProofAt: nowIso,
    lastBrokerReadOk: true,
    lastHistoryComplete: true,
    terminalReason: null
  };
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

/**
 * Terminal non-rejection deal failure (ERROR / MISSED).
 * Do not label these BROKER_REJECTED — cTrader did not report rejection.
 */
async function persistDealSubmitError(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  order: BrokerHistoricalOrder;
  evidence: EntryReconcileEvidence;
  errorCode: "BROKER_DEAL_ERROR" | "BROKER_DEAL_MISSED";
  terminalReason: string;
}): Promise<void> {
  const next: GoldHunterDemoTrade = {
    ...args.trade,
    status: "BROKER_SUBMIT_ERROR",
    brokerOrderId: args.order.orderId,
    brokerPositionId: args.order.positionId,
    errorCode: args.errorCode,
    entryReconcileEvidence: {
      ...args.evidence,
      lastBrokerReadOk: true,
      terminalReason: args.terminalReason
    }
  };
  await upsertGoldHunterDemoTrade(args.ownerUid, next);
  if (args.trade.signalId) {
    await updateGoldHunterSignalClaim(args.ownerUid, args.trade.signalId, {
      state: "BROKER_SUBMIT_ERROR",
      brokerOrderId: args.order.orderId,
      brokerPositionId: args.order.positionId,
      goldHunterTradeId: args.trade.goldHunterTradeId,
      errorCode: args.errorCode
    });
  }
}

async function persistClosedFromDeals(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  order: BrokerHistoricalOrder;
  deal: BrokerClosedDeal;
  positionId: string;
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
    brokerPositionId: args.positionId,
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

export function canTerminalNeverFound(
  evidence: EntryReconcileEvidence
): boolean {
  const cycles = evidence.successfulEmptyProofCycles ?? 0;
  if (cycles < GH_ENTRY_NOT_FOUND_MIN_EMPTY_PROOF_CYCLES) return false;
  const first = evidence.firstSuccessfulEmptyProofAt
    ? Date.parse(evidence.firstSuccessfulEmptyProofAt)
    : NaN;
  const last = evidence.lastSuccessfulEmptyProofAt
    ? Date.parse(evidence.lastSuccessfulEmptyProofAt)
    : NaN;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
  return last - first >= GH_ENTRY_NOT_FOUND_MIN_SPAN_MS;
}

async function resolveClosingDeal(args: {
  ownerUid: string;
  order: BrokerHistoricalOrder;
  positionId: string;
  deals: readonly BrokerDealEvidence[];
  /**
   * When true, in-memory deals may be early-stopped / truncated and must not
   * be treated as complete multi-deal settlement evidence.
   */
  dealsMayBeTruncatedForClose: boolean;
  window: { fromTimestampMs: number; toTimestampMs: number };
}): Promise<
  | { ok: true; deal: BrokerClosedDeal }
  | { ok: false; unavailable: boolean }
> {
  // Only aggregate from already-collected evidence when that history is
  // proven exhaustive for the close (no early-stop / hasMore truncation).
  if (!args.dealsMayBeTruncatedForClose) {
    const matched = dealsMatchingOrderOrPosition({
      deals: args.deals,
      orderId: args.order.orderId,
      positionId: args.positionId
    });
    const closingFromEvidence = matched
      .map((d) => d.close)
      .filter((c): c is BrokerClosedDeal => c != null && c.netPnl != null);
    if (closingFromEvidence.length > 0) {
      const agg = aggregateClosingDeals(closingFromEvidence);
      if (agg) return { ok: true, deal: agg };
    }
  }

  // Authoritative FINAL settlement: exhaustive by-position (all closing deals).
  const byPos = await fetchDemoClosingDealForPosition({
    ownerUid: args.ownerUid,
    positionId: args.positionId,
    ...args.window
  });
  if (!byPos.ok) return { ok: false, unavailable: true };
  if (!byPos.value.complete) {
    return { ok: false, unavailable: true };
  }
  if (byPos.value.deal && byPos.value.deal.netPnl != null) {
    return { ok: true, deal: byPos.value.deal };
  }
  return { ok: false, unavailable: false };
}

function orderStatusFromDealKind(kind: BrokerDealStatusKind): {
  orderStatus: string;
  orderStatusCode: number | null;
} {
  if (kind === "FILLED") {
    return { orderStatus: "ORDER_STATUS_FILLED", orderStatusCode: 2 };
  }
  if (kind === "PARTIALLY_FILLED") {
    return { orderStatus: "ORDER_STATUS_PARTIALLY_FILLED", orderStatusCode: null };
  }
  if (kind === "REJECTED" || kind === "INTERNALLY_REJECTED") {
    return { orderStatus: "ORDER_STATUS_REJECTED", orderStatusCode: 4 };
  }
  if (kind === "ERROR") {
    return { orderStatus: "ORDER_STATUS_ERROR", orderStatusCode: 6 };
  }
  if (kind === "MISSED") {
    return { orderStatus: "ORDER_STATUS_MISSED", orderStatusCode: 7 };
  }
  return { orderStatus: "ORDER_STATUS_UNKNOWN", orderStatusCode: null };
}

/**
 * Build a historical-order stub from deal evidence.
 * Never invents ORDER_STATUS_FILLED for REJECTED / ERROR / MISSED deals.
 */
function orderStubFromDealEvidence(
  deal: BrokerDealEvidence,
  trade: GoldHunterDemoTrade
): BrokerHistoricalOrder {
  const kind = normalizeBrokerDealStatus(deal.dealStatus);
  const { orderStatus, orderStatusCode } = orderStatusFromDealKind(kind);
  return {
    orderId: deal.orderId ?? `recovered:${deal.dealId}`,
    positionId: deal.positionId,
    clientOrderId: trade.clientOrderId ?? null,
    orderStatus,
    orderStatusCode,
    tradeSide: deal.tradeSide ?? trade.side,
    symbolId: deal.symbolId,
    label: deal.label ?? trade.goldHunterTradeId,
    comment: deal.comment,
    executionPrice: deal.executionPrice,
    executedVolumeLots: deal.filledVolumeLots,
    createdAt: deal.executedAt,
    updatedAt: deal.executedAt,
    closingOrder: deal.isClosing
  };
}

/** Prefer a successful-execution labelled deal for fill stubs. */
function pickSuccessfulDealForStub(
  successful: readonly BrokerDealEvidence[]
): BrokerDealEvidence | null {
  if (!successful.length) return null;
  // Prefer FILLED over PARTIALLY_FILLED; then latest by executedAt.
  const filled = successful.filter(
    (d) => normalizeBrokerDealStatus(d.dealStatus) === "FILLED"
  );
  const pool = filled.length ? filled : [...successful];
  return (
    [...pool].sort(
      (a, b) =>
        Date.parse(b.executedAt ?? "") - Date.parse(a.executedAt ?? "")
    )[0] ?? null
  );
}

function sumSuccessfulFilledVolumeLots(
  successful: readonly BrokerDealEvidence[]
): number | null {
  let sum = 0;
  let any = false;
  for (const d of successful) {
    if (d.filledVolumeLots != null) {
      sum += d.filledVolumeLots;
      any = true;
    }
  }
  return any ? Number(sum.toFixed(8)) : null;
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
      result.stillPending += 1;
      continue;
    }

    let evidence = normalizeEvidence(trade.entryReconcileEvidence, nowIso);
    evidence = {
      ...evidence,
      reconciliationAttempts: evidence.reconciliationAttempts + 1
    };

    const window = goldHunterEntryHistoryQueryWindow({
      orderTs: trade.orderTs,
      nowMs
    });

    // --- Authoritative historical order by exact clientOrderId ---
    const orderLookup = await lookupDemoOrderByClientOrderId({
      ownerUid: args.ownerUid,
      clientOrderId,
      orderTs: trade.orderTs,
      nowMs
    });

    if (!orderLookup.ok) {
      // Partial / failed — do NOT increment empty-proof cycles.
      evidence = {
        ...evidence,
        lastBrokerReadOk: false,
        lastHistoryComplete: false
      };
      await persistEvidence(args.ownerUid, trade, evidence);
      result.brokerUnavailable += 1;
      result.stillPending += 1;
      continue;
    }

    const order = orderLookup.value.order;
    const orderHistoryComplete = orderLookup.value.complete;

    if (order && order.orderStatusCode === 3) {
      await persistRejected({
        ownerUid: args.ownerUid,
        trade,
        order,
        evidence: { ...evidence, lastBrokerReadOk: true, lastHistoryComplete: true }
      });
      result.rejected += 1;
      continue;
    }

    // Resolve positionId: order.positionId OR opening deal.orderId match.
    let resolvedPositionId = order?.positionId
      ? String(order.positionId)
      : null;
    let deals: BrokerDealEvidence[] = [];
    let dealsComplete = false;

    if (order && !resolvedPositionId) {
      const dealsRead = await fetchDemoHistoricalDealEvidenceExhaustive({
        ownerUid: args.ownerUid,
        ...window,
        earlyStop: { mode: "OPENING_FOR_ORDER", orderId: order.orderId }
      });
      if (!dealsRead.ok) {
        evidence = {
          ...evidence,
          lastBrokerReadOk: false,
          lastHistoryComplete: false
        };
        await persistEvidence(args.ownerUid, trade, evidence);
        result.brokerUnavailable += 1;
        result.stillPending += 1;
        continue;
      }
      deals = dealsRead.items;
      dealsComplete = dealsRead.complete;
      resolvedPositionId = resolvePositionIdFromDeals({
        orderId: order.orderId,
        deals
      });
      // Finding the opening deal is enough even if the rest of the window
      // was truncated — we have exact orderId→positionId correlation.
      if (resolvedPositionId) {
        dealsComplete = true;
      } else if (!dealsComplete) {
        evidence = {
          ...evidence,
          lastBrokerReadOk: false,
          lastHistoryComplete: false
        };
        await persistEvidence(args.ownerUid, trade, evidence);
        result.brokerUnavailable += 1;
        result.stillPending += 1;
        continue;
      }
    }

    // --- Current open positions (Case A) ---
    // Soft label/comment open matches are only safe once we already have
    // exact order or positionId evidence. Otherwise defer to deal-label path.
    if (args.positionsReadOk) {
      const openMatch = matchOpenByClientOrderId(
        args.brokerPositions,
        trade,
        order,
        resolvedPositionId
      );
      const exactPos =
        resolvedPositionId != null &&
        openMatch != null &&
        openMatch.positionId === resolvedPositionId;
      const orderBacked =
        order != null &&
        openMatch != null &&
        (order.positionId === openMatch.positionId ||
          isProvenGhOpenMatch(openMatch, trade));
      if (openMatch && (exactPos || orderBacked)) {
        await recoverOpenFromPosition({
          ownerUid: args.ownerUid,
          trade,
          match: openMatch,
          order,
          evidence: {
            ...evidence,
            lastBrokerReadOk: true,
            lastHistoryComplete: orderHistoryComplete
          }
        });
        result.recoveredOpen += 1;
        continue;
      }
    }

    if (order && (order.orderStatusCode === 1 || order.orderStatusCode === 2)) {
      // CASE C / D — order known; try closed reconstruction when no open match.
      // FINAL close settlement always uses exhaustive by-position (never first-close).
      if (!resolvedPositionId) {
        // Order exists but position still unknown — keep pending (Case D).
        await persistEvidence(args.ownerUid, trade, {
          ...evidence,
          lastBrokerReadOk: true,
          lastHistoryComplete: orderHistoryComplete && dealsComplete,
          terminalReason: null
        });
        result.stillPending += 1;
        continue;
      }

      const closing = await resolveClosingDeal({
        ownerUid: args.ownerUid,
        order,
        positionId: resolvedPositionId,
        deals,
        dealsMayBeTruncatedForClose: true,
        window
      });
      if (closing.ok) {
        await persistClosedFromDeals({
          ownerUid: args.ownerUid,
          trade,
          order,
          deal: closing.deal,
          positionId: resolvedPositionId,
          evidence: {
            ...evidence,
            lastBrokerReadOk: true,
            lastHistoryComplete: true
          }
        });
        result.recoveredClosed += 1;
        continue;
      }
      if (closing.unavailable) {
        evidence = {
          ...evidence,
          lastBrokerReadOk: false,
          lastHistoryComplete: false
        };
        await persistEvidence(args.ownerUid, trade, evidence);
        result.brokerUnavailable += 1;
        result.stillPending += 1;
        continue;
      }

      // CASE D — order/position known, not yet closed / no closing deal yet.
      await persistEvidence(args.ownerUid, trade, {
        ...evidence,
        lastBrokerReadOk: true,
        lastHistoryComplete: orderHistoryComplete && dealsComplete,
        terminalReason: null
      });
      result.stillPending += 1;
      continue;
    }

    if (order) {
      // Non-rejected, non-fill status — keep pending.
      await persistEvidence(args.ownerUid, trade, {
        ...evidence,
        lastBrokerReadOk: true,
        lastHistoryComplete: orderHistoryComplete,
        terminalReason: null
      });
      result.stillPending += 1;
      continue;
    }

    // --- No exact order found ---
    // Incomplete history must NOT count toward empty-proof cycles (P3).
    if (!orderHistoryComplete) {
      evidence = {
        ...evidence,
        lastBrokerReadOk: false,
        lastHistoryComplete: false
      };
      await persistEvidence(args.ownerUid, trade, evidence);
      result.brokerUnavailable += 1;
      result.stillPending += 1;
      continue;
    }

    if (!args.positionsReadOk) {
      // E2: open read failed — no complete proof cycle.
      evidence = {
        ...evidence,
        lastBrokerReadOk: false,
        lastHistoryComplete: orderHistoryComplete
      };
      await persistEvidence(args.ownerUid, trade, evidence);
      result.brokerUnavailable += 1;
      result.stillPending += 1;
      continue;
    }

    const dealsRead = await fetchDemoHistoricalDealEvidenceExhaustive({
      ownerUid: args.ownerUid,
      ...window
      // No early-stop: NEVER_FOUND requires exhaustive empty DealList.
    });
    if (!dealsRead.ok || !dealsRead.complete) {
      // E1 / incomplete deals — no empty-proof increment.
      evidence = {
        ...evidence,
        lastBrokerReadOk: false,
        lastHistoryComplete: false
      };
      await persistEvidence(args.ownerUid, trade, evidence);
      result.brokerUnavailable += 1;
      result.stillPending += 1;
      continue;
    }

    // Exact goldHunterTradeId label on a deal is POSITIVE broker evidence —
    // never count as an empty proof cycle. Classify by dealStatus across the
    // complete labelled set — never trust arbitrary list order.
    const labelClass = classifyExactLabelledDeals(
      dealsRead.items,
      trade.goldHunterTradeId
    );
    if (labelClass.labelled.length > 0) {
      const successfulDeal = pickSuccessfulDealForStub(labelClass.successful);
      // Prefer positionId from successful execution deals; else any labelled.
      const positionIdRaw =
        successfulDeal?.positionId ??
        labelClass.labelled.find((d) => d.positionId)?.positionId ??
        null;
      const positionId = positionIdRaw ? String(positionIdRaw) : null;

      // Terminal labelled failures with NO successful execution:
      // REJECTED / INTERNALLY_REJECTED → BROKER_REJECTED
      // ERROR / MISSED → BROKER_SUBMIT_ERROR (not "rejected")
      // UNKNOWN remains fail-closed / PENDING (handled below).
      if (labelClass.allTerminalFailure && !labelClass.hasSuccessfulExecution) {
        if (positionId && args.positionsReadOk) {
          const openMatch = matchOpenByPositionId(
            args.brokerPositions,
            positionId
          );
          if (openMatch) {
            // Unexpected residual exposure with only failure-labelled deals —
            // fail closed pending (do not invent rejection while open exists).
            await persistEvidence(args.ownerUid, trade, {
              ...evidence,
              lastBrokerReadOk: true,
              lastHistoryComplete: true,
              terminalReason: null
            });
            result.stillPending += 1;
            continue;
          }
        }
        const kinds = labelClass.terminalFailure.map((d) =>
          normalizeBrokerDealStatus(d.dealStatus)
        );
        const hasReject = kinds.some(
          (k) => k === "REJECTED" || k === "INTERNALLY_REJECTED"
        );
        const hasError = kinds.some((k) => k === "ERROR");
        const hasMissed = kinds.some((k) => k === "MISSED");

        if (hasReject) {
          const failDeal =
            labelClass.terminalFailure.find((d) => {
              const k = normalizeBrokerDealStatus(d.dealStatus);
              return k === "REJECTED" || k === "INTERNALLY_REJECTED";
            }) ?? labelClass.terminalFailure[0]!;
          const rejectStub = orderStubFromDealEvidence(failDeal, trade);
          await persistRejected({
            ownerUid: args.ownerUid,
            trade,
            order: rejectStub,
            evidence: {
              ...evidence,
              lastBrokerReadOk: true,
              lastHistoryComplete: true,
              terminalReason: "HISTORICAL_DEAL_REJECTED"
            }
          });
          result.rejected += 1;
          continue;
        }

        if (hasError || hasMissed) {
          const failDeal =
            labelClass.terminalFailure.find((d) => {
              const k = normalizeBrokerDealStatus(d.dealStatus);
              return k === "ERROR" || k === "MISSED";
            }) ?? labelClass.terminalFailure[0]!;
          const stub = orderStubFromDealEvidence(failDeal, trade);
          const errorCode = hasError ? "BROKER_DEAL_ERROR" : "BROKER_DEAL_MISSED";
          await persistDealSubmitError({
            ownerUid: args.ownerUid,
            trade,
            order: stub,
            evidence: {
              ...evidence,
              lastBrokerReadOk: true,
              lastHistoryComplete: true
            },
            errorCode,
            terminalReason: hasError
              ? "HISTORICAL_DEAL_ERROR"
              : "HISTORICAL_DEAL_MISSED"
          });
          // Counted as terminalized entry (not open); not a broker "rejection".
          result.rejected += 1;
          continue;
        }

        // Unexpected terminal classification — fail closed.
        await persistEvidence(args.ownerUid, trade, {
          ...evidence,
          lastBrokerReadOk: true,
          lastHistoryComplete: true,
          terminalReason: null
        });
        result.stillPending += 1;
        continue;
      }

      // Successful (FILLED/PARTIALLY_FILLED) OR unknown/legacy null status.
      // Unknown may still correlate to real exposure; never invent rejection.
      // Explicit terminal failures alone are handled above (S1/S5).
      const execCandidates = [
        ...labelClass.successful,
        ...labelClass.unknown
      ];
      if (execCandidates.length > 0) {
        const primary =
          pickSuccessfulDealForStub(labelClass.successful) ??
          [...labelClass.unknown].sort(
            (a, b) =>
              Date.parse(b.executedAt ?? "") - Date.parse(a.executedAt ?? "")
          )[0] ??
          execCandidates[0]!;
        const stub = orderStubFromDealEvidence(primary, trade);
        // When recovering a proven open/close, promote unknown stub to FILLED
        // only after broker position/settlement proof (never for reject-only).
        const filledVol =
          sumSuccessfulFilledVolumeLots(labelClass.successful) ??
          sumSuccessfulFilledVolumeLots(labelClass.unknown) ??
          stub.executedVolumeLots;

        if (positionId && args.positionsReadOk) {
          const openMatch = matchOpenByPositionId(
            args.brokerPositions,
            positionId
          );
          if (openMatch) {
            const openStub: BrokerHistoricalOrder = {
              ...stub,
              orderStatus:
                isSuccessfulExecutionDealStatus(
                  normalizeBrokerDealStatus(primary.dealStatus)
                ) || normalizeBrokerDealStatus(primary.dealStatus) === "UNKNOWN"
                  ? "ORDER_STATUS_FILLED"
                  : stub.orderStatus,
              orderStatusCode: 2,
              executedVolumeLots:
                openMatch.volumeLots ?? filledVol ?? stub.executedVolumeLots
            };
            await recoverOpenFromPosition({
              ownerUid: args.ownerUid,
              trade,
              match: openMatch,
              order: openStub,
              evidence: {
                ...evidence,
                lastBrokerReadOk: true,
                lastHistoryComplete: true,
                terminalReason: "RECOVERED_OPEN_FROM_DEAL_LABEL"
              }
            });
            result.recoveredOpen += 1;
            continue;
          }
        }

        if (positionId && labelClass.hasSuccessfulExecution) {
          // Exhaustive close settlement for proven successful execution deals.
          const closing = await resolveClosingDeal({
            ownerUid: args.ownerUid,
            order: stub,
            positionId,
            deals: dealsRead.items,
            dealsMayBeTruncatedForClose: true,
            window
          });
          if (closing.ok) {
            await persistClosedFromDeals({
              ownerUid: args.ownerUid,
              trade,
              order: stub,
              deal: closing.deal,
              positionId,
              evidence: {
                ...evidence,
                lastBrokerReadOk: true,
                lastHistoryComplete: true,
                terminalReason: "RECOVERED_CLOSED_FROM_DEAL_LABEL"
              }
            });
            result.recoveredClosed += 1;
            continue;
          }
          if (closing.unavailable) {
            evidence = {
              ...evidence,
              lastBrokerReadOk: false,
              lastHistoryComplete: false
            };
            await persistEvidence(args.ownerUid, trade, evidence);
            result.brokerUnavailable += 1;
            result.stillPending += 1;
            continue;
          }
        }

        // Unknown-status labelled deals: allow close recovery when exhaustive
        // closing history proves settlement (legacy null dealStatus).
        if (positionId && labelClass.unknown.length > 0) {
          const closing = await resolveClosingDeal({
            ownerUid: args.ownerUid,
            order: {
              ...stub,
              orderStatus: "ORDER_STATUS_FILLED",
              orderStatusCode: 2
            },
            positionId,
            deals: dealsRead.items,
            dealsMayBeTruncatedForClose: true,
            window
          });
          if (closing.ok) {
            await persistClosedFromDeals({
              ownerUid: args.ownerUid,
              trade,
              order: {
                ...stub,
                orderStatus: "ORDER_STATUS_FILLED",
                orderStatusCode: 2
              },
              deal: closing.deal,
              positionId,
              evidence: {
                ...evidence,
                lastBrokerReadOk: true,
                lastHistoryComplete: true,
                terminalReason: "RECOVERED_CLOSED_FROM_DEAL_LABEL"
              }
            });
            result.recoveredClosed += 1;
            continue;
          }
          if (closing.unavailable) {
            evidence = {
              ...evidence,
              lastBrokerReadOk: false,
              lastHistoryComplete: false
            };
            await persistEvidence(args.ownerUid, trade, evidence);
            result.brokerUnavailable += 1;
            result.stillPending += 1;
            continue;
          }
        }

        // Candidate fill evidence but open/closed not yet proven.
        await upsertGoldHunterDemoTrade(args.ownerUid, {
          ...trade,
          brokerOrderId: primary.orderId ?? trade.brokerOrderId,
          brokerPositionId: positionId ?? trade.brokerPositionId,
          entry: primary.executionPrice ?? trade.entry,
          fillTs: primary.executedAt ?? trade.fillTs,
          filledVolumeLots: filledVol ?? trade.filledVolumeLots,
          entryReconcileEvidence: {
            ...evidence,
            lastBrokerReadOk: true,
            lastHistoryComplete: true,
            terminalReason: null
          }
        });
        result.stillPending += 1;
        continue;
      }

      // Should not reach: labelled without successful/unknown/terminal paths.
      const anyLabel = labelClass.labelled[0]!;
      await upsertGoldHunterDemoTrade(args.ownerUid, {
        ...trade,
        brokerOrderId: anyLabel.orderId ?? trade.brokerOrderId,
        brokerPositionId: positionId ?? trade.brokerPositionId,
        entry: anyLabel.executionPrice ?? trade.entry,
        fillTs: anyLabel.executedAt ?? trade.fillTs,
        filledVolumeLots: anyLabel.filledVolumeLots ?? trade.filledVolumeLots,
        entryReconcileEvidence: {
          ...evidence,
          lastBrokerReadOk: true,
          lastHistoryComplete: true,
          terminalReason: null
        }
      });
      result.stillPending += 1;
      continue;
    }

    // Same-cycle complete empty proof:
    // open OK + no match, order exhaustive empty, deal exhaustive empty
    // AND no exact goldHunterTradeId label on any deal.
    evidence = recordEmptyProofCycle(evidence, nowIso);

    if (canTerminalNeverFound(evidence)) {
      await persistNeverFound({ ownerUid: args.ownerUid, trade, evidence });
      result.terminalNotFound += 1;
      continue;
    }

    await persistEvidence(args.ownerUid, trade, evidence);
    result.stillPending += 1;
  }

  return result;
}

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
