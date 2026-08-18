/**
 * cTrader Open API client — Demo/Live quote read + Demo market order submit.
 * Uses Spotware HTTP helpers for account discovery and WebSocket for symbols/quotes/orders.
 * Never logs tokens. Live *order submission* remains unwired; Live quotes use the Live host.
 */

import { CTraderConnection } from "@reiryoku/ctrader-layer";
import type { BrokerAccount, BrokerQuote, BrokerSymbol } from "../domain";
import { hashAccountKey, maskAccountId } from "./tokenCrypto";
import {
  pickXauUsdCandidate,
  resolveXauUsdFromCatalogue,
  type RawCTraderSymbol
} from "./symbolResolver";
import {
  marketStatusFromSchedule,
  parseScheduleIntervals
} from "./marketSchedule";
import { brokerSymbolFromProtoOASymbolById } from "./brokerSymbolFromProtoOASymbolById";
import {
  computeAuthoritativeMarginSnapshot,
  parseExpectedMarginEntries,
  selectSideExpectedMargin,
  type AuthoritativeMarginSnapshot
} from "./authoritativeMargin";
import {
  describeRuntimeType,
  moneyFromDigitsSafe,
  safeIdString,
  safeInteger,
  safeWireAccountId
} from "./openApiNumeric";
import { withFastDemoSession } from "./fastAutoTrade/demoSession";
import {
  submitFastMarketOrder,
  toDemoMarketOrderResult
} from "./fastAutoTrade/orderTransport";

const DEMO_HOST = "demo.ctraderapi.com";
const DEMO_PORT = 5035;
const LIVE_HOST = "live.ctraderapi.com";
const LIVE_PORT = 5035;
/** Spotware relative price unit — bid/ask are in 1/100000 of price. */
const SPOT_PRICE_SCALE = 100_000;
const SPOT_EVENT_TIMEOUT_MS = 8_000;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function moneyFromCenti(value: unknown, moneyDigits = 2): number | null {
  const n = asNumber(value);
  if (n == null) return null;
  return n / Math.pow(10, moneyDigits);
}

function spotPriceFromRelative(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null) return null;
  return n / SPOT_PRICE_SCALE;
}

export type DiscoveredAccount = {
  /** Open API account id (ctidTraderAccountId) — used for Auth/orders. */
  ctidTraderAccountId: string;
  /**
   * Broker/UI login number when provided by Spotware (often what push
   * notifications show). Distinct from ctidTraderAccountId.
   */
  traderLogin: string | null;
  isLive: boolean;
  brokerNameTitle: string | null;
  depositCurrency: string | null;
  leverage: number | null;
  accountIdMasked: string;
  accountKeyHash: string;
};

export type AccountSnapshot = {
  balance: number | null;
  equity: number | null;
  freeMargin: number | null;
  usedMargin: number | null;
  currency: string | null;
  leverage: number | null;
};

export type DemoMarketOrderRequest = {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  ctidTraderAccountId: string;
  symbolId: string;
  side: "BUY" | "SELL";
  /** Protocol volume cents (100 = 1.00 lot). */
  volume: number;
  relativeStopLoss?: number;
  relativeTakeProfit?: number;
  clientOrderId?: string;
  label?: string;
  comment?: string;
};

export type DemoMarketOrderResult = {
  accepted: boolean;
  executionType: string | null;
  orderId: string | null;
  positionId: string | null;
  errorCode: string | null;
  clientOrderId: string | null;
  /** Actual fill price when present on the execution/deal event. */
  fillPrice: number | null;
  /** Broker absolute stop when present on the position snapshot. */
  stopLoss: number | null;
  /** Broker absolute take-profit when present on the position snapshot. */
  takeProfit: number | null;
  /** Filled size in lots (1.00 = 1 lot). */
  filledVolumeLots: number | null;
  /** Account id the order was placed against. */
  ctidTraderAccountId: string | null;
  /** FAST / Demo order outcome classification. */
  outcome?:
    | "BROKER_FILLED"
    | "BROKER_ACCEPTED"
    | "BROKER_REJECTED"
    | "BROKER_SUBMIT_ERROR"
    | "BROKER_OUTCOME_UNKNOWN"
    | "BROKER_TIMEOUT_RECONCILED_FILLED"
    | "BROKER_TIMEOUT_RECONCILED_NOT_FOUND"
    | "BROKER_ACCEPTED_PENDING_FILL";
  requestSent?: boolean;
  newOrderReqCount?: number;
  payloadShape?: Record<string, unknown> | null;
  raw?: Record<string, unknown>;
};

/** Open position snapshot from ProtoOAReconcileRes.position[] */
export type BrokerOpenPosition = {
  positionId: string;
  symbolId: string | null;
  side: "BUY" | "SELL";
  /** Lots (1.00 = 1 lot). */
  volumeLots: number | null;
  /** Protocol volume cents. */
  volumeUnits: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  unrealisedPnl: number | null;
  /**
   * Deposit-currency used margin from ProtoOAPosition.usedMargin
   * (moneyDigits-converted). Null when broker omitted the field.
   */
  usedMargin: number | null;
  openTimestamp: string | null;
  /** Optional order label when present on tradeData (ownership correlation). */
  label?: string | null;
  /** Optional order comment when present on tradeData (ownership correlation). */
  comment?: string | null;
};

export type AuthoritativeMarginSnapshotResult =
  | { ok: true; snapshot: AuthoritativeMarginSnapshot }
  | { ok: false; notes: string[] };

export type ExpectedMarginResult =
  | {
      ok: true;
      expectedMargin: number;
      buyMargin: number;
      sellMargin: number;
      volume: number;
      moneyDigits: number;
    }
  | { ok: false; notes: string[] };

