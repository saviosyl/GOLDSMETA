/**
 * Dedicated asynchronous OPEN-entry recovery for a known broker position.
 *
 * Launched after the 2500ms immediate recovery fails when:
 *   brokerPositionId present AND entry invalid AND entry-side pending.
 *
 * Does NOT depend on another opportunity, AutoTrade remaining ON, or the
 * 30s general reconciliation cadence. Never places NewOrder. Never invents
 * entry. Never widens stop. Never creates a duplicate trade.
 *
 * Horizon is ~10s from the first recovery start (openEntryRecoveryStartedAt).
 * Each broker read is raced against the remaining supervisor budget.
 */
import type {
  BrokerDealEvidence,
  BrokerHistoricalOrder
} from "../broker/ctrader/openApiClient";
import {
  isSuccessfulExecutionDealStatus,
  isSuccessfulOpeningHistoricalOrder,
  normalizeBrokerDealStatus
} from "../broker/ctrader/openApiClient";
import {
  fetchDemoClosingDealEvidenceEarly,
  fetchDemoHistoricalDealEvidenceExhaustive,
  goldHunterEntryHistoryQueryWindow,
  lookupDemoOrderByClientOrderId
} from "../broker/ctrader/demoBrokerHistory";
import { reconcileDemoBrokerPositions } from "../broker/ctrader/demoPositionMutations";
import type { BrokerOpenPosition } from "../broker/ctrader/openApiClient";
import {
  registerGoldHunterOpenPositionForOwner,
  unregisterGoldHunterManagedPosition
} from "./demoPositionManager";
import {
  signalGoldHunterEntryIntegrityRecovered,
  signalGoldHunterOpenEntryIntegrityDefect,
  syncGoldHunterOpenEntryIntegrityHealth,
  tradeHasAuthoritativeEntryIntegrity
} from "./entryIntegrity";
import {
  goldHunterFrozenInitialRiskPrice,
  repairGoldHunterTradeFromBrokerPosition
} from "./entryRepair";
import { isValidGoldHunterEntryPrice } from "./entryValidity";
import { updateGoldHunterSignalClaim } from "./signalClaimStore";
import {
  getGoldHunterDemoTrade,
  isGoldHunterClosedTerminal,
  listGoldHunterDemoTrades,
  upsertGoldHunterDemoTrade
} from "./tradeStore";
import type { GoldHunterDemoTrade } from "./types";
import type { BrokerDemoPositionLite } from "./reconcilePositions";

export const GH_KNOWN_POSITION_ENTRY_RECOVERY_HORIZON_MS = 10_000;
export const GH_OPEN_ENTRY_SUPERVISOR_POLL_MS = 250;

export type OpenEntryRecoveryReason =
  | "RECOVERED_OPEN"
  | "POSITION_NOT_FOUND_WITHIN_WINDOW"
  | "ENTRY_INVALID_WITHIN_WINDOW"
  | "POSITIONS_READ_FAILED"
  | "TIMEOUT"
  | "POSITION_CLOSED_BEFORE_RECOVERY"
  | "NO_POSITION_ID"
  | "SKIPPED_STATUS"
  | "ALREADY_VALID";

export type OpenEntryRecoverySource =
  | "BROKER_POSITION_RECONCILIATION"
  | "BROKER_ORDER_EXECUTION_RECONCILIATION"
  | "BROKER_OPENING_DEAL_RECONCILIATION";

export type KnownPositionEntrySupervisorResult = {
  recovered: boolean;
  trade: GoldHunterDemoTrade;
  reason: OpenEntryRecoveryReason;
  attempts: number;
  newOrderCalls: number;
  pmRegistered: boolean;
};

