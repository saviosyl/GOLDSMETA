/**
 * Persisted Demo Auto / qualification position lifecycle.
 * Survives Cloud Function cold starts and PWA reloads.
 */

import type {
  DemoProfitLockState,
  PositionManagementPolicy,
  ProfitLockProtectionLevel,
  ProfitLockStage
} from "./demoProfitLockTypes";
import { emptyProfitLockState } from "./demoProfitLockTypes";

export type {
  ProfitLockStage,
  ProfitLockProtectionLevel,
  DemoProfitLockState,
  PositionManagementPolicy
};
export { emptyProfitLockState };

export type PositionManagementState =
  | "HOLD"
  | "SL_PROTECTED"
  | "MOVE_TO_BREAKEVEN"
  | "BREAKEVEN_SET"
  | "TP1_HIT"
  | "TP2_HIT"
  | "TP3_HIT"
  | "EXIT_SIGNAL"
  | "CLOSED"
  | "PROTECTION_FAILURE"
  | "CLOSE_RECONCILIATION_PENDING";

export type TpLifecycleStatus = "PENDING" | "HIT" | "PARTIAL_CLOSED";

export type PositionLifecycleEvent = {
  id: string;
  at: string;
  kind:
    | "OPENED"
    | "SL_VERIFIED"
    | "SL_MISSING"
    | "SL_AMENDED"
    | "BREAKEVEN"
    | "TP1"
    | "TP2"
    | "TP3"
    | "PARTIAL_CLOSE"
    | "CLOSE"
    | "CLOSE_PENDING"
    | "RECONCILED"
    | "RECOMMENDATION"
    | "PROTECTION_FAILURE"
    | "IDEMPOTENT_SKIP";
  reason: string;
  oldSl?: number | null;
  newSl?: number | null;
  brokerAck?: boolean | null;
  dedupeKey: string;
};

export type DemoPositionLifecycle = {
  id: string;
  uid: string;
  environment: "DEMO";
  correlationId: string;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  accountId: string | null;
  accountMasked: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  entry: number | null;
  currentPrice: number | null;
  lots: number | null;
  remainingLots: number | null;
  initialSl: number | null;
  currentSl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  tp1Status: TpLifecycleStatus;
  tp2Status: TpLifecycleStatus;
  tp3Status: TpLifecycleStatus;
  openedAt: string;
  closedAt: string | null;
  realisedPnl: number | null;
  unrealisedPnl: number | null;
  /** Broker-confirmed close fields — never invent zeros. */
  brokerPnlConfirmed: boolean;
  closePrice: number | null;
  grossPnl: number | null;
  commission: number | null;
  swap: number | null;
  netPnl: number | null;
  brokerDealId: string | null;
  /** Measurement-only close diagnostics. Stops are not guaranteed. */
  closeDiagnostics?: Record<string, unknown> | null;
  initialRisk: number | null;
  currentRisk: number | null;
  qualificationStage: string | null;
  decisionId: string | null;
  setupRef: string | null;
  /** FAST_AUTOTRADE_V1 when opened by the Demo FAST engine. */
  strategyId?: string | null;
  source: "qualification_controlled" | "demo_auto" | "manual";
  managementState: PositionManagementState;
  lastRecommendation: string | null;
  protectionVerified: boolean;
  protectionFailure: boolean;
  events: PositionLifecycleEvent[];
  appliedDedupeKeys: string[];
  updatedAt: string;
  status: "OPEN" | "CLOSED" | "FAILED_PROTECTION" | "CLOSE_RECONCILIATION_PENDING";
} & DemoProfitLockState;

/**
 * Map strategy/decision take-profit plans → TP1/TP2/TP3.
 * Never invent R-multiple targets. Missing levels stay null.
 */
export function strategyProvidedTakeProfits(
  takeProfits:
    | Array<{ label?: string | null; price?: number | null }>
    | null
    | undefined
): { tp1: number | null; tp2: number | null; tp3: number | null } {
  const list = Array.isArray(takeProfits) ? takeProfits : [];
  const byLabel = (label: string): number | null => {
    const hit = list.find(
      (t) => String(t.label ?? "").toUpperCase() === label
    );
    if (hit && typeof hit.price === "number" && Number.isFinite(hit.price)) {
      return hit.price;
    }
    return null;
  };
  // Positional fallback only for TP1 when the first plan entry is TP1 or unlabeled.
  let tp1 = byLabel("TP1");
  if (tp1 == null && list[0] && typeof list[0].price === "number") {
    const lab = String(list[0].label ?? "TP1").toUpperCase();
    if (lab === "TP1" || !list[0].label) tp1 = list[0].price;
  }
  return {
    tp1,
    tp2: byLabel("TP2"),
    tp3: byLabel("TP3")
  };
}

export function emptyTpStatuses(): Pick<
  DemoPositionLifecycle,
  "tp1Status" | "tp2Status" | "tp3Status"
> {
  return { tp1Status: "PENDING", tp2Status: "PENDING", tp3Status: "PENDING" };
}

/** Append event if dedupeKey not already applied. Pure — safe for unit tests. */
export function appendLifecycleEvent(
  doc: DemoPositionLifecycle,
  event: Omit<PositionLifecycleEvent, "id"> & { id?: string }
): { doc: DemoPositionLifecycle; applied: boolean } {
  if (doc.appliedDedupeKeys.includes(event.dedupeKey)) {
    return { doc, applied: false };
  }
  const full: PositionLifecycleEvent = {
    id: event.id ?? `ev_${Date.now().toString(36)}`,
    at: event.at,
    kind: event.kind,
    reason: event.reason,
    // Firestore rejects `undefined` — persist null for omitted optional fields.
    oldSl: event.oldSl ?? null,
    newSl: event.newSl ?? null,
    brokerAck: event.brokerAck ?? null,
    dedupeKey: event.dedupeKey
  };
  return {
    applied: true,
    doc: {
      ...doc,
      events: [...doc.events, full].slice(-100),
      appliedDedupeKeys: [...doc.appliedDedupeKeys, event.dedupeKey].slice(-200),
      updatedAt: new Date().toISOString()
    }
  };
}