export type DemoAmendSlTpRequest = {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  ctidTraderAccountId: string;
  positionId: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

export type DemoClosePositionRequest = {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  ctidTraderAccountId: string;
  positionId: string;
  /** Protocol volume cents to close (partial or full). */
  volume: number;
};

export type DemoPositionMutationResult = {
  accepted: boolean;
  executionType: string | null;
  positionId: string | null;
  errorCode: string | null;
  raw?: Record<string, unknown>;
};

/** Closing deal snapshot from ProtoOADealListByPositionIdRes. */
export type BrokerClosedDeal = {
  dealId: string;
  orderId: string | null;
  positionId: string;
  closePrice: number | null;
  closedAt: string | null;
  grossPnl: number | null;
  commission: number | null;
  swap: number | null;
  netPnl: number | null;
  closedVolumeLots: number | null;
  /** From closePositionDetail.entryPrice when present. */
  entryPrice?: number | null;
};

/**
 * Historical order row from ProtoOAOrderListRes (Demo read-only).
 * Correlation key is exact clientOrderId — never "latest" / side-only.
 */
export type BrokerHistoricalOrder = {
  orderId: string;
  positionId: string | null;
  clientOrderId: string | null;
  orderStatus: string | null;
  orderStatusCode: number | null;
  tradeSide: "BUY" | "SELL" | null;
  symbolId: string | null;
  label: string | null;
  comment: string | null;
  executionPrice: number | null;
  executedVolumeLots: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  closingOrder: boolean;
};

/** Any deal row (opening or closing) for correlation by orderId/positionId. */
export type BrokerDealEvidence = {
  dealId: string;
  orderId: string | null;
  positionId: string | null;
  executionPrice: number | null;
  executedAt: string | null;
  filledVolumeLots: number | null;
  tradeSide: "BUY" | "SELL" | null;
  isClosing: boolean;
  close: BrokerClosedDeal | null;
  /** From deal / nested tradeData when broker supplies order label. */
  label: string | null;
  /** From deal / nested tradeData when broker supplies order comment. */
  comment: string | null;
  symbolId: string | null;
  dealStatus: string | null;
};

/** Single ProtoOAOrderList / DealList response page. */
export type BrokerHistoryPage<T> = {
  items: T[];
  /** Spotware hasMore — true means this page is NOT exhaustive for the window. */
  hasMore: boolean;
  fromTimestampMs: number;
  toTimestampMs: number;
};

/**
 * Clamp a history window without sliding away from an orderTs-anchored `from`.
 * Previous to-anchored clamp could drop the investigated order outside the window.
 */
export function clampOrderTsAnchoredHistoryWindow(args: {
  fromTimestampMs: number;
  toTimestampMs: number;
  nowMs?: number;
  maxSpanMs?: number;
}): { fromTimestampMs: number; toTimestampMs: number } {
  const nowMs = args.nowMs ?? Date.now();
  const maxSpanMs = args.maxSpanMs ?? 7 * 86_400_000;
  let to = Math.min(args.toTimestampMs, nowMs);
  let from = Math.max(0, args.fromTimestampMs);
  if (from > to) from = to;
  if (to - from > maxSpanMs) {
    // Keep from (order-anchored); shrink to.
    to = from + maxSpanMs;
    if (to > nowMs) {
      to = nowMs;
      from = Math.max(0, to - maxSpanMs);
    }
  }
  return { fromTimestampMs: from, toTimestampMs: to };
}

export function parseHistoryHasMore(raw: unknown): boolean {
  if (raw === true || raw === 1 || raw === "true" || raw === "1") return true;
  if (raw === false || raw === 0 || raw === "false" || raw === "0") return false;
  // Missing hasMore → treat as incomplete (fail closed).
  if (raw == null) return true;
  return Boolean(raw);
}

/** Display-only OHLC bar from ProtoOAGetTrendbarsRes. */
export type TrendbarCandle = {
  /** Unix seconds (bar open). */
  time: number;
  open: number;
  high: number;
  close: number;
  low: number;
  volume: number | null;
};

/** ProtoOATrendbarPeriod numeric values used by Spotware. */
export const TRENDBAR_PERIOD = {
  M1: 1,
  M5: 5,
  M15: 7,
  H1: 9,
  H4: 10
} as const;

export type TrendbarPeriodKey = keyof typeof TRENDBAR_PERIOD;

export function parseTrendbarCandles(
  trendbars: unknown,
  priceScale = SPOT_PRICE_SCALE
): TrendbarCandle[] {
  const list = Array.isArray(trendbars) ? trendbars : [];
  const out: TrendbarCandle[] = [];
  for (const raw of list) {
    const bar = (raw ?? {}) as Record<string, unknown>;
    const lowRel = asNumber(bar.low);
    const minutes = asNumber(bar.utcTimestampInMinutes);
    if (lowRel == null || minutes == null) continue;
    const deltaOpen = asNumber(bar.deltaOpen) ?? 0;
    const deltaClose = asNumber(bar.deltaClose) ?? 0;
    const deltaHigh = asNumber(bar.deltaHigh) ?? 0;
    const low = lowRel / priceScale;
    const open = (lowRel + deltaOpen) / priceScale;
    const close = (lowRel + deltaClose) / priceScale;
    const high = (lowRel + deltaHigh) / priceScale;
    if (![open, high, low, close].every((n) => Number.isFinite(n))) continue;
    out.push({
      time: Math.floor(minutes * 60),
      open,
      high,
      low,
      close,
      volume: asNumber(bar.volume)
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export interface CTraderOpenApiClient {
  listAccountsByAccessToken(accessToken: string): Promise<DiscoveredAccount[]>;
  fetchAccountSnapshot(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    /** When true, use Pepperstone Live Open API host. */
    isLive?: boolean;
  }): Promise<AccountSnapshot>;
  discoverXauUsd(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    /** When true, use Pepperstone Live Open API host for symbol catalogue. */
    isLive?: boolean;
  }): Promise<BrokerSymbol | null>;
  fetchQuote(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    symbolId: string;
    /** When true, use Pepperstone Live Open API host for quotes. */
    isLive?: boolean;
  }): Promise<BrokerQuote>;
  /**
   * Resolve a catalogue symbol id by exact/normalized name (e.g. EURUSD).
   * Used for quote→deposit FX; not used by Decision Engine.
   */
  findSymbolIdByName?(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    symbolName: string;
    isLive?: boolean;
  }): Promise<string | null>;
  /** Display-only historical OHLC — never used by decision/autotrade engines. */
  fetchTrendbars(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    symbolId: string;
    period: TrendbarPeriodKey;
    count?: number;
    /** When true, use Pepperstone Live Open API host. */
    isLive?: boolean;
  }): Promise<TrendbarCandle[]>;
  /** Demo host only — never call for Live accounts. */
  placeDemoMarketOrder?(args: DemoMarketOrderRequest): Promise<DemoMarketOrderResult>;
  /** Demo host only — list open positions via ProtoOAReconcileReq. */
  reconcileDemoOpenPositions?(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
  }): Promise<BrokerOpenPosition[]>;
  /** Demo host only — amend absolute SL/TP on an open position. */
  amendDemoPositionSlTp?(
    args: DemoAmendSlTpRequest
  ): Promise<DemoPositionMutationResult>;
  /** Demo host only — full or partial close. */
  closeDemoPosition?(
    args: DemoClosePositionRequest
  ): Promise<DemoPositionMutationResult>;
  /** Demo host only — deals for a position (includes closing deal P/L). */
  fetchDemoDealsByPositionId?(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    positionId: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }): Promise<BrokerHistoryPage<BrokerClosedDeal>>;
  /** Demo host only — deal list in a time window (max 7 days). */
  fetchDemoDealList?(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }): Promise<BrokerClosedDeal[]>;
  /**
   * Demo host only — full deal evidence (opening + closing) in a time window.
   * Used for entry PENDING_RECONCILIATION correlation by orderId/positionId.
   * Returns hasMore so callers can prove exhaustiveness before terminal not-found.
   */
  fetchDemoDealEvidenceList?(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }): Promise<BrokerHistoryPage<BrokerDealEvidence>>;
  /** Demo host only — ProtoOAOrderListReq historical orders (max 7 days). */
  fetchDemoOrderList?(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }): Promise<BrokerHistoryPage<BrokerHistoricalOrder>>;
  /**
   * Demo host — derive freeMargin/equity from Trader + Reconcile + UnrealizedPnL.
   * Never invents freeMargin when open-position state is unknown.
   */
  fetchAuthoritativeDemoMarginSnapshot?(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
  }): Promise<AuthoritativeMarginSnapshotResult>;
  /** Demo host — ProtoOAExpectedMarginReq for a single final protocol volume. */
  fetchDemoExpectedMargin?(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    symbolId: string;
    volume: number;
    side: "BUY" | "SELL";
  }): Promise<ExpectedMarginResult>;
}

function moneyFromDigits(value: unknown, moneyDigits: number): number | null {
  const n = asNumber(value);
  if (n == null) return null;
  return n / Math.pow(10, moneyDigits);
}

export function parseBrokerClosedDeals(raw: unknown): BrokerClosedDeal[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BrokerClosedDeal[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const close = (row.closePositionDetail ?? null) as Record<
      string,
      unknown
    > | null;
    if (!close) continue;
    const dealId = row.dealId != null ? String(row.dealId) : "";
    const positionId = row.positionId != null ? String(row.positionId) : "";
    if (!dealId || !positionId) continue;
    const digits =
      asNumber(close.moneyDigits) ?? asNumber(row.moneyDigits) ?? 2;
    const grossPnl = moneyFromDigits(close.grossProfit, digits);
    const commission = moneyFromDigits(close.commission, digits);
    const swap = moneyFromDigits(close.swap, digits);
    const netPnl =
      grossPnl == null
        ? null
        : Number(
            (
              grossPnl +
              (swap ?? 0) -
              Math.abs(commission ?? 0)
            ).toFixed(8)
          );
    const closedVol = asNumber(close.closedVolume);
    const execTs = asNumber(row.executionTimestamp ?? row.utcLastUpdateTimestamp);
    out.push({
      dealId,
      orderId: row.orderId != null ? String(row.orderId) : null,
      positionId,
      closePrice: asNumber(row.executionPrice),
      closedAt: execTs != null ? new Date(execTs).toISOString() : null,
      grossPnl,
      commission,
      swap,
      netPnl,
      closedVolumeLots:
        closedVol != null ? Number((closedVol / 100).toFixed(2)) : null,
      entryPrice: asNumber(close.entryPrice)
    });
  }
  return out;
}

function normalizeOrderStatus(value: unknown): {
  code: number | null;
  name: string | null;
} {
  if (value == null) return { code: null, name: null };
  if (typeof value === "number" && Number.isFinite(value)) {
    const code = Math.trunc(value);
    const names: Record<number, string> = {
      1: "ORDER_STATUS_ACCEPTED",
      2: "ORDER_STATUS_FILLED",
      3: "ORDER_STATUS_REJECTED",
      4: "ORDER_STATUS_EXPIRED",
      5: "ORDER_STATUS_CANCELLED"
    };
    return { code, name: names[code] ?? `ORDER_STATUS_${code}` };
  }
  const raw = String(value).trim().toUpperCase();
  if (!raw) return { code: null, name: null };
  if (raw === "1" || raw.includes("ACCEPTED")) {
    return { code: 1, name: "ORDER_STATUS_ACCEPTED" };
  }
  if (raw === "2" || raw.includes("FILLED")) {
    return { code: 2, name: "ORDER_STATUS_FILLED" };
  }
  if (raw === "3" || raw.includes("REJECTED")) {
    return { code: 3, name: "ORDER_STATUS_REJECTED" };
  }
  if (raw === "4" || raw.includes("EXPIRED")) {
    return { code: 4, name: "ORDER_STATUS_EXPIRED" };
  }
  if (raw === "5" || raw.includes("CANCELLED") || raw.includes("CANCELED")) {
    return { code: 5, name: "ORDER_STATUS_CANCELLED" };
  }
  return { code: null, name: raw };
}

export function parseBrokerHistoricalOrders(raw: unknown): BrokerHistoricalOrder[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BrokerHistoricalOrder[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const trade = (row.tradeData ?? {}) as Record<string, unknown>;
    const orderId =
      row.orderId != null
        ? String(row.orderId)
        : trade.orderId != null
          ? String(trade.orderId)
          : "";
    if (!orderId) continue;
    const status = normalizeOrderStatus(row.orderStatus);
    const sideNum = asNumber(trade.tradeSide ?? row.tradeSide);
    const executedVol = asNumber(row.executedVolume ?? trade.volume);
    const createdTs = asNumber(trade.openTimestamp ?? row.openTimestamp);
    const updatedTs = asNumber(row.utcLastUpdateTimestamp);
    out.push({
      orderId,
      positionId:
        row.positionId != null
          ? String(row.positionId)
          : trade.positionId != null
            ? String(trade.positionId)
            : null,
      clientOrderId:
        row.clientOrderId != null
          ? String(row.clientOrderId)
          : trade.clientOrderId != null
            ? String(trade.clientOrderId)
            : null,
      orderStatus: status.name,
      orderStatusCode: status.code,
      tradeSide: sideNum === 2 ? "SELL" : sideNum === 1 ? "BUY" : null,
      symbolId:
        trade.symbolId != null
          ? String(trade.symbolId)
          : row.symbolId != null
            ? String(row.symbolId)
            : null,
      label: typeof trade.label === "string" ? trade.label : null,
      comment: typeof trade.comment === "string" ? trade.comment : null,
      executionPrice: asNumber(row.executionPrice),
      executedVolumeLots:
        executedVol != null ? Number((executedVol / 100).toFixed(8)) : null,
      createdAt: createdTs != null ? new Date(createdTs).toISOString() : null,
      updatedAt: updatedTs != null ? new Date(updatedTs).toISOString() : null,
      closingOrder: row.closingOrder === true
    });
  }
  return out;
}