export type KnownPositionEntrySupervisorHooks = {
  listPositions?: (ownerUid: string) => Promise<BrokerOpenPosition[]>;
  findHistoricalOrder?: (
    trade: GoldHunterDemoTrade
  ) => Promise<BrokerHistoricalOrder | null>;
  findOpeningDeal?: (
    trade: GoldHunterDemoTrade
  ) => Promise<BrokerDealEvidence | null>;
  findClosingDeal?: (
    trade: GoldHunterDemoTrade
  ) => Promise<{ dealId: string } | null>;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const inFlight = new Map<string, Promise<KnownPositionEntrySupervisorResult>>();
let hooks: KnownPositionEntrySupervisorHooks = {};
let newOrderCalls = 0;

export function setKnownPositionEntrySupervisorHooksForTests(
  h: KnownPositionEntrySupervisorHooks
): void {
  hooks = h;
}

export function resetKnownPositionEntrySupervisorForTests(): void {
  hooks = {};
  inFlight.clear();
  newOrderCalls = 0;
}

export function getGoldHunterSupervisorNewOrderCallCount(): number {
  return newOrderCalls;
}

export function supervisorDedupeKey(
  ownerUid: string,
  tradeId: string
): string {
  return `${ownerUid}:${tradeId}`;
}

function isDurableOpenPromotion(trade: GoldHunterDemoTrade): boolean {
  if (isGoldHunterClosedTerminal(trade)) return false;
  return (
    trade.status === "FILLED" ||
    trade.status === "PROTECTED" ||
    trade.result === "OPEN"
  );
}

export function isGoldHunterKnownPositionEntrySupervisorInFlight(
  ownerUid: string,
  tradeId: string
): boolean {
  return inFlight.has(supervisorDedupeKey(ownerUid, tradeId));
}

/**
 * Quote-worker resume must not relaunch an expired or terminally-resolved
 * known-position supervisor. Does not reset openEntryRecoveryStartedAt.
 */
export function isGoldHunterKnownPositionEntrySupervisorResumeEligible(
  trade: GoldHunterDemoTrade,
  now = Date.now(),
  horizonMs = GH_KNOWN_POSITION_ENTRY_RECOVERY_HORIZON_MS
): boolean {
  if (!isKnownBrokerPositionEntryPending(trade)) return false;
  if (trade.openEntryRecoveryLastReason === "TIMEOUT") return false;
  if (trade.openEntryRecoveryLastReason === "POSITION_CLOSED_BEFORE_RECOVERY") {
    return false;
  }
  const startedMs = Date.parse(trade.openEntryRecoveryStartedAt ?? "");
  if (Number.isFinite(startedMs) && startedMs + horizonMs <= now) {
    return false;
  }
  return true;
}

export function isKnownBrokerPositionEntryPending(
  trade: GoldHunterDemoTrade
): boolean {
  if (!trade.brokerPositionId) return false;
  if (isGoldHunterClosedTerminal(trade)) return false;
  if (
    trade.status === "BROKER_REJECTED" ||
    trade.status === "BROKER_SUBMIT_ERROR" ||
    trade.status === "CLOSE_REQUESTED" ||
    trade.status === "CLOSE_ACCEPTED_PENDING_SETTLEMENT" ||
    trade.status === "FILLED" ||
    trade.status === "PROTECTED"
  ) {
    return false;
  }
  if (
    trade.status !== "PENDING_RECONCILIATION" &&
    trade.status !== "ACCEPTED_PENDING_FILL"
  ) {
    return false;
  }
  if (trade.exitReason && String(trade.errorCode ?? "").startsWith("CLOSE_")) {
    return false;
  }
  return !isValidGoldHunterEntryPrice(trade.entry);
}

class SupervisorReadTimeoutError extends Error {
  constructor() {
    super("OPEN_ENTRY_SUPERVISOR_READ_TIMEOUT");
    this.name = "SupervisorReadTimeoutError";
  }
}

async function withRemainingReadTimeout<T>(
  remainingMs: number,
  work: () => Promise<T>
): Promise<T> {
  const ms = Number.isFinite(remainingMs) && remainingMs > 0 ? remainingMs : 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new SupervisorReadTimeoutError()), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Bound every broker/history read by remaining supervisor budget. */
async function budgetedRead<T>(
  deadline: number,
  work: () => Promise<T>
): Promise<T> {
  const remainingMs = deadline - nowMs();
  if (remainingMs <= 0) throw new SupervisorReadTimeoutError();
  return withRemainingReadTimeout(remainingMs, work);
}

function isSuccessfulOpeningDeal(deal: BrokerDealEvidence): boolean {
  if (deal.isClosing) return false;
  if (!isValidGoldHunterEntryPrice(deal.executionPrice)) return false;
  return isSuccessfulExecutionDealStatus(
    normalizeBrokerDealStatus(deal.dealStatus)
  );
}

function sleep(ms: number): Promise<void> {
  if (hooks.sleep) return hooks.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs(): number {
  return hooks.nowMs ? hooks.nowMs() : Date.now();
}

function toLite(p: BrokerOpenPosition): BrokerDemoPositionLite {
  return {
    positionId: String(p.positionId),
    comment: p.comment ?? null,
    label: p.label ?? null,
    side: p.side === "SELL" ? "SELL" : p.side === "BUY" ? "BUY" : null,
    volumeLots: p.volumeLots ?? null,
    entryPrice: p.entryPrice ?? null,
    stopLoss: p.stopLoss ?? null
  };
}

async function persistForensics(
  ownerUid: string,
  trade: GoldHunterDemoTrade,
  patch: Partial<GoldHunterDemoTrade>
): Promise<GoldHunterDemoTrade> {
  const next = { ...trade, ...patch };
  const persisted = await upsertGoldHunterDemoTrade(ownerUid, next);
  return persisted.trade;
}

async function stampSupervisorTimeout(
  ownerUid: string,
  trade: GoldHunterDemoTrade,
  attempts: number
): Promise<GoldHunterDemoTrade> {
  return persistForensics(ownerUid, trade, {
    openEntryRecoveryAttempts: attempts,
    openEntryRecoveryLastAt: new Date().toISOString(),
    openEntryRecoveryLastReason: "TIMEOUT"
  });
}

type FreshOpenProof =
  | { kind: "open"; positions: BrokerOpenPosition[] }
  | { kind: "absent" }
  | { kind: "failed" }
  | { kind: "timeout" };

async function confirmPositionStillOpen(args: {
  ownerUid: string;
  positionId: string;
  deadline: number;
  list: (ownerUid: string) => Promise<BrokerOpenPosition[]>;
}): Promise<FreshOpenProof> {
  try {
    const positions = await budgetedRead(args.deadline, () =>
      args.list(args.ownerUid)
    );
    if (!Array.isArray(positions)) return { kind: "failed" };
    const present = positions.some(
      (p) => String(p.positionId) === String(args.positionId)
    );
    return present ? { kind: "open", positions } : { kind: "absent" };
  } catch (error) {
    if (error instanceof SupervisorReadTimeoutError) return { kind: "timeout" };
    return { kind: "failed" };
  }
}

async function defaultFindHistoricalOrder(
  ownerUid: string,
  trade: GoldHunterDemoTrade
): Promise<BrokerHistoricalOrder | null> {
  if (hooks.findHistoricalOrder) {
    return hooks.findHistoricalOrder(trade);
  }
  const clientOrderId = trade.clientOrderId?.trim();
  if (!clientOrderId) return null;
  const read = await lookupDemoOrderByClientOrderId({
    ownerUid,
    clientOrderId,
    orderTs: trade.orderTs
  });
  if (!read.ok || !read.value.order) return null;
  const order = read.value.order;
  if (!isSuccessfulOpeningHistoricalOrder(order)) return null;
  if (!isValidGoldHunterEntryPrice(order.executionPrice)) return null;
  if (
    trade.brokerPositionId &&
    order.positionId &&
    String(order.positionId) !== String(trade.brokerPositionId)
  ) {
    return null;
  }
  if (
    trade.brokerOrderId &&
    order.orderId &&
    String(order.orderId) !== String(trade.brokerOrderId)
  ) {
    return null;
  }
  return order;
}

async function defaultFindOpeningDeal(
  ownerUid: string,
  trade: GoldHunterDemoTrade
): Promise<BrokerDealEvidence | null> {
  if (hooks.findOpeningDeal) {
    return hooks.findOpeningDeal(trade);
  }
  const window = goldHunterEntryHistoryQueryWindow({ orderTs: trade.orderTs });
  const earlyStop = trade.brokerOrderId
    ? ({ mode: "OPENING_FOR_ORDER", orderId: String(trade.brokerOrderId) } as const)
    : null;
  const read = await fetchDemoHistoricalDealEvidenceExhaustive({
    ownerUid,
    ...window,
    earlyStop
  });
  if (!read.ok) return null;
  return (
    read.items.find((d) => {
      if (!isSuccessfulOpeningDeal(d)) return false;
      if (
        trade.brokerPositionId &&
        d.positionId &&
        String(d.positionId) === String(trade.brokerPositionId)
      ) {
        return true;
      }
      if (
        trade.brokerOrderId &&
        d.orderId &&
        String(d.orderId) === String(trade.brokerOrderId)
      ) {
        return true;
      }
      return false;
    }) ?? null
  );
}

async function defaultFindClosingDeal(
  ownerUid: string,
  trade: GoldHunterDemoTrade
): Promise<{ dealId: string } | null> {
  if (hooks.findClosingDeal) {
    return hooks.findClosingDeal(trade);
  }
  if (!trade.brokerPositionId) return null;
  const window = goldHunterEntryHistoryQueryWindow({ orderTs: trade.orderTs });
  const read = await fetchDemoClosingDealEvidenceEarly({
    ownerUid,
    positionId: String(trade.brokerPositionId),
    ...window
  });
  if (!read.ok) return null;
  const hit = read.items.find((d) => d.netPnl != null);
  return hit ? { dealId: hit.dealId } : null;
}

async function promoteOpen(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  entry: number;
  source: OpenEntryRecoverySource;
  fillTs?: string | null;
  filledVolumeLots?: number | null;
  stop?: number | null;
  bid?: number | null;
  ask?: number | null;
  attempts: number;
}): Promise<GoldHunterDemoTrade> {
  const now = new Date().toISOString();
  const recovered: GoldHunterDemoTrade = {
    ...args.trade,
    entry: args.entry,
    fillTs: args.trade.fillTs ?? args.fillTs ?? now,
    status: "FILLED",
    result: "OPEN",
    errorCode: null,
    dataQuality: null,
    entryRecoverySource: args.source,
    openEntryRecoverySource: args.source,
    openEntryRecoveryLastReason: "RECOVERED_OPEN",
    openEntryRecoveryLastAt: now,
    openEntryRecoveryAttempts: args.attempts,
    openEntryRecoveredAt: now,
    initialRiskPrice:
      args.trade.initialRiskPrice != null &&
      Number.isFinite(args.trade.initialRiskPrice) &&
      args.trade.initialRiskPrice > 0
        ? args.trade.initialRiskPrice
        : goldHunterFrozenInitialRiskPrice(),
    filledVolumeLots: args.filledVolumeLots ?? args.trade.filledVolumeLots,
    stop: args.stop ?? args.trade.stop
  };
  const persisted = await upsertGoldHunterDemoTrade(args.ownerUid, recovered);
  if (isGoldHunterClosedTerminal(persisted.trade)) {
    unregisterGoldHunterManagedPosition(
      args.ownerUid,
      recovered.goldHunterTradeId
    );
    return persisted.trade;
  }
  const bid =
    args.bid != null && Number.isFinite(args.bid) ? args.bid : recovered.entry!;
  const ask =
    args.ask != null && Number.isFinite(args.ask) ? args.ask : recovered.entry!;
  registerGoldHunterOpenPositionForOwner({
    ownerUid: args.ownerUid,
    trade: persisted.trade,
    bid,
    ask
  });
  const withPm = await persistForensics(args.ownerUid, persisted.trade, {
    openEntryPmRegisteredAt: new Date().toISOString()
  });
  if (!isDurableOpenPromotion(withPm)) {
    unregisterGoldHunterManagedPosition(
      args.ownerUid,
      recovered.goldHunterTradeId
    );
    return withPm;
  }
  if (tradeHasAuthoritativeEntryIntegrity(withPm)) {
    signalGoldHunterEntryIntegrityRecovered({
      ownerUid: args.ownerUid,
      reason: "BROKER_POSITION_OPEN_RECOVERED",
      tradeId: withPm.goldHunterTradeId
    });
  }
  await syncGoldHunterOpenEntryIntegrityHealth(args.ownerUid);
  if (withPm.signalId) {
    await updateGoldHunterSignalClaim(args.ownerUid, withPm.signalId, {
      state: "OPEN",
      brokerOrderId: withPm.brokerOrderId ?? null,
      brokerPositionId: withPm.brokerPositionId ?? null,
      goldHunterTradeId: withPm.goldHunterTradeId,
      errorCode: null
    });
  }
  return withPm;
}

async function runSupervisor(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  bid?: number | null;
  ask?: number | null;
  timeoutMs?: number;
  pollMs?: number;
  listPositions?: (ownerUid: string) => Promise<BrokerOpenPosition[]>;
}): Promise<KnownPositionEntrySupervisorResult> {
  const ownerUid = args.ownerUid;
  let trade =
    (await getGoldHunterDemoTrade(ownerUid, args.trade.goldHunterTradeId)) ??
    args.trade;
  const startedAt =
    trade.openEntryRecoveryStartedAt ??
    args.trade.openEntryRecoveryStartedAt ??
    new Date().toISOString();
  const horizon = args.timeoutMs ?? GH_KNOWN_POSITION_ENTRY_RECOVERY_HORIZON_MS;
  const startMs = Date.parse(startedAt);
  const deadline = (Number.isFinite(startMs) ? startMs : nowMs()) + horizon;
  const pollMs = args.pollMs ?? GH_OPEN_ENTRY_SUPERVISOR_POLL_MS;
  let attempts = trade.openEntryRecoveryAttempts ?? 0;
  let lastReason: OpenEntryRecoveryReason = "POSITION_NOT_FOUND_WITHIN_WINDOW";
  let successfulReads = 0;
  let sawMatchWithInvalidEntry = false;

  trade = await persistForensics(ownerUid, trade, {
    openEntryRecoveryStartedAt: startedAt,
    openEntryRecoveryLastAt: new Date().toISOString(),
    openEntryRecoveryLastReason: lastReason,
    openEntryRecoveryAttempts: attempts
  });
  signalGoldHunterOpenEntryIntegrityDefect({
    ownerUid,
    tradeId: trade.goldHunterTradeId,
    reason: "PROVEN_OPEN_ENTRY_INVALID"
  });

  if (!trade.brokerPositionId) {
    trade = await persistForensics(ownerUid, trade, {
      openEntryRecoveryLastReason: "NO_POSITION_ID",
      openEntryRecoveryLastAt: new Date().toISOString()
    });
    return {
      recovered: false,
      trade,
      reason: "NO_POSITION_ID",
      attempts,
      newOrderCalls,
      pmRegistered: false
    };
  }

  const list =
    args.listPositions ??
    hooks.listPositions ??
    ((uid: string) => reconcileDemoBrokerPositions(uid));

  while (true) {
    const latest = await getGoldHunterDemoTrade(
      ownerUid,
      trade.goldHunterTradeId
    );
    if (latest) trade = latest;
    if (isGoldHunterClosedTerminal(trade)) {
      lastReason = "POSITION_CLOSED_BEFORE_RECOVERY";
      break;
    }
    if (
      tradeHasAuthoritativeEntryIntegrity(trade) &&
      (trade.status === "FILLED" ||
        trade.status === "PROTECTED" ||
        trade.result === "OPEN")
    ) {
      lastReason = "ALREADY_VALID";
      break;
    }
    if (!isKnownBrokerPositionEntryPending(trade)) {
      lastReason = "SKIPPED_STATUS";
      break;
    }

    const remainingMs = deadline - nowMs();
    if (remainingMs <= 0) {
      if (successfulReads === 0 && lastReason !== "POSITIONS_READ_FAILED") {
        lastReason = "TIMEOUT";
      } else if (lastReason === "POSITION_NOT_FOUND_WITHIN_WINDOW") {
        lastReason = "POSITION_NOT_FOUND_WITHIN_WINDOW";
      } else if (sawMatchWithInvalidEntry) {
        lastReason = "ENTRY_INVALID_WITHIN_WINDOW";
      } else if (successfulReads === 0) {
        lastReason = "TIMEOUT";
      }
      break;
    }

    attempts += 1;
    let positions: BrokerOpenPosition[];
    try {
      positions = await budgetedRead(deadline, () => list(ownerUid));
      if (!Array.isArray(positions)) {
        lastReason = "POSITIONS_READ_FAILED";
        trade = await persistForensics(ownerUid, trade, {
          openEntryRecoveryAttempts: attempts,
          openEntryRecoveryLastAt: new Date().toISOString(),
          openEntryRecoveryLastReason: lastReason
        });
        const remain = deadline - nowMs();
        if (remain <= 0) break;
        await sleep(Math.min(pollMs, remain));
        continue;
      }
      successfulReads += 1;
    } catch (error) {
      if (error instanceof SupervisorReadTimeoutError) {
        lastReason = "TIMEOUT";
        trade = await stampSupervisorTimeout(ownerUid, trade, attempts);
        return {
          recovered: false,
          trade,
          reason: "TIMEOUT",
          attempts,
          newOrderCalls,
          pmRegistered: false
        };
      }
      lastReason = "POSITIONS_READ_FAILED";
      trade = await persistForensics(ownerUid, trade, {
        openEntryRecoveryAttempts: attempts,
        openEntryRecoveryLastAt: new Date().toISOString(),
        openEntryRecoveryLastReason: lastReason
      });
      const remain = deadline - nowMs();
      if (remain <= 0) break;
      await sleep(Math.min(pollMs, remain));
      continue;
    }

    const match = positions
      .map(toLite)
      .find((p) => String(p.positionId) === String(trade.brokerPositionId));

    if (!match) {
      let closing: { dealId: string } | null = null;
      try {
        closing = await budgetedRead(deadline, () =>
          defaultFindClosingDeal(ownerUid, trade)
        );
      } catch (error) {
        if (error instanceof SupervisorReadTimeoutError) {
          lastReason = "TIMEOUT";
          trade = await stampSupervisorTimeout(ownerUid, trade, attempts);
          return {
            recovered: false,
            trade,
            reason: "TIMEOUT",
            attempts,
            newOrderCalls,
            pmRegistered: false
          };
        }
        closing = null;
      }
      if (closing) {
        lastReason = "POSITION_CLOSED_BEFORE_RECOVERY";
        trade = await persistForensics(ownerUid, trade, {
          openEntryRecoveryAttempts: attempts,
          openEntryRecoveryLastAt: new Date().toISOString(),
          openEntryRecoveryLastReason: lastReason
        });
        break;
      }
      lastReason = "POSITION_NOT_FOUND_WITHIN_WINDOW";
      trade = await persistForensics(ownerUid, trade, {
        openEntryRecoveryAttempts: attempts,
        openEntryRecoveryLastAt: new Date().toISOString(),
        openEntryRecoveryLastReason: lastReason
      });
      const remain = deadline - nowMs();
      if (remain <= 0) break;
      await sleep(Math.min(pollMs, remain));
      continue;
    }

    if (isValidGoldHunterEntryPrice(match.entryPrice)) {
      const repaired = repairGoldHunterTradeFromBrokerPosition({
        trade,
        position: match
      });
      if (tradeHasAuthoritativeEntryIntegrity(repaired.trade)) {
        const promoted = await promoteOpen({
          ownerUid,
          trade: repaired.trade,
          entry: repaired.trade.entry!,
          source: "BROKER_POSITION_RECONCILIATION",
          fillTs: repaired.trade.fillTs,
          filledVolumeLots: match.volumeLots ?? trade.filledVolumeLots,
          stop: match.stopLoss ?? trade.stop,
          bid: args.bid,
          ask: args.ask,
          attempts
        });
        return {
          recovered: !isGoldHunterClosedTerminal(promoted),
          trade: promoted,
          reason: isGoldHunterClosedTerminal(promoted)
            ? "POSITION_CLOSED_BEFORE_RECOVERY"
            : "RECOVERED_OPEN",
          attempts,
          newOrderCalls,
          pmRegistered: Boolean(promoted.openEntryPmRegisteredAt)
        };
      }
    }

    sawMatchWithInvalidEntry = true;
    lastReason = "ENTRY_INVALID_WITHIN_WINDOW";

    let order: BrokerHistoricalOrder | null = null;
    try {
      order = await budgetedRead(deadline, () =>
        defaultFindHistoricalOrder(ownerUid, trade)
      );
    } catch (error) {
      if (error instanceof SupervisorReadTimeoutError) {
        lastReason = "TIMEOUT";
        trade = await stampSupervisorTimeout(ownerUid, trade, attempts);
        return {
          recovered: false,
          trade,
          reason: "TIMEOUT",
          attempts,
          newOrderCalls,
          pmRegistered: false
        };
      }
      order = null;
    }
    if (
      order &&
      isSuccessfulOpeningHistoricalOrder(order) &&
      isValidGoldHunterEntryPrice(order.executionPrice)
    ) {
      attempts += 1;
      const proof = await confirmPositionStillOpen({
        ownerUid,
        positionId: String(trade.brokerPositionId),
        deadline,
        list
      });
      if (proof.kind === "timeout") {
        lastReason = "TIMEOUT";
        trade = await stampSupervisorTimeout(ownerUid, trade, attempts);
        return {
          recovered: false,
          trade,
          reason: "TIMEOUT",
          attempts,
          newOrderCalls,
          pmRegistered: false
        };
      }
      if (proof.kind === "failed") {
        lastReason = "POSITIONS_READ_FAILED";
        trade = await persistForensics(ownerUid, trade, {
          openEntryRecoveryAttempts: attempts,
          openEntryRecoveryLastAt: new Date().toISOString(),
          openEntryRecoveryLastReason: lastReason
        });
        const remain = deadline - nowMs();
        if (remain <= 0) break;
        await sleep(Math.min(pollMs, remain));
        continue;
      }
      if (proof.kind === "absent") {
        lastReason = "POSITION_CLOSED_BEFORE_RECOVERY";
        trade = await persistForensics(ownerUid, trade, {
          openEntryRecoveryAttempts: attempts,
          openEntryRecoveryLastAt: new Date().toISOString(),
          openEntryRecoveryLastReason: lastReason
        });
        break;
      }
      const latest = await getGoldHunterDemoTrade(
        ownerUid,
        trade.goldHunterTradeId
      );
      if (latest) trade = latest;
      if (isGoldHunterClosedTerminal(trade)) {
        lastReason = "POSITION_CLOSED_BEFORE_RECOVERY";
        break;
      }
      const promoted = await promoteOpen({
        ownerUid,
        trade,
        entry: order.executionPrice!,
        source: "BROKER_ORDER_EXECUTION_RECONCILIATION",
        fillTs: order.updatedAt ?? order.createdAt,
        filledVolumeLots: order.executedVolumeLots ?? trade.filledVolumeLots,
        bid: args.bid,
        ask: args.ask,
        attempts
      });
      return {
        recovered: !isGoldHunterClosedTerminal(promoted),
        trade: promoted,
        reason: isGoldHunterClosedTerminal(promoted)
          ? "POSITION_CLOSED_BEFORE_RECOVERY"
          : "RECOVERED_OPEN",
        attempts,
        newOrderCalls,
        pmRegistered: Boolean(promoted.openEntryPmRegisteredAt)
      };
    }

    let deal: BrokerDealEvidence | null = null;
    try {
      deal = await budgetedRead(deadline, () =>
        defaultFindOpeningDeal(ownerUid, trade)
      );
    } catch (error) {
      if (error instanceof SupervisorReadTimeoutError) {
        lastReason = "TIMEOUT";
        trade = await stampSupervisorTimeout(ownerUid, trade, attempts);
        return {
          recovered: false,
          trade,
          reason: "TIMEOUT",
          attempts,
          newOrderCalls,
          pmRegistered: false
        };
      }
      deal = null;
    }
    if (deal && isSuccessfulOpeningDeal(deal)) {
      attempts += 1;
      const proof = await confirmPositionStillOpen({
        ownerUid,
        positionId: String(trade.brokerPositionId),
        deadline,
        list
      });
      if (proof.kind === "timeout") {
        lastReason = "TIMEOUT";
        trade = await stampSupervisorTimeout(ownerUid, trade, attempts);
        return {
          recovered: false,
          trade,
          reason: "TIMEOUT",
          attempts,
          newOrderCalls,
          pmRegistered: false
        };
      }
      if (proof.kind === "failed") {
        lastReason = "POSITIONS_READ_FAILED";
        trade = await persistForensics(ownerUid, trade, {
          openEntryRecoveryAttempts: attempts,
          openEntryRecoveryLastAt: new Date().toISOString(),
          openEntryRecoveryLastReason: lastReason
        });
        const remain = deadline - nowMs();
        if (remain <= 0) break;
        await sleep(Math.min(pollMs, remain));
        continue;
      }
      if (proof.kind === "absent") {
        lastReason = "POSITION_CLOSED_BEFORE_RECOVERY";
        trade = await persistForensics(ownerUid, trade, {
          openEntryRecoveryAttempts: attempts,
          openEntryRecoveryLastAt: new Date().toISOString(),
          openEntryRecoveryLastReason: lastReason
        });
        break;
      }
      const latest = await getGoldHunterDemoTrade(
        ownerUid,
        trade.goldHunterTradeId
      );
      if (latest) trade = latest;
      if (isGoldHunterClosedTerminal(trade)) {
        lastReason = "POSITION_CLOSED_BEFORE_RECOVERY";
        break;
      }
      const promoted = await promoteOpen({
        ownerUid,
        trade,
        entry: deal.executionPrice!,
        source: "BROKER_OPENING_DEAL_RECONCILIATION",
        fillTs: deal.executedAt,
        filledVolumeLots: deal.filledVolumeLots ?? trade.filledVolumeLots,
        bid: args.bid,
        ask: args.ask,
        attempts
      });
      return {
        recovered: !isGoldHunterClosedTerminal(promoted),
        trade: promoted,
        reason: isGoldHunterClosedTerminal(promoted)
          ? "POSITION_CLOSED_BEFORE_RECOVERY"
          : "RECOVERED_OPEN",
        attempts,
        newOrderCalls,
        pmRegistered: Boolean(promoted.openEntryPmRegisteredAt)
      };
    }

    trade = await persistForensics(ownerUid, trade, {
      openEntryRecoveryAttempts: attempts,
      openEntryRecoveryLastAt: new Date().toISOString(),
      openEntryRecoveryLastReason: lastReason
    });
    const remain = deadline - nowMs();
    if (remain <= 0) break;
    await sleep(Math.min(pollMs, remain));
  }

  trade = await persistForensics(ownerUid, trade, {
    openEntryRecoveryAttempts: attempts,
    openEntryRecoveryLastAt: new Date().toISOString(),
    openEntryRecoveryLastReason: lastReason
  });
  await syncGoldHunterOpenEntryIntegrityHealth(ownerUid);
  return {
    recovered: false,
    trade,
    reason: lastReason,
    attempts,
    newOrderCalls,
    pmRegistered: false
  };
}

