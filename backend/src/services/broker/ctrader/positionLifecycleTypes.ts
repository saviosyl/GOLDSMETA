/**
 * Persisted Demo Auto / qualification position lifecycle.
 * Survives Cloud Function cold starts and PWA reloads.
 */

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
  | "PROTECTION_FAILURE";

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
    | "RECONCILED"
    | "RECOMMENDATION"
    | "PROTECTION_FAILURE"
    | "IDEMPOTENT_SKIP";
  reason: string;
  oldSl?: number | null;
  newSl?: number | null;
  brokerAck?: boolean;
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
  initialRisk: number | null;
  currentRisk: number | null;
  qualificationStage: string | null;
  decisionId: string | null;
  setupRef: string | null;
  source: "qualification_controlled" | "demo_auto" | "manual";
  managementState: PositionManagementState;
  lastRecommendation: string | null;
  protectionVerified: boolean;
  protectionFailure: boolean;
  events: PositionLifecycleEvent[];
  appliedDedupeKeys: string[];
  updatedAt: string;
  status: "OPEN" | "CLOSED" | "FAILED_PROTECTION";
};

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
    oldSl: event.oldSl,
    newSl: event.newSl,
    brokerAck: event.brokerAck,
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