export function parseBrokerDealEvidence(raw: unknown): BrokerDealEvidence[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BrokerDealEvidence[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const trade = (row.tradeData ?? {}) as Record<string, unknown>;
    const dealId = row.dealId != null ? String(row.dealId) : "";
    if (!dealId) continue;
    const closeRaw = (row.closePositionDetail ?? null) as Record<
      string,
      unknown
    > | null;
    const closing = parseBrokerClosedDeals([row]);
    const sideNum = asNumber(row.tradeSide);
    const filledVol = asNumber(row.filledVolume ?? row.volume);
    const execTs = asNumber(row.executionTimestamp ?? row.utcLastUpdateTimestamp);
    const dealStatusRaw = row.dealStatus;
    const dealStatus =
      dealStatusRaw == null
        ? null
        : typeof dealStatusRaw === "number"
          ? String(dealStatusRaw)
          : String(dealStatusRaw).trim() || null;
    const label =
      typeof row.label === "string"
        ? row.label
        : typeof trade.label === "string"
          ? trade.label
          : null;
    const comment =
      typeof row.comment === "string"
        ? row.comment
        : typeof trade.comment === "string"
          ? trade.comment
          : null;
    out.push({
      dealId,
      orderId: row.orderId != null ? String(row.orderId) : null,
      positionId: row.positionId != null ? String(row.positionId) : null,
      executionPrice: asNumber(row.executionPrice),
      executedAt: execTs != null ? new Date(execTs).toISOString() : null,
      filledVolumeLots:
        filledVol != null ? Number((filledVol / 100).toFixed(8)) : null,
      tradeSide: sideNum === 2 ? "SELL" : sideNum === 1 ? "BUY" : null,
      isClosing: closeRaw != null,
      close: closing[0] ?? null,
      label,
      comment,
      symbolId:
        row.symbolId != null
          ? String(row.symbolId)
          : trade.symbolId != null
            ? String(trade.symbolId)
            : null,
      dealStatus
    });
  }
  return out;
}

/** Exact goldHunterTradeId label ownership — never comment-only. */
export function findDealByExactGoldHunterLabel(
  deals: readonly BrokerDealEvidence[],
  goldHunterTradeId: string
): BrokerDealEvidence | null {
  const want = goldHunterTradeId.trim();
  if (!want) return null;
  return deals.find((d) => d.label === want) ?? null;
}

/** Exact clientOrderId match — never fall back to newest / same-side. */
export function findHistoricalOrderByClientOrderId(
  orders: readonly BrokerHistoricalOrder[],
  clientOrderId: string
): BrokerHistoricalOrder | null {
  const want = clientOrderId.trim();
  if (!want) return null;
  return orders.find((o) => o.clientOrderId === want) ?? null;
}

/** Aggregate closing deals for one position into a single confirmed result. */
export function aggregateClosingDeals(
  deals: BrokerClosedDeal[]
): BrokerClosedDeal | null {
  if (!deals.length) return null;
  const sorted = [...deals].sort(
    (a, b) => Date.parse(a.closedAt ?? "") - Date.parse(b.closedAt ?? "")
  );
  let net = 0;
  let gross = 0;
  let commission = 0;
  let swap = 0;
  let hasNet = false;
  for (const d of sorted) {
    if (d.netPnl != null) {
      net += d.netPnl;
      hasNet = true;
    }
    if (d.grossPnl != null) gross += d.grossPnl;
    if (d.commission != null) commission += d.commission;
    if (d.swap != null) swap += d.swap;
  }
  const last = sorted[sorted.length - 1]!;
  if (!hasNet) return null;
  return {
    ...last,
    dealId: sorted.map((d) => d.dealId).join(","),
    grossPnl: Number(gross.toFixed(8)),
    commission: Number(commission.toFixed(8)),
    swap: Number(swap.toFixed(8)),
    netPnl: Number(net.toFixed(8))
  };
}

function parseBrokerOpenPositions(raw: unknown): BrokerOpenPosition[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BrokerOpenPosition[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const trade = (row.tradeData ?? row) as Record<string, unknown>;
    const sideNum = asNumber(trade.tradeSide ?? row.tradeSide);
    const side: "BUY" | "SELL" = sideNum === 2 ? "SELL" : "BUY";
    const volumeUnits = asNumber(trade.volume ?? row.volume);
    const positionId =
      safeIdString(row.positionId) ?? safeIdString(trade.positionId);
    if (!positionId) continue;
    const openTs = asNumber(trade.openTimestamp ?? row.openTimestamp);
    const posMoneyDigits =
      safeInteger(row.moneyDigits) ?? safeInteger(trade.moneyDigits) ?? 2;
    // ProtoOAPosition price/SL/TP are absolute money prices (not relative spot units).
    // usedMargin is deposit currency × 10^moneyDigits when present.
    const usedMargin = moneyFromDigitsSafe(
      row.usedMargin ?? trade.usedMargin,
      posMoneyDigits
    );
    out.push({
      positionId,
      symbolId:
        safeIdString(trade.symbolId) ??
        safeIdString(row.symbolId) ??
        (trade.symbolId != null
          ? String(trade.symbolId)
          : row.symbolId != null
            ? String(row.symbolId)
            : null),
      side,
      volumeUnits,
      volumeLots:
        volumeUnits != null ? Number((volumeUnits / 100).toFixed(2)) : null,
      entryPrice: asNumber(row.price ?? trade.price ?? row.entryPrice),
      stopLoss: asNumber(row.stopLoss ?? trade.stopLoss),
      takeProfit: asNumber(row.takeProfit ?? trade.takeProfit),
      unrealisedPnl: moneyFromCenti(row.unrealizedPnl ?? row.unrealisedPnl, 2),
      usedMargin,
      openTimestamp:
        openTs != null ? new Date(openTs).toISOString() : null,
      label:
        typeof trade.label === "string"
          ? trade.label
          : typeof row.label === "string"
            ? row.label
            : null,
      comment:
        typeof trade.comment === "string"
          ? trade.comment
          : typeof row.comment === "string"
            ? row.comment
            : null
    });
  }
  return out;
}

async function fetchAuthoritativeDemoMarginSnapshotImpl(
  connection: InstanceType<typeof CTraderConnection>,
  args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
  }
): Promise<AuthoritativeMarginSnapshotResult> {
  const accountId = safeWireAccountId(args.ctidTraderAccountId);
  if (accountId == null) {
    return {
      ok: false,
      notes: ["ctidTraderAccountId unsafe/invalid for wire send"]
    };
  }

  await connection.sendCommand("ProtoOAApplicationAuthReq", {
    clientId: args.clientId,
    clientSecret: args.clientSecret
  });
  await connection.sendCommand("ProtoOAAccountAuthReq", {
    accessToken: args.accessToken,
    ctidTraderAccountId: accountId
  });

  const traderRes = (await connection.sendCommand("ProtoOATraderReq", {
    ctidTraderAccountId: accountId
  })) as Record<string, unknown>;
  const t = (traderRes.trader ?? traderRes) as Record<string, unknown>;
  const moneyDigits = safeInteger(t.moneyDigits);
  if (moneyDigits == null) {
    return {
      ok: false,
      notes: ["ProtoOATrader.moneyDigits missing/invalid — fail closed"]
    };
  }
  const balance = moneyFromDigitsSafe(t.balance, moneyDigits);
  const leverageInCents = safeInteger(t.leverageInCents);
  const leverage =
    leverageInCents != null ? leverageInCents / 100 : asNumber(t.leverage);

  let reconcileOk = false;
  let positions: BrokerOpenPosition[] = [];
  try {
    const recon = (await connection.sendCommand("ProtoOAReconcileReq", {
      ctidTraderAccountId: accountId
    })) as Record<string, unknown>;
    positions = parseBrokerOpenPositions(recon.position ?? recon.positions);
    reconcileOk = true;
  } catch {
    return {
      ok: false,
      notes: ["ProtoOAReconcileReq failed — open-position state unknown"]
    };
  }

  let unrealisedRows:
    | { positionId: string; netUnrealisedPnl: number | null }[]
    | null = null;

  if (positions.length > 0) {
    try {
      const pnlRes = (await connection.sendCommand(
        "ProtoOAGetPositionUnrealizedPnLReq",
        { ctidTraderAccountId: accountId }
      )) as Record<string, unknown>;
      const pnlDigits = safeInteger(pnlRes.moneyDigits) ?? moneyDigits;
      const rows = Array.isArray(pnlRes.positionUnrealizedPnL)
        ? pnlRes.positionUnrealizedPnL
        : [];
      unrealisedRows = rows.map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return {
          positionId: safeIdString(row.positionId) ?? "",
          netUnrealisedPnl: moneyFromDigitsSafe(
            row.netUnrealizedPnL ?? row.netUnrealisedPnL,
            pnlDigits
          )
        };
      });
    } catch {
      return {
        ok: false,
        notes: [
          "ProtoOAGetPositionUnrealizedPnLReq failed with open positions — fail closed"
        ]
      };
    }
  }

  const computed = computeAuthoritativeMarginSnapshot({
    balance,
    moneyDigits,
    leverage,
    openPositionCount: positions.length,
    reconcileOk,
    positionsUsedMargin: positions.map((p) => ({
      positionId: p.positionId,
      usedMargin: p.usedMargin
    })),
    unrealisedRows
  });

  if (!computed.ok) {
    return { ok: false, notes: computed.notes };
  }
  return { ok: true, snapshot: computed.snapshot };
}