/**
 * Dedupe by ownerUid+tradeId. Fire-and-forget safe. AutoTrade is ignored.
 */
export function ensureGoldHunterKnownPositionEntrySupervisor(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  bid?: number | null;
  ask?: number | null;
  timeoutMs?: number;
  pollMs?: number;
  listPositions?: (ownerUid: string) => Promise<BrokerOpenPosition[]>;
}): Promise<KnownPositionEntrySupervisorResult> {
  const key = supervisorDedupeKey(
    args.ownerUid,
    args.trade.goldHunterTradeId
  );
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (!isGoldHunterKnownPositionEntrySupervisorResumeEligible(args.trade)) {
    const reason: OpenEntryRecoveryReason =
      args.trade.openEntryRecoveryLastReason === "TIMEOUT"
        ? "TIMEOUT"
        : args.trade.openEntryRecoveryLastReason ===
            "POSITION_CLOSED_BEFORE_RECOVERY"
          ? "POSITION_CLOSED_BEFORE_RECOVERY"
          : "SKIPPED_STATUS";
    return Promise.resolve({
      recovered: false,
      trade: args.trade,
      reason,
      attempts: args.trade.openEntryRecoveryAttempts ?? 0,
      newOrderCalls,
      pmRegistered: false
    });
  }
  const started = runSupervisor(args).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}

export async function awaitGoldHunterOpenEntrySupervisorForTests(
  ownerUid: string,
  tradeId: string
): Promise<KnownPositionEntrySupervisorResult | null> {
  return inFlight.get(supervisorDedupeKey(ownerUid, tradeId)) ?? null;
}

/**
 * Resume supervisors for existing known-position pending trades.
 * Independent of demoAutoTradeEnabled. Never submits NewOrder.
 */
export async function resumeGoldHunterKnownPositionEntrySupervisors(args: {
  ownerUid: string;
}): Promise<number> {
  const trades = await listGoldHunterDemoTrades(args.ownerUid, { limit: 100 });
  let launched = 0;
  for (const trade of trades) {
    if (!isGoldHunterKnownPositionEntrySupervisorResumeEligible(trade)) {
      continue;
    }
    const key = supervisorDedupeKey(args.ownerUid, trade.goldHunterTradeId);
    if (inFlight.has(key)) continue;
    void ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: args.ownerUid,
      trade
    });
    launched += 1;
  }
  return launched;
}
