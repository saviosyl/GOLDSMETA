/**
 * Reconcile T212 Practice order intents from broker-confirmed data only.
 * Never infer fill from HTTP 200 alone.
 */

import {
  mapBrokerOrderStatusToIntentState,
  type T212OrderIntent,
  type T212OrderIntentState
} from "./orderIntent";

export interface BrokerOrderSnapshot {
  id?: string | number | null;
  ticker?: string | null;
  quantity?: number | null;
  filledQuantity?: number | null;
  status?: string | null;
  averagePricePaid?: number | null;
  type?: string | null;
}

export interface ReconcileResult {
  intent: T212OrderIntent;
  changed: boolean;
  terminal: boolean;
  notes: string[];
}

export function isTerminalIntentState(state: T212OrderIntentState): boolean {
  return (
    state === "FILLED" ||
    state === "REJECTED" ||
    state === "CANCELLED"
  );
}

export function reconcileIntentWithBrokerOrder(
  intent: T212OrderIntent,
  order: BrokerOrderSnapshot | null,
  nowIso: string
): ReconcileResult {
  const notes: string[] = [];

  if (!order) {
    if (intent.state === "SUBMITTING" || intent.state === "UNKNOWN") {
      notes.push("Broker order not found yet — remain UNKNOWN until confirmed.");
      const next: T212OrderIntent = {
        ...intent,
        state: "UNKNOWN",
        lastReconciledAt: nowIso,
        updatedAt: nowIso
      };
      return {
        intent: next,
        changed: intent.state !== "UNKNOWN",
        terminal: false,
        notes
      };
    }
    return {
      intent: { ...intent, lastReconciledAt: nowIso, updatedAt: nowIso },
      changed: false,
      terminal: isTerminalIntentState(intent.state),
      notes: ["No broker order snapshot; left state unchanged."]
    };
  }

  const brokerStatus = order.status ?? null;
  const mapped = mapBrokerOrderStatusToIntentState(brokerStatus);
  const brokerOrderId =
    order.id != null ? String(order.id) : intent.brokerOrderId;

  let state: T212OrderIntentState = intent.state;
  if (mapped) {
    state = mapped;
    notes.push(`Mapped broker status ${brokerStatus} → ${mapped}`);
  } else if (brokerStatus) {
    state = "UNKNOWN";
    notes.push(`Unmapped broker status ${brokerStatus} → UNKNOWN`);
  }

  const filledQuantity =
    typeof order.filledQuantity === "number"
      ? Math.abs(order.filledQuantity)
      : intent.filledQuantity;
  const averageFillPrice =
    typeof order.averagePricePaid === "number"
      ? order.averagePricePaid
      : intent.averageFillPrice;

  const next: T212OrderIntent = {
    ...intent,
    brokerOrderId,
    brokerStatus,
    filledQuantity,
    averageFillPrice,
    state,
    lastReconciledAt: nowIso,
    updatedAt: nowIso
  };

  const changed =
    next.state !== intent.state ||
    next.brokerOrderId !== intent.brokerOrderId ||
    next.filledQuantity !== intent.filledQuantity ||
    next.brokerStatus !== intent.brokerStatus;

  return {
    intent: next,
    changed,
    terminal: isTerminalIntentState(next.state),
    notes
  };
}

/**
 * After timeout post-dispatch: mark UNKNOWN and require reconcile before retry.
 */
export function markIntentUnknownAfterTimeout(
  intent: T212OrderIntent,
  nowIso: string,
  reason: string
): T212OrderIntent {
  return {
    ...intent,
    state: "UNKNOWN",
    rejectionReason: reason,
    lastReconciledAt: nowIso,
    updatedAt: nowIso,
    riskEvaluation: {
      ...intent.riskEvaluation,
      timeoutAfterDispatch: true,
      blindRetryForbidden: true
    }
  };
}

export function findOrderForIntent(
  orders: BrokerOrderSnapshot[],
  intent: T212OrderIntent
): BrokerOrderSnapshot | null {
  if (intent.brokerOrderId) {
    const byId = orders.find((o) => String(o.id ?? "") === intent.brokerOrderId);
    if (byId) return byId;
  }
  // Fingerprint match: same ticker + quantity sign/magnitude while pending
  const candidates = orders.filter((o) => {
    if ((o.ticker ?? "") !== intent.ticker) return false;
    if (typeof o.quantity !== "number") return false;
    return Math.abs(Math.abs(o.quantity) - Math.abs(intent.quantity)) < 1e-8;
  });
  return candidates[0] ?? null;
}