async function fetchDemoExpectedMarginImpl(
  connection: InstanceType<typeof CTraderConnection>,
  args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    symbolId: string;
    volume: number;
    side: "BUY" | "SELL";
  }
): Promise<ExpectedMarginResult> {
  const accountId = safeWireAccountId(args.ctidTraderAccountId);
  const symbolId = safeWireAccountId(args.symbolId);
  const volume = safeInteger(args.volume);
  if (accountId == null || symbolId == null || volume == null || !(volume > 0)) {
    return {
      ok: false,
      notes: ["accountId/symbolId/volume unsafe or invalid for ExpectedMargin"]
    };
  }

  await connection.sendCommand("ProtoOAApplicationAuthReq", {
    clientId: args.clientId,
    clientSecret: args.clientSecret
  });
  await connection.sendCommand("ProtoOAAccountAuthReq", {
    accessToken: args.accessToken,
    ctidTraderAccountId: accountId
  });

  let res: Record<string, unknown>;
  try {
    res = (await connection.sendCommand("ProtoOAExpectedMarginReq", {
      ctidTraderAccountId: accountId,
      symbolId,
      volume: [volume]
    })) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      notes: [
        err instanceof Error
          ? `ProtoOAExpectedMarginReq failed: ${err.message}`
          : "ProtoOAExpectedMarginReq failed"
      ]
    };
  }

  const moneyDigits = safeInteger(res.moneyDigits);
  if (moneyDigits == null) {
    return {
      ok: false,
      notes: ["ProtoOAExpectedMarginRes.moneyDigits missing/invalid"]
    };
  }
  const quotes = parseExpectedMarginEntries({
    margins: res.margin ?? res.margins,
    moneyDigits
  });
  const expected = selectSideExpectedMargin({
    side: args.side,
    protocolVolume: volume,
    quotes
  });
  if (expected == null) {
    return {
      ok: false,
      notes: [
        `No ${args.side} margin for protocol volume ${volume} in ProtoOAExpectedMarginRes`
      ]
    };
  }
  const match = quotes.find((q) => q.volume === volume);
  if (!match) {
    return {
      ok: false,
      notes: [`No margin entry with volume=${volume}`]
    };
  }
  return {
    ok: true,
    expectedMargin: expected,
    buyMargin: match.buyMargin,
    sellMargin: match.sellMargin,
    volume,
    moneyDigits
  };
}

/** Read-only Demo margin probe result (never mutates broker state). */
export type DemoMarginReadOnlyProbe = {
  ok: boolean;
  notes: string[];
  accountMasked: string | null;
  moneyDigits: number | null;
  balance: number | null;
  openPositionCount: number | null;
  usedMarginTotal: number | null;
  unrealisedNetPnl: number | null;
  equity: number | null;
  freeMargin: number | null;
  marginSource: AuthoritativeMarginSnapshot["source"] | null;
  symbolId: string | null;
  requestedProtocolVolume: number | null;
  buyMargin: number | null;
  sellMargin: number | null;
  selectedExpectedMarginBuy: number | null;
  selectedExpectedMarginSell: number | null;
  pnlPayloadAccepted: boolean;
  pnlResponsePayloadType: string | null;
  runtimeTypes: Record<string, ReturnType<typeof describeRuntimeType>>;
  ordersSubmitted: 0;
};

/**
 * READ-ONLY Demo margin probe over a live Spotware connection.
 * Never places/amends/closes orders.
 */
export async function probeDemoMarginReadOnly(args: {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  ctidTraderAccountId: string;
  symbolId: string;
  protocolVolume: number;
  accountMasked?: string | null;
}): Promise<DemoMarginReadOnlyProbe> {
  const emptyTypes: DemoMarginReadOnlyProbe["runtimeTypes"] = {};
  const baseFail = (notes: string[]): DemoMarginReadOnlyProbe => ({
    ok: false,
    notes,
    accountMasked: args.accountMasked ?? null,
    moneyDigits: null,
    balance: null,
    openPositionCount: null,
    usedMarginTotal: null,
    unrealisedNetPnl: null,
    equity: null,
    freeMargin: null,
    marginSource: null,
    symbolId: args.symbolId,
    requestedProtocolVolume: args.protocolVolume,
    buyMargin: null,
    sellMargin: null,
    selectedExpectedMarginBuy: null,
    selectedExpectedMarginSell: null,
    pnlPayloadAccepted: false,
    pnlResponsePayloadType: null,
    runtimeTypes: emptyTypes,
    ordersSubmitted: 0
  });

  const accountId = safeWireAccountId(args.ctidTraderAccountId);
  const symbolId = safeWireAccountId(args.symbolId);
  const volume = safeInteger(args.protocolVolume);
  if (accountId == null || symbolId == null || volume == null) {
    return baseFail(["unsafe accountId/symbolId/volume"]);
  }

  return withDemoConnection(async (connection) => {
    const runtimeTypes: DemoMarginReadOnlyProbe["runtimeTypes"] = {};
    const notes: string[] = [];

    await connection.sendCommand("ProtoOAApplicationAuthReq", {
      clientId: args.clientId,
      clientSecret: args.clientSecret
    });
    await connection.sendCommand("ProtoOAAccountAuthReq", {
      accessToken: args.accessToken,
      ctidTraderAccountId: accountId
    });

    const traderRes = (await connection.sendCommand("ProtoOATraderReq", {
      ctidTraderAccountId: accountId
    })) as Record<string, unknown>;
    const t = (traderRes.trader ?? traderRes) as Record<string, unknown>;
    runtimeTypes.trader_balance = describeRuntimeType(t.balance);
    runtimeTypes.trader_moneyDigits = describeRuntimeType(t.moneyDigits);
    runtimeTypes.trader_leverageInCents = describeRuntimeType(t.leverageInCents);

    const moneyDigits = safeInteger(t.moneyDigits);
    const balance =
      moneyDigits != null ? moneyFromDigitsSafe(t.balance, moneyDigits) : null;
    if (moneyDigits == null || balance == null) {
      notes.push("Trader balance/moneyDigits decode failed");
    }

    const recon = (await connection.sendCommand("ProtoOAReconcileReq", {
      ctidTraderAccountId: accountId
    })) as Record<string, unknown>;
    const positions = parseBrokerOpenPositions(
      recon.position ?? recon.positions
    );
    if (positions[0]) {
      runtimeTypes.position0_positionId = describeRuntimeType(
        ((recon.position ?? recon.positions) as unknown[])?.[0] &&
          (((recon.position ?? recon.positions) as unknown[])[0] as Record<
            string,
            unknown
          >).positionId
      );
      const raw0 = ((recon.position ?? recon.positions) as unknown[])[0] as
        | Record<string, unknown>
        | undefined;
      if (raw0) {
        runtimeTypes.position0_usedMargin = describeRuntimeType(raw0.usedMargin);
        runtimeTypes.position0_moneyDigits = describeRuntimeType(
          raw0.moneyDigits
        );
      }
    }

    let pnlPayloadAccepted = false;
    let pnlResponsePayloadType: string | null = null;
    let unrealisedRows:
      | { positionId: string; netUnrealisedPnl: number | null }[]
      | null = null;
    try {
      const pnlRes = (await connection.sendCommand(
        "ProtoOAGetPositionUnrealizedPnLReq",
        { ctidTraderAccountId: accountId }
      )) as Record<string, unknown>;
      pnlPayloadAccepted = true;
      pnlResponsePayloadType =
        pnlRes.payloadType != null
          ? String(pnlRes.payloadType)
          : "ProtoOAGetPositionUnrealizedPnLRes";
      const pnlDigits = safeInteger(pnlRes.moneyDigits) ?? moneyDigits ?? 2;
      runtimeTypes.pnl_moneyDigits = describeRuntimeType(pnlRes.moneyDigits);
      const rows = Array.isArray(pnlRes.positionUnrealizedPnL)
        ? pnlRes.positionUnrealizedPnL
        : [];
      if (rows[0]) {
        const r0 = rows[0] as Record<string, unknown>;
        runtimeTypes.pnl0_positionId = describeRuntimeType(r0.positionId);
        runtimeTypes.pnl0_grossUnrealizedPnL = describeRuntimeType(
          r0.grossUnrealizedPnL
        );
        runtimeTypes.pnl0_netUnrealizedPnL = describeRuntimeType(
          r0.netUnrealizedPnL
        );
      }
      unrealisedRows = rows.map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return {
          positionId: safeIdString(row.positionId) ?? "",
          netUnrealisedPnl: moneyFromDigitsSafe(
            row.netUnrealizedPnL ?? row.netUnrealisedPnL,
            pnlDigits
          )
        };
      });
      notes.push("ProtoOAGetPositionUnrealizedPnLReq accepted");
    } catch (err) {
      notes.push(
        err instanceof Error
          ? `ProtoOAGetPositionUnrealizedPnLReq failed: ${err.message}`
          : "ProtoOAGetPositionUnrealizedPnLReq failed"
      );
    }

    const computed =
      moneyDigits != null
        ? computeAuthoritativeMarginSnapshot({
            balance,
            moneyDigits,
            leverage: null,
            openPositionCount: positions.length,
            reconcileOk: true,
            positionsUsedMargin: positions.map((p) => ({
              positionId: p.positionId,
              usedMargin: p.usedMargin
            })),
            unrealisedRows
          })
        : ({
            ok: false as const,
            reason: "MARGIN_UNAVAILABLE" as const,
            notes: ["moneyDigits"]
          });

    let buyMargin: number | null = null;
    let sellMargin: number | null = null;
    let expDigits: number | null = null;
    try {
      const exp = (await connection.sendCommand("ProtoOAExpectedMarginReq", {
        ctidTraderAccountId: accountId,
        symbolId,
        volume: [volume]
      })) as Record<string, unknown>;
      expDigits = safeInteger(exp.moneyDigits);
      runtimeTypes.expected_moneyDigits = describeRuntimeType(exp.moneyDigits);
      const margins = (exp.margin ?? exp.margins) as unknown[];
      if (Array.isArray(margins) && margins[0]) {
        const m0 = margins[0] as Record<string, unknown>;
        runtimeTypes.expected0_volume = describeRuntimeType(m0.volume);
        runtimeTypes.expected0_buyMargin = describeRuntimeType(m0.buyMargin);
        runtimeTypes.expected0_sellMargin = describeRuntimeType(m0.sellMargin);
      }
      if (expDigits != null) {
        const quotes = parseExpectedMarginEntries({
          margins: exp.margin ?? exp.margins,
          moneyDigits: expDigits
        });
        const match = quotes.find((q) => q.volume === volume);
        if (match) {
          buyMargin = match.buyMargin;
          sellMargin = match.sellMargin;
        } else {
          notes.push(`ExpectedMargin missing volume=${volume} entry`);
        }
      } else {
        notes.push("ExpectedMargin moneyDigits invalid");
      }
    } catch (err) {
      notes.push(
        err instanceof Error
          ? `ProtoOAExpectedMarginReq failed: ${err.message}`
          : "ProtoOAExpectedMarginReq failed"
      );
    }

    const snapOk = computed.ok === true;
    const snapshot = snapOk ? computed.snapshot : null;

    return {
      ok:
        pnlPayloadAccepted &&
        snapOk &&
        buyMargin != null &&
        sellMargin != null &&
        buyMargin > 0 &&
        sellMargin > 0,
      notes,
      accountMasked: args.accountMasked ?? null,
      moneyDigits: snapshot?.moneyDigits ?? moneyDigits,
      balance: snapshot?.balance ?? balance,
      openPositionCount: positions.length,
      usedMarginTotal: snapshot?.usedMargin ?? null,
      unrealisedNetPnl: snapshot?.unrealisedNetPnl ?? null,
      equity: snapshot?.equity ?? null,
      freeMargin: snapshot?.freeMargin ?? null,
      marginSource: snapshot?.source ?? null,
      symbolId: String(symbolId),
      requestedProtocolVolume: volume,
      buyMargin,
      sellMargin,
      selectedExpectedMarginBuy: buyMargin,
      selectedExpectedMarginSell: sellMargin,
      pnlPayloadAccepted,
      pnlResponsePayloadType,
      runtimeTypes,
      ordersSubmitted: 0
    };
  });
}

