/**
 * Authoritative broker-position entry repair for Gold Hunter Demo trades.
 * Never invents prices. Never overwrites a valid stored entry.
 */
import { frozenGhFastSoakConfig } from "./abc/frozenConfig";
import { isValidGoldHunterEntryPrice } from "./entryValidity";
import type { GoldHunterDemoTrade } from "./types";
import type { BrokerDemoPositionLite } from "./reconcilePositions";

export type EntryRecoverySource =
  | "BROKER_POSITION_RECONCILIATION"
  | "BROKER_DEAL_SETTLEMENT"
  | "BROKER_ORDER_EXECUTION";

/**
 * Canonical frozen original risk (price units) for GH Demo trades.
 * Must be stamped at creation — never derived from later Smart PM stops.
 */
export function goldHunterFrozenInitialRiskPrice(): number {
  return frozenGhFastSoakConfig().hardStop;
}

/**
 * Backfill missing entry / volume / stop / side from a proven broker position.
 * Does not overwrite a valid stored entry.
 */
export function repairGoldHunterTradeFromBrokerPosition(args: {
  trade: GoldHunterDemoTrade;
  position: BrokerDemoPositionLite;
  nowIso?: string;
}): { trade: GoldHunterDemoTrade; repaired: boolean; entryRepaired: boolean } {
  const { trade, position } = args;
  const now = args.nowIso ?? new Date().toISOString();
  let repaired = false;
  let entryRepaired = false;
  const next: GoldHunterDemoTrade = { ...trade };

  if (
    !isValidGoldHunterEntryPrice(next.entry) &&
    isValidGoldHunterEntryPrice(position.entryPrice)
  ) {
    next.entry = position.entryPrice!;
    next.entryRecoverySource = "BROKER_POSITION_RECONCILIATION";
    if (next.dataQuality === "ENTRY_INVALID") next.dataQuality = null;
    if (next.errorCode === "ENTRY_PRICE_INVALID") next.errorCode = null;
    entryRepaired = true;
    repaired = true;
  }

  if (
    !next.brokerPositionId &&
    position.positionId != null &&
    String(position.positionId).trim().length > 0
  ) {
    next.brokerPositionId = String(position.positionId);
    repaired = true;
  }

  if (
    (next.filledVolumeLots == null ||
      !Number.isFinite(next.filledVolumeLots) ||
      !(next.filledVolumeLots > 0)) &&
    position.volumeLots != null &&
    Number.isFinite(position.volumeLots) &&
    position.volumeLots > 0
  ) {
    next.filledVolumeLots = position.volumeLots;
    repaired = true;
  }

  if (
    (next.stop == null || !Number.isFinite(next.stop)) &&
    position.stopLoss != null &&
    Number.isFinite(position.stopLoss)
  ) {
    next.stop = position.stopLoss;
    repaired = true;
  }

  if (
    (next.side !== "BUY" && next.side !== "SELL") &&
    (position.side === "BUY" || position.side === "SELL")
  ) {
    next.side = position.side;
    repaired = true;
  }

  // Stamp frozen original risk if missing (creation may have omitted it).
  if (
    next.initialRiskPrice == null ||
    !Number.isFinite(next.initialRiskPrice) ||
    !(next.initialRiskPrice > 0)
  ) {
    next.initialRiskPrice = goldHunterFrozenInitialRiskPrice();
    repaired = true;
  }

  // Promote pending entry states to FILLED once entry is authoritative.
  if (
    entryRepaired &&
    isValidGoldHunterEntryPrice(next.entry) &&
    next.brokerPositionId &&
    (next.status === "PENDING_RECONCILIATION" ||
      next.status === "ACCEPTED_PENDING_FILL") &&
    !next.exitReason
  ) {
    next.status = "FILLED";
    next.result = "OPEN";
    next.fillTs = next.fillTs ?? now;
    repaired = true;
  }

  return { trade: next, repaired, entryRepaired };
}

/**
 * Backfill entry from broker closing deal when still missing.
 * Never overwrites a known valid entry with null/another value.
 */
export function repairGoldHunterTradeEntryFromDeal(args: {
  trade: GoldHunterDemoTrade;
  dealEntryPrice: number | null | undefined;
}): GoldHunterDemoTrade {
  const { trade, dealEntryPrice } = args;
  if (isValidGoldHunterEntryPrice(trade.entry)) {
    return trade;
  }
  if (!isValidGoldHunterEntryPrice(dealEntryPrice)) {
    return trade;
  }
  return {
    ...trade,
    entry: dealEntryPrice!,
    entryRecoverySource:
      trade.entryRecoverySource ?? "BROKER_DEAL_SETTLEMENT",
    dataQuality: trade.dataQuality === "ENTRY_INVALID" ? null : trade.dataQuality,
    errorCode:
      trade.errorCode === "ENTRY_PRICE_INVALID" ? null : trade.errorCode,
    initialRiskPrice:
      trade.initialRiskPrice != null &&
      Number.isFinite(trade.initialRiskPrice) &&
      trade.initialRiskPrice > 0
        ? trade.initialRiskPrice
        : goldHunterFrozenInitialRiskPrice()
  };
}

/** Ensure close/settlement never clears a known entry. */
export function preserveGoldHunterEntryOnClose(
  prior: GoldHunterDemoTrade,
  next: GoldHunterDemoTrade
): GoldHunterDemoTrade {
  if (
    isValidGoldHunterEntryPrice(prior.entry) &&
    !isValidGoldHunterEntryPrice(next.entry)
  ) {
    return {
      ...next,
      entry: prior.entry,
      initialRiskPrice:
        next.initialRiskPrice ??
        prior.initialRiskPrice ??
        goldHunterFrozenInitialRiskPrice()
    };
  }
  if (
    (next.initialRiskPrice == null ||
      !Number.isFinite(next.initialRiskPrice) ||
      !(next.initialRiskPrice > 0)) &&
    prior.initialRiskPrice != null &&
    Number.isFinite(prior.initialRiskPrice) &&
    prior.initialRiskPrice > 0
  ) {
    return { ...next, initialRiskPrice: prior.initialRiskPrice };
  }
  return next;
}
