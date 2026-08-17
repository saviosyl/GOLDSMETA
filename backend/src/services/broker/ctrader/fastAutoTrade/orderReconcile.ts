/**
 * Correlate a FAST NewOrderReq to broker state by clientOrderId only.
 * Never treat "same side" or "last position" as this order.
 */

export type ReconcileOrderRow = {
  orderId: string | null;
  positionId: string | null;
  clientOrderId: string | null;
  executionType?: string | null;
  tradeSide?: "BUY" | "SELL" | null;
};

export type ReconcilePositionRow = {
  positionId: string;
  clientOrderId: string | null;
  orderId: string | null;
  side?: "BUY" | "SELL" | null;
  usedMargin?: number | null;
};

export type ReconcileSnapshot = {
  orders: ReconcileOrderRow[];
  positions: ReconcilePositionRow[];
};

export type ReconcileMatch = {
  matched: true;
  by: "ORDER_CLIENT_ORDER_ID" | "POSITION_CLIENT_ORDER_ID";
  orderId: string | null;
  positionId: string | null;
  clientOrderId: string;
};

export type ReconcileMiss = {
  matched: false;
  reason: "NOT_FOUND" | "CLIENT_ORDER_ID_MISSING";
};

export type ReconcileLookup = ReconcileMatch | ReconcileMiss;

function asText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function sideFrom(value: unknown): "BUY" | "SELL" | null {
  if (value === 2 || value === "2" || value === "SELL") return "SELL";
  if (value === 1 || value === "1" || value === "BUY") return "BUY";
  return null;
}

export function parseReconcileOrders(raw: unknown): ReconcileOrderRow[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ReconcileOrderRow[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const trade = (row.tradeData ?? {}) as Record<string, unknown>;
    out.push({
      orderId: asText(row.orderId),
      positionId: asText(row.positionId ?? trade.positionId),
      clientOrderId: asText(row.clientOrderId ?? trade.clientOrderId),
      executionType:
        row.executionType != null ? String(row.executionType) : null,
      tradeSide: sideFrom(row.tradeSide ?? trade.tradeSide)
    });
  }
  return out;
}

export function parseReconcilePositions(raw: unknown): ReconcilePositionRow[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ReconcilePositionRow[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const trade = (row.tradeData ?? {}) as Record<string, unknown>;
    const positionId = asText(row.positionId ?? trade.positionId);
    if (!positionId) continue;
    out.push({
      positionId,
      clientOrderId: asText(
        row.clientOrderId ?? trade.clientOrderId ?? row.label
      ),
      orderId: asText(row.orderId ?? trade.orderId),
      side: sideFrom(trade.tradeSide ?? row.tradeSide),
      usedMargin: null
    });
  }
  return out;
}

export function parseReconcileSnapshot(raw: Record<string, unknown>): ReconcileSnapshot {
  return {
    orders: parseReconcileOrders(raw.order ?? raw.orders),
    positions: parseReconcilePositions(raw.position ?? raw.positions)
  };
}

/**
 * Match this FAST order by durable clientOrderId.
 * Unrelated open positions (even same side) never match.
 */
export function matchReconcileByClientOrderId(args: {
  clientOrderId: string;
  snapshot: ReconcileSnapshot;
}): ReconcileLookup {
  const want = asText(args.clientOrderId);
  if (!want) {
    return { matched: false, reason: "CLIENT_ORDER_ID_MISSING" };
  }

  const order = args.snapshot.orders.find((o) => o.clientOrderId === want);
  if (order) {
    return {
      matched: true,
      by: "ORDER_CLIENT_ORDER_ID",
      orderId: order.orderId,
      positionId: order.positionId,
      clientOrderId: want
    };
  }

  const position = args.snapshot.positions.find((p) => p.clientOrderId === want);
  if (position) {
    return {
      matched: true,
      by: "POSITION_CLIENT_ORDER_ID",
      orderId: position.orderId,
      positionId: position.positionId,
      clientOrderId: want
    };
  }

  return { matched: false, reason: "NOT_FOUND" };
}

let reconcileLookupOverride:
  | ((clientOrderId: string) => Promise<ReconcileLookup>)
  | null = null;

export function setFastReconcileForTests(
  fn: ((clientOrderId: string) => Promise<ReconcileLookup>) | null
): void {
  reconcileLookupOverride = fn;
}

export async function lookupReconcileByClientOrderId(
  clientOrderId: string,
  snapshotLoader?: () => Promise<ReconcileSnapshot>
): Promise<ReconcileLookup> {
  if (reconcileLookupOverride) {
    return reconcileLookupOverride(clientOrderId);
  }
  if (!snapshotLoader) {
    return { matched: false, reason: "NOT_FOUND" };
  }
  const snapshot = await snapshotLoader();
  return matchReconcileByClientOrderId({ clientOrderId, snapshot });
}