/**
 * Collect ProtoOAExecutionEvent(s) until a position id is present or timeout.
 * First event alone often accepts the order before the position snapshot arrives.
 */
async function waitForDemoExecution(
  connection: InstanceType<typeof CTraderConnection>,
  timeoutMs = 15_000
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let latest: Record<string, unknown> = {};
    let settled = false;
    const finish = (value: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      if (Object.keys(latest).length > 0) finish(latest);
      else reject(new Error("CTRADER_ORDER_TIMEOUT"));
    }, timeoutMs);
    connection.on(
      "ProtoOAExecutionEvent",
      (event: { descriptor?: Record<string, unknown> }) => {
        const descriptor = event?.descriptor ?? {};
        latest = { ...latest, ...descriptor };
        const order = (descriptor.order ?? latest.order ?? {}) as Record<
          string,
          unknown
        >;
        const position = (descriptor.position ?? latest.position ?? {}) as Record<
          string,
          unknown
        >;
        if (order.orderId != null && latest.order == null) latest.order = order;
        if (position.positionId != null) {
          latest.position = position;
          finish(latest);
        }
      }
    );
    connection.on(
      "ProtoOAErrorRes",
      (event: { descriptor?: Record<string, unknown> }) => {
        const descriptor = event?.descriptor ?? {};
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            String(
              descriptor.errorCode ??
                descriptor.description ??
                "CTRADER_ORDER_ERROR"
            )
          )
        );
      }
    );
  });
}

function _extractFillFromExecution(
  execution: Record<string, unknown>
): {
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  filledVolumeLots: number | null;
} {
  const position = (execution.position ?? {}) as Record<string, unknown>;
  const trade = (position.tradeData ?? position.trade ?? {}) as Record<
    string,
    unknown
  >;
  const deal = (execution.deal ?? {}) as Record<string, unknown>;
  const fillPrice =
    asNumber(deal.executionPrice) ??
    asNumber(position.price) ??
    asNumber(trade.price) ??
    asNumber(execution.price);
  const stopLoss =
    asNumber(position.stopLoss) ??
    asNumber(trade.stopLoss) ??
    asNumber(execution.stopLoss);
  const takeProfit =
    asNumber(position.takeProfit) ??
    asNumber(trade.takeProfit) ??
    asNumber(execution.takeProfit);
  const volUnits =
    asNumber(deal.filledVolume) ??
    asNumber(trade.volume) ??
    asNumber(position.volume);
  return {
    fillPrice,
    stopLoss,
    takeProfit,
    filledVolumeLots:
      volUnits != null ? Number((volUnits / 100).toFixed(8)) : null
  };
}

function mapDiscovered(raw: Record<string, unknown>): DiscoveredAccount {
  // Prefer Open API ctidTraderAccountId — never silently substitute traderLogin
  // as the order-auth id (login is a separate UI/notification identifier).
  const id = String(raw.ctidTraderAccountId ?? raw.accountId ?? "");
  const traderLogin =
    raw.traderLogin != null && String(raw.traderLogin).trim() !== ""
      ? String(raw.traderLogin)
      : null;
  const isLive = Boolean(raw.isLive ?? raw.live ?? false);
  const brokerNameTitle =
    typeof raw.brokerTitle === "string"
      ? raw.brokerTitle
      : typeof raw.brokerNameTitle === "string"
        ? raw.brokerNameTitle
        : typeof raw.brokerName === "string"
          ? raw.brokerName
          : null;
  return {
    ctidTraderAccountId: id,
    traderLogin,
    isLive,
    brokerNameTitle,
    depositCurrency:
      typeof raw.depositAsset === "string"
        ? raw.depositAsset
        : typeof raw.depositCurrency === "string"
          ? raw.depositCurrency
          : typeof raw.currency === "string"
            ? raw.currency
            : null,
    leverage:
      typeof raw.leverage === "number"
        ? raw.leverage
        : typeof raw.leverageInCents === "number"
          ? raw.leverageInCents / 100
          : null,
    accountIdMasked: maskAccountId(id),
    accountKeyHash: hashAccountKey(id)
  };
}

async function withOpenApiConnection<T>(
  args: {
    isLive?: boolean;
  },
  fn: (connection: InstanceType<typeof CTraderConnection>) => Promise<T>
): Promise<T> {
  const connection = new CTraderConnection({
    host: args.isLive ? LIVE_HOST : DEMO_HOST,
    port: args.isLive ? LIVE_PORT : DEMO_PORT
  });
  await connection.open();
  try {
    return await fn(connection);
  } finally {
    try {
      void connection.close();
    } catch {
      /* ignore close errors */
    }
  }
}

/** @deprecated Prefer withOpenApiConnection — Demo host helper kept for call sites. */
async function withDemoConnection<T>(
  fn: (connection: InstanceType<typeof CTraderConnection>) => Promise<T>
): Promise<T> {
  return withOpenApiConnection({ isLive: false }, fn);
}

/**
 * Spotware HTTP account list.
 * Do NOT use CTraderConnection.getAccessTokenAccounts — that helper
 * JSON.parse's axios's already-parsed object and throws
 * `"[object Object]" is not valid JSON`.
 */
export async function fetchTradingAccountsByAccessToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<DiscoveredAccount[]> {
  const uri = `https://api.spotware.com/connect/tradingaccounts?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetchImpl(uri);
  if (!res.ok) {
    throw new Error(`CTRADER_ACCOUNT_LIST_FAILED status=${res.status}`);
  }
  const raw = (await res.json()) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data as unknown[])
      : [];
  return list
    .filter((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      if (row.deleted === true) return false;
      const status = String(row.accountStatus ?? "").toUpperCase();
      if (status === "DELETED" || status === "DISABLED") return false;
      return true;
    })
    .map((item) => mapDiscovered((item ?? {}) as Record<string, unknown>))
    .filter((a) => a.ctidTraderAccountId.length > 0);
}

export function createLiveOpenApiClient(): CTraderOpenApiClient {
  return {
    async listAccountsByAccessToken(accessToken: string) {
      return fetchTradingAccountsByAccessToken(accessToken);
    },

    async fetchAccountSnapshot(args) {
      const isLive = Boolean(args.isLive);
      return withOpenApiConnection({ isLive }, async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const trader = (await connection.sendCommand("ProtoOATraderReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        })) as Record<string, unknown>;
        const t = (trader.trader ?? trader) as Record<string, unknown>;
        const moneyDigits = asNumber(t.moneyDigits) ?? 2;
        const balance = moneyFromCenti(t.balance, moneyDigits);
        let freeMargin = moneyFromCenti(t.freeMargin, moneyDigits);
        let usedMargin = moneyFromCenti(t.usedMargin, moneyDigits);
        let equity =
          moneyFromCenti(t.equity, moneyDigits) ??
          balance;

        // Margin fields are often absent on ProtoOATraderRes — try reconcile.
        if (freeMargin == null || usedMargin == null) {
          try {
            const recon = (await connection.sendCommand("ProtoOAReconcileReq", {
              ctidTraderAccountId: Number(args.ctidTraderAccountId)
            })) as Record<string, unknown>;
            freeMargin =
              freeMargin ?? moneyFromCenti(recon.freeMargin, moneyDigits);
            usedMargin =
              usedMargin ?? moneyFromCenti(recon.usedMargin, moneyDigits);
            equity = moneyFromCenti(recon.equity, moneyDigits) ?? equity;
          } catch {
            /* reconcile optional */
          }
        }

        let currency: string | null =
          typeof t.depositAsset === "string" ? t.depositAsset : null;
        const depositAssetId = asNumber(t.depositAssetId);
        if (!currency && depositAssetId != null) {
          try {
            const assetsRes = (await connection.sendCommand(
              "ProtoOAAssetListReq",
              { ctidTraderAccountId: Number(args.ctidTraderAccountId) }
            )) as { asset?: Array<Record<string, unknown>>; assets?: Array<Record<string, unknown>> };
            const assets = assetsRes.asset ?? assetsRes.assets ?? [];
            const match = assets.find(
              (a) => asNumber(a.assetId) === depositAssetId
            );
            currency =
              typeof match?.name === "string"
                ? match.name
                : typeof match?.displayName === "string"
                  ? match.displayName
                  : null;
          } catch {
            /* asset list optional */
          }
        }

        const leverageInCents = asNumber(t.leverageInCents);
        return {
          balance,
          equity,
          freeMargin,
          usedMargin,
          currency,
          leverage:
            leverageInCents != null
              ? leverageInCents / 100
              : asNumber(t.leverage)
        };
      });
    },

    async discoverXauUsd(args) {
      const isLive = Boolean(args.isLive);
      return withOpenApiConnection({ isLive }, async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });

        const assetsRes = (await connection.sendCommand(
          "ProtoOAAssetListReq",
          { ctidTraderAccountId: Number(args.ctidTraderAccountId) }
        ).catch(() => ({ asset: [] }))) as {
          asset?: Array<Record<string, unknown>>;
          assets?: Array<Record<string, unknown>>;
        };
        const assetById = new Map<number, string>();
        for (const a of assetsRes.asset ?? assetsRes.assets ?? []) {
          const id = asNumber(a.assetId);
          const name =
            typeof a.name === "string"
              ? a.name
              : typeof a.displayName === "string"
                ? a.displayName
                : null;
          if (id != null && name) assetById.set(id, name);
        }

        const symbolsRes = (await connection.sendCommand(
          "ProtoOASymbolsListReq",
          {
            ctidTraderAccountId: Number(args.ctidTraderAccountId)
          }
        )) as { symbol?: unknown[]; symbols?: unknown[] };
        const rawList = (symbolsRes.symbol ??
          symbolsRes.symbols ??
          []) as Array<Record<string, unknown>>;
        const mapped: RawCTraderSymbol[] = rawList.map((s) => {
          const baseId = asNumber(s.baseAssetId);
          const quoteId = asNumber(s.quoteAssetId);
          return {
            symbolId: s.symbolId as number | string | undefined,
            symbolName: String(s.symbolName ?? s.name ?? ""),
            description: String(s.description ?? ""),
            baseAsset:
              s.baseAsset != null
                ? String(s.baseAsset)
                : baseId != null
                  ? assetById.get(baseId)
                  : undefined,
            quoteAsset:
              s.quoteAsset != null
                ? String(s.quoteAsset)
                : quoteId != null
                  ? assetById.get(quoteId)
                  : undefined
          };
        });

        const candidate = pickXauUsdCandidate(mapped);
        if (!candidate?.symbolId) return null;

        const detailRes = (await connection.sendCommand(
          "ProtoOASymbolByIdReq",
          {
            ctidTraderAccountId: Number(args.ctidTraderAccountId),
            symbolId: [Number(candidate.symbolId)]
          }
        )) as { symbol?: Array<Record<string, unknown>> | Record<string, unknown> };
        const detailList = Array.isArray(detailRes.symbol)
          ? detailRes.symbol
          : detailRes.symbol
            ? [detailRes.symbol]
            : [];
        const detail = detailList[0] ?? {};
        const enrichedCandidate = {
          symbolId: candidate.symbolId,
          symbolName: candidate.symbolName,
          description: candidate.description,
          baseAsset: candidate.baseAsset ?? "XAU",
          quoteAsset: candidate.quoteAsset ?? "USD"
        };
        return brokerSymbolFromProtoOASymbolById({
          detail,
          symbolId: enrichedCandidate.symbolId!,
          symbolName: enrichedCandidate.symbolName,
          baseAsset: enrichedCandidate.baseAsset,
          quoteAsset: enrichedCandidate.quoteAsset,
          environment: isLive ? "LIVE" : "DEMO"
        });
      });
    },

    async findSymbolIdByName(args) {
      const isLive = Boolean(args.isLive);
      const wanted = String(args.symbolName ?? "")
        .trim()
        .toUpperCase()
        .replace(/[/\s._-]/g, "");
      if (!wanted) return null;
      return withOpenApiConnection({ isLive }, async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const symbolsRes = (await connection.sendCommand(
          "ProtoOASymbolsListReq",
          {
            ctidTraderAccountId: Number(args.ctidTraderAccountId)
          }
        )) as { symbol?: unknown[]; symbols?: unknown[] };
        const rawList = (symbolsRes.symbol ??
          symbolsRes.symbols ??
          []) as Array<Record<string, unknown>>;
        for (const s of rawList) {
          const name = String(s.symbolName ?? s.name ?? "")
            .trim()
            .toUpperCase()
            .replace(/[/\s._-]/g, "");
          if (name === wanted && s.symbolId != null) {
            return String(s.symbolId);
          }
        }
        return null;
      });
    },

    async fetchQuote(args) {
      const isLive = Boolean(args.isLive);
      return withOpenApiConnection({ isLive }, async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });

        let marketStatus: BrokerQuote["marketStatus"] = "UNKNOWN";
        let symbolName = "XAUUSD";
        try {
          const detailRes = (await connection.sendCommand(
            "ProtoOASymbolByIdReq",
            {
              ctidTraderAccountId: Number(args.ctidTraderAccountId),
              symbolId: [Number(args.symbolId)]
            }
          )) as { symbol?: Array<Record<string, unknown>> | Record<string, unknown> };
          const detailList = Array.isArray(detailRes.symbol)
            ? detailRes.symbol
            : detailRes.symbol
              ? [detailRes.symbol]
              : [];
          const detail = detailList[0] ?? {};
          if (typeof detail.symbolName === "string" && detail.symbolName.trim()) {
            symbolName = detail.symbolName.trim();
          }
          marketStatus = marketStatusFromSchedule({
            schedule: parseScheduleIntervals(detail.schedule),
            timeZone:
              typeof detail.scheduleTimeZone === "string"
                ? detail.scheduleTimeZone
                : "UTC"
          });
        } catch {
          marketStatus = "UNKNOWN";
        }

        const spotPromise = new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("CTRADER_QUOTE_TIMEOUT")),
              SPOT_EVENT_TIMEOUT_MS
            );
            connection.on("ProtoOASpotEvent", (event: { descriptor?: Record<string, unknown> }) => {
              const descriptor = event?.descriptor ?? {};
              if (
                asNumber(descriptor.symbolId) != null &&
                asNumber(descriptor.symbolId) !== Number(args.symbolId)
              ) {
                return;
              }
              clearTimeout(timer);
              resolve(descriptor);
            });
          }
        );

        await connection.sendCommand("ProtoOASubscribeSpotsReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          symbolId: [Number(args.symbolId)],
          subscribeToSpotTimestamp: true
        });

        const spot = await spotPromise;
        const bid = spotPriceFromRelative(spot.bid);
        const ask = spotPriceFromRelative(spot.ask);
        if (bid == null || ask == null) {
          throw new Error("CTRADER_QUOTE_UNAVAILABLE");
        }
        if (!(ask >= bid)) {
          throw new Error("CTRADER_QUOTE_BID_ASK_REVERSED");
        }
        const spread = Number((ask - bid).toFixed(6));
        const tsMs = asNumber(spot.timestamp);
        const timestamp = tsMs
          ? new Date(tsMs).toISOString()
          : new Date().toISOString();
        return {
          symbolId: args.symbolId,
          symbolName,
          bid,
          ask,
          spread,
          timestamp,
          marketStatus,
          stale: false,
          source: "LIVE"
        } satisfies BrokerQuote;
      });
    },

    async fetchTrendbars(args) {
      const isLive = Boolean(args.isLive);
      const period = TRENDBAR_PERIOD[args.period];
      const count = Math.min(Math.max(args.count ?? 120, 1), 300);
      const toTimestamp = Date.now();
      const periodMs =
        args.period === "M1"
          ? 60_000
          : args.period === "M5"
            ? 5 * 60_000
            : args.period === "M15"
              ? 15 * 60_000
              : args.period === "H1"
                ? 60 * 60_000
                : 4 * 60 * 60_000;
      // Tight window: enough bars + small buffer, still inside Spotware limits.
      const windowMs = Math.min(
        periodMs * (count + 20),
        args.period === "M5"
          ? 14 * 24 * 60 * 60 * 1000
          : args.period === "H4"
            ? 180 * 24 * 60 * 60 * 1000
            : 60 * 24 * 60 * 60 * 1000
      );
      const fromTimestamp = Math.max(0, toTimestamp - windowMs);
      return withOpenApiConnection({ isLive }, async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const res = (await connection.sendCommand("ProtoOAGetTrendbarsReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          fromTimestamp,
          toTimestamp,
          period,
          symbolId: Number(args.symbolId),
          count
        })) as { trendbar?: unknown };
        return parseTrendbarCandles(res.trendbar);
      });
    },

    async placeDemoMarketOrder(args) {
      const clientOrderId = (
        args.clientOrderId ?? `gm_${Date.now().toString(36)}`
      ).slice(0, 50);
      return withFastDemoSession(
        {
          accessToken: args.accessToken,
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          ctidTraderAccountId: args.ctidTraderAccountId
        },
        async (session) => {
          const result = await submitFastMarketOrder({
            request: {
              ctidTraderAccountId: args.ctidTraderAccountId,
              symbolId: args.symbolId,
              side: args.side,
              volume: args.volume,
              relativeStopLoss: args.relativeStopLoss,
              relativeTakeProfit: args.relativeTakeProfit,
              clientOrderId,
              label: args.label ?? "GoldMeta Demo",
              comment: args.comment ?? "GoldMeta Demo"
            },
            transport: session,
            reconcile: { reconcile: () => session.reconcile() }
          });
          return toDemoMarketOrderResult(result) satisfies DemoMarketOrderResult;
        }
      );
    },

    async reconcileDemoOpenPositions(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const recon = (await connection.sendCommand("ProtoOAReconcileReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        })) as Record<string, unknown>;
        return parseBrokerOpenPositions(recon.position ?? recon.positions);
      });
    },

    async amendDemoPositionSlTp(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const executionPromise = waitForDemoExecution(connection);
        const payload: Record<string, unknown> = {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          positionId: Number(args.positionId)
        };
        if (args.stopLoss != null && Number.isFinite(args.stopLoss)) {
          payload.stopLoss = args.stopLoss;
        }
        if (args.takeProfit != null && Number.isFinite(args.takeProfit)) {
          payload.takeProfit = args.takeProfit;
        }
        await connection.sendCommand("ProtoOAAmendPositionSLTPReq", payload);
        const execution = await executionPromise;
        const position = (execution.position ?? {}) as Record<string, unknown>;
        const errorCode =
          typeof execution.errorCode === "string" ? execution.errorCode : null;
        return {
          accepted: !errorCode,
          executionType:
            execution.executionType != null
              ? String(execution.executionType)
              : null,
          positionId:
            position.positionId != null
              ? String(position.positionId)
              : args.positionId,
          errorCode,
          raw: execution
        } satisfies DemoPositionMutationResult;
      });
    },

    async closeDemoPosition(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const executionPromise = waitForDemoExecution(connection);
        await connection.sendCommand("ProtoOAClosePositionReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          positionId: Number(args.positionId),
          volume: args.volume
        });
        const execution = await executionPromise;
        const position = (execution.position ?? {}) as Record<string, unknown>;
        const errorCode =
          typeof execution.errorCode === "string" ? execution.errorCode : null;
        return {
          accepted: !errorCode,
          executionType:
            execution.executionType != null
              ? String(execution.executionType)
              : null,
          positionId:
            position.positionId != null
              ? String(position.positionId)
              : args.positionId,
          errorCode,
          raw: execution
        } satisfies DemoPositionMutationResult;
      });
    },

    async fetchDemoDealsByPositionId(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const clamped = clampOrderTsAnchoredHistoryWindow({
          fromTimestampMs: args.fromTimestampMs,
          toTimestampMs: args.toTimestampMs
        });
        const res = (await connection.sendCommand(
          "ProtoOADealListByPositionIdReq",
          {
            ctidTraderAccountId: Number(args.ctidTraderAccountId),
            positionId: Number(args.positionId),
            fromTimestamp: clamped.fromTimestampMs,
            toTimestamp: clamped.toTimestampMs
          }
        )) as Record<string, unknown>;
        return {
          items: parseBrokerClosedDeals(res.deal ?? res.deals),
          hasMore: parseHistoryHasMore(res.hasMore),
          fromTimestampMs: clamped.fromTimestampMs,
          toTimestampMs: clamped.toTimestampMs
        };
      });
    },

    async fetchDemoDealList(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        // Spotware: toTimestamp - fromTimestamp <= 7 days; toTimestamp must not be future.
        const nowMs = Date.now();
        const toTimestamp = Math.min(args.toTimestampMs, nowMs);
        const span = Math.min(
          Math.max(toTimestamp - args.fromTimestampMs, 1),
          7 * 86_400_000
        );
        const fromTimestamp = toTimestamp - span;
        const res = (await connection.sendCommand("ProtoOADealListReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          fromTimestamp,
          toTimestamp
        })) as Record<string, unknown>;
        return parseBrokerClosedDeals(res.deal ?? res.deals);
      });
    },

    async fetchDemoDealEvidenceList(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const clamped = clampOrderTsAnchoredHistoryWindow({
          fromTimestampMs: args.fromTimestampMs,
          toTimestampMs: args.toTimestampMs
        });
        const res = (await connection.sendCommand("ProtoOADealListReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          fromTimestamp: clamped.fromTimestampMs,
          toTimestamp: clamped.toTimestampMs
        })) as Record<string, unknown>;
        return {
          items: parseBrokerDealEvidence(res.deal ?? res.deals),
          hasMore: parseHistoryHasMore(res.hasMore),
          fromTimestampMs: clamped.fromTimestampMs,
          toTimestampMs: clamped.toTimestampMs
        };
      });
    },

    async fetchDemoOrderList(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const clamped = clampOrderTsAnchoredHistoryWindow({
          fromTimestampMs: args.fromTimestampMs,
          toTimestampMs: args.toTimestampMs
        });
        const res = (await connection.sendCommand("ProtoOAOrderListReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          fromTimestamp: clamped.fromTimestampMs,
          toTimestamp: clamped.toTimestampMs
        })) as Record<string, unknown>;
        return {
          items: parseBrokerHistoricalOrders(res.order ?? res.orders),
          hasMore: parseHistoryHasMore(res.hasMore),
          fromTimestampMs: clamped.fromTimestampMs,
          toTimestampMs: clamped.toTimestampMs
        };
      });
    },

    async fetchAuthoritativeDemoMarginSnapshot(args) {
      return withDemoConnection((connection) =>
        fetchAuthoritativeDemoMarginSnapshotImpl(connection, args)
      );
    },

    async fetchDemoExpectedMargin(args) {
      return withDemoConnection((connection) =>
        fetchDemoExpectedMarginImpl(connection, args)
      );
    }
  };
}

/** Test double — never used in production routes unless CTRADER_OPENAPI_TRANSPORT=mock */
export function createMockOpenApiClient(opts?: {
  accounts?: DiscoveredAccount[];
  symbol?: BrokerSymbol | null;
  quote?: BrokerQuote;
  snapshot?: AccountSnapshot;
  /** Optional EURUSD quote for quote→deposit FX tests. */
  eurusdQuote?: BrokerQuote;
  /** Optional authoritative margin snapshot for Demo gate tests. */
  authoritativeMargin?: AuthoritativeMarginSnapshotResult;
  /** Optional expected margin (deposit) for a volume — used for both sides unless overridden. */
  expectedMarginDeposit?: number;
  expectedBuyMargin?: number;
  expectedSellMargin?: number;
  expectedMarginFail?: boolean;
}): CTraderOpenApiClient {
  const accounts =
    opts?.accounts ??
    ([
      {
        ctidTraderAccountId: "123456",
        traderLogin: "4261013",
        isLive: false,
        brokerNameTitle: "Pepperstone",
        depositCurrency: "EUR",
        leverage: 100,
        accountIdMasked: maskAccountId("123456"),
        accountKeyHash: hashAccountKey("123456")
      }
    ] satisfies DiscoveredAccount[]);
  const eurusdSymbolId = "1";
  return {
    async listAccountsByAccessToken() {
      return accounts;
    },
    async fetchAccountSnapshot() {
      return (
        opts?.snapshot ?? {
          balance: 10000,
          equity: 10000,
          freeMargin: 9500,
          usedMargin: 500,
          currency: "EUR",
          leverage: 100
        }
      );
    },
    async discoverXauUsd() {
      return (
        opts?.symbol ??
        resolveXauUsdFromCatalogue([
          {
            symbolId: 41,
            symbolName: "XAUUSD",
            description: "Gold vs US Dollar",
            baseAsset: "XAU",
            quoteAsset: "USD",
            digits: 2,
            pipPosition: 1,
            tickSize: 0.01,
            minVolume: 0.01,
            stepVolume: 0.01,
            maxVolume: 100,
            lotSize: 100,
            rawSlDistance: 30,
            distanceSetIn: "SYMBOL_DISTANCE_IN_POINTS",
            normalizedMinStopPriceDistance: 0.3,
            minStopDistance: 0.3
          }
        ])
      );
    },
    async findSymbolIdByName(args) {
      const wanted = String(args.symbolName ?? "")
        .trim()
        .toUpperCase()
        .replace(/[/\s._-]/g, "");
      if (wanted === "EURUSD") return eurusdSymbolId;
      if (wanted === "XAUUSD") return "41";
      return null;
    },
    async fetchQuote(args) {
      if (String(args.symbolId) === eurusdSymbolId) {
        return (
          opts?.eurusdQuote ?? {
            symbolId: eurusdSymbolId,
            symbolName: "EURUSD",
            // mid 1.15441 → 1/mid ≈ 0.86624336 (proven Demo conversion)
            bid: 1.1543,
            ask: 1.15452,
            spread: 0.00022,
            timestamp: new Date().toISOString(),
            marketStatus: "OPEN",
            stale: false,
            source: "LIVE"
          }
        );
      }
      return (
        opts?.quote ?? {
          symbolId: "41",
          symbolName: "XAUUSD",
          bid: 2350.1,
          ask: 2350.4,
          spread: 0.3,
          timestamp: new Date().toISOString(),
          marketStatus: "OPEN",
          stale: false,
          source: "LIVE"
        }
      );
    },
    async fetchTrendbars(args) {
      const count = Math.min(Math.max(args.count ?? 40, 1), 200);
      const stepSec =
        args.period === "M1"
          ? 60
          : args.period === "M5"
            ? 300
            : args.period === "M15"
              ? 900
              : args.period === "H1"
                ? 3600
                : 14400;
      const now = Math.floor(Date.now() / 1000);
      const base = 2350;
      const bars: TrendbarCandle[] = [];
      for (let i = count; i >= 1; i -= 1) {
        const t = now - i * stepSec;
        const drift = Math.sin(i / 5) * 1.2;
        const open = Number((base + drift).toFixed(2));
        const close = Number((open + Math.cos(i / 3) * 0.6).toFixed(2));
        const high = Number((Math.max(open, close) + 0.35).toFixed(2));
        const low = Number((Math.min(open, close) - 0.35).toFixed(2));
        bars.push({ time: t, open, high, low, close, volume: 100 + i });
      }
      return bars;
    },
    async placeDemoMarketOrder(args) {
      return {
        accepted: true,
        executionType: "ORDER_FILLED",
        orderId: "mock-order-1",
        positionId: "mock-pos-1",
        errorCode: null,
        clientOrderId: args.clientOrderId ?? "mock-client-order",
        fillPrice: 4365.8,
        stopLoss: null,
        takeProfit: null,
        filledVolumeLots: Number((args.volume / 100).toFixed(8)),
        ctidTraderAccountId: args.ctidTraderAccountId,
        raw: { mock: true, side: args.side, volume: args.volume }
      };
    },
    async reconcileDemoOpenPositions() {
      return [
        {
          positionId: "mock-pos-1",
          symbolId: "41",
          side: "BUY" as const,
          volumeLots: 0.01,
          volumeUnits: 1,
          entryPrice: 2350.1,
          stopLoss: 2340,
          takeProfit: 2370,
          unrealisedPnl: 1.2,
          usedMargin: 500,
          openTimestamp: new Date().toISOString()
        }
      ];
    },
    async amendDemoPositionSlTp(args) {
      return {
        accepted: true,
        executionType: "ORDER_ACCEPTED",
        positionId: args.positionId,
        errorCode: null,
        raw: { mock: true, stopLoss: args.stopLoss, takeProfit: args.takeProfit }
      };
    },
    async closeDemoPosition(args) {
      return {
        accepted: true,
        executionType: "ORDER_FILLED",
        positionId: args.positionId,
        errorCode: null,
        raw: { mock: true, volume: args.volume }
      };
    },
    async fetchDemoDealsByPositionId(args) {
      return {
        items: [
          {
            dealId: "mock-deal-1",
            orderId: "mock-order-close",
            positionId: args.positionId,
            closePrice: 2360,
            closedAt: new Date().toISOString(),
            grossPnl: 12.5,
            commission: 0.3,
            swap: 0,
            netPnl: 12.2,
            closedVolumeLots: 0.01
          }
        ],
        hasMore: false,
        fromTimestampMs: args.fromTimestampMs,
        toTimestampMs: args.toTimestampMs
      };
    },
    async fetchDemoDealList(args) {
      const page = await this.fetchDemoDealsByPositionId!({
        ...args,
        positionId: "mock-pos-1"
      });
      return page.items;
    },

    async fetchDemoDealEvidenceList(args) {
      const closed = await this.fetchDemoDealList!(args);
      return {
        items: closed.map((d) => ({
          dealId: d.dealId,
          orderId: d.orderId,
          positionId: d.positionId,
          executionPrice: d.closePrice,
          executedAt: d.closedAt,
          filledVolumeLots: d.closedVolumeLots,
          tradeSide: null,
          isClosing: true,
          close: d,
          label: null,
          comment: null,
          symbolId: null,
          dealStatus: null
        })),
        hasMore: false,
        fromTimestampMs: args.fromTimestampMs,
        toTimestampMs: args.toTimestampMs
      };
    },

    async fetchDemoOrderList(args) {
      return {
        items: [] as BrokerHistoricalOrder[],
        hasMore: false,
        fromTimestampMs: args.fromTimestampMs,
        toTimestampMs: args.toTimestampMs
      };
    },

    async fetchAuthoritativeDemoMarginSnapshot() {
      if (opts?.authoritativeMargin) return opts.authoritativeMargin;
      const snap = opts?.snapshot;
      const balance = snap?.balance ?? 10_000;
      const used = snap?.usedMargin ?? 0;
      const free = snap?.freeMargin ?? balance - used;
      const equity = snap?.equity ?? balance;
      return {
        ok: true,
        snapshot: {
          balance,
          unrealisedNetPnl: Number((equity - balance).toFixed(8)),
          equity,
          usedMargin: used,
          freeMargin: free,
          moneyDigits: 2,
          leverage: snap?.leverage ?? 100,
          openPositionCount: used > 0 ? 1 : 0,
          source: used > 0 ? "BROKER_POSITIONS" : "BROKER_FLAT",
          capturedAt: new Date().toISOString()
        }
      };
    },

    async fetchDemoExpectedMargin(args) {
      if (opts?.expectedMarginFail) {
        return { ok: false, notes: ["mock expected margin timeout"] };
      }
      const buy =
        opts?.expectedBuyMargin ?? opts?.expectedMarginDeposit ?? 100;
      const sell =
        opts?.expectedSellMargin ?? opts?.expectedMarginDeposit ?? 100;
      const expected = args.side === "BUY" ? buy : sell;
      return {
        ok: true,
        expectedMargin: expected,
        buyMargin: buy,
        sellMargin: sell,
        volume: args.volume,
        moneyDigits: 2
      };
    }
  };
}

export function createOpenApiClient(
  source: NodeJS.ProcessEnv = process.env
): CTraderOpenApiClient {
  if ((source.CTRADER_OPENAPI_TRANSPORT ?? "").toLowerCase() === "mock") {
    return createMockOpenApiClient();
  }
  return createLiveOpenApiClient();
}

export function toSafeBrokerAccount(
  discovered: DiscoveredAccount,
  snap?: AccountSnapshot | null
): BrokerAccount {
  return {
    brokerId: "pepperstone_ctrader",
    environment: discovered.isLive ? "LIVE" : "DEMO",
    accountIdMasked: discovered.accountIdMasked,
    accountKeyHash: discovered.accountKeyHash,
    currency: snap?.currency ?? discovered.depositCurrency ?? "—",
    balance: snap?.balance ?? null,
    equity: snap?.equity ?? null,
    freeMargin: snap?.freeMargin ?? null,
    usedMargin: snap?.usedMargin ?? null,
    leverage: snap?.leverage ?? discovered.leverage,
    accountType: discovered.isLive ? "LIVE" : "DEMO",
    positionMode: "UNKNOWN",
    brokerName: discovered.brokerNameTitle,
    brokerNameSource: discovered.brokerNameTitle ? "API" : "UNKNOWN",
    isDemo: !discovered.isLive
  };
}

export function isPepperstoneBrokerName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /pepperstone/i.test(name);
}
