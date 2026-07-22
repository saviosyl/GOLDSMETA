/**
 * Stock trade intent state machine helpers.
 * Unknown submission status locks the symbol until reconciliation.
 */

import type { StockTradeIntentState } from "./featureFlags";

const TRANSITIONS: Record<StockTradeIntentState, StockTradeIntentState[]> = {
  CANDIDATE: ["VALIDATING", "REJECTED", "CANCELLED"],
  VALIDATING: ["APPROVED", "REJECTED"],
  REJECTED: [],
  APPROVED: ["ENTRY_RESERVED", "CANCELLED"],
  ENTRY_RESERVED: ["ENTRY_SUBMITTING", "CANCELLED", "LOCKED"],
  ENTRY_SUBMITTING: ["ENTRY_PENDING", "ENTRY_UNKNOWN", "PARTIALLY_FILLED", "OPEN", "REJECTED", "LOCKED"],
  ENTRY_UNKNOWN: ["RECONCILIATION_REQUIRED", "LOCKED", "OPEN", "REJECTED", "CANCELLED"],
  ENTRY_PENDING: ["PARTIALLY_FILLED", "OPEN", "CANCELLED", "LOCKED"],
  PARTIALLY_FILLED: ["OPEN", "EXIT_REQUESTED", "LOCKED"],
  OPEN: ["EXIT_REQUESTED", "LOCKED"],
  EXIT_REQUESTED: ["EXIT_SUBMITTING", "LOCKED"],
  EXIT_SUBMITTING: ["EXIT_PENDING", "EXIT_UNKNOWN", "PARTIALLY_CLOSED", "CLOSED", "LOCKED"],
  EXIT_UNKNOWN: ["RECONCILIATION_REQUIRED", "LOCKED", "CLOSED", "PARTIALLY_CLOSED"],
  EXIT_PENDING: ["PARTIALLY_CLOSED", "CLOSED", "LOCKED"],
  PARTIALLY_CLOSED: ["EXIT_REQUESTED", "CLOSED", "LOCKED"],
  CLOSED: [],
  CANCELLED: [],
  LOCKED: ["RECONCILIATION_REQUIRED", "CANCELLED", "CLOSED"],
  RECONCILIATION_REQUIRED: ["OPEN", "CLOSED", "CANCELLED", "LOCKED", "PARTIALLY_FILLED", "PARTIALLY_CLOSED"]
};

export function canTransition(
  from: StockTradeIntentState,
  to: StockTradeIntentState
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(
  from: StockTradeIntentState,
  to: StockTradeIntentState
): void {
  if (!canTransition(from, to)) {
    throw Object.assign(new Error(`Invalid state transition ${from} -> ${to}`), {
      code: "INVALID_STATE_TRANSITION"
    });
  }
}

export function isTerminalState(state: StockTradeIntentState): boolean {
  return state === "CLOSED" || state === "CANCELLED" || state === "REJECTED";
}

export function requiresReconciliation(state: StockTradeIntentState): boolean {
  return (
    state === "ENTRY_UNKNOWN" ||
    state === "EXIT_UNKNOWN" ||
    state === "RECONCILIATION_REQUIRED" ||
    state === "LOCKED"
  );
}

/** Build deterministic idempotency key components (not sent to T212 — GoldMeta-level). */
export function buildIntentIdempotencyKey(args: {
  userId: string;
  symbol: string;
  strategy: string;
  signalOrBarTimestamp: string;
  side: "BUY" | "SELL";
  tradingDate: string;
}): string {
  return [
    args.userId,
    args.symbol.toUpperCase(),
    args.strategy,
    args.signalOrBarTimestamp,
    args.side,
    args.tradingDate
  ].join("|");
}
