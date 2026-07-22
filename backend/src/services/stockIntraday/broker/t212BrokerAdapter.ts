/**
 * Trading 212 Public API broker port for Stocks Intraday AutoTrade.
 * Paper: https://demo.trading212.com/api/v0
 * Live:  https://live.trading212.com/api/v0
 *
 * Order methods exist behind feature flags — never submit in this delivery.
 */

import type { StockInstrumentKind, T212Environment } from "../featureFlags";

export interface T212AccountSummary {
  environment: T212Environment;
  cash: number;
  availableToTrade: number;
  totalValue: number;
  currency: string;
}

export interface T212Instrument {
  ticker: string;
  name: string;
  type: StockInstrumentKind | "OTHER";
  currency: string;
  exchange: string;
  minTradeQuantity: number;
  maxOpenQuantity: number | null;
  extendedHoursAllowed: boolean;
  tradable: boolean;
  suspended: boolean;
  /** Latest readable price when the broker exposes it (Paper validation). */
  currentPrice?: number | null;
}

export interface T212Position {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number | null;
  pnl: number | null;
  /** GoldMeta never manages positions lacking this tag in our store. */
  goldMetaManagedHint?: boolean;
}

export interface T212Order {
  id: string;
  ticker: string;
  quantity: number;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  limitPrice: number | null;
  stopPrice: number | null;
  status: "PENDING" | "QUEUED" | "FILLED" | "PARTIAL" | "CANCELLED" | "REJECTED" | "UNKNOWN";
  filledQuantity: number;
  averageFillPrice: number | null;
  createdAt: string;
}

export interface T212OrderRequest {
  ticker: string;
  /** Positive = buy, negative = sell (validated at adapter boundary). */
  quantity: number;
  type: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: "DAY" | "GTC";
}

export interface T212OrderResult {
  accepted: boolean;
  orderId: string | null;
  status: T212Order["status"];
  reason: string | null;
  rawRedacted: Record<string, unknown>;
}

export interface T212BrokerAdapter {
  readonly name: string;
  readonly environment: T212Environment;

  connect(credentialsRef: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  heartbeat(): Promise<string>;

  getAccountSummary(): Promise<T212AccountSummary>;
  listInstruments(query?: string): Promise<T212Instrument[]>;
  listExchanges(): Promise<string[]>;
  getPositions(): Promise<T212Position[]>;
  getPendingOrders(): Promise<T212Order[]>;
  getOrder(orderId: string): Promise<T212Order | null>;
  listHistoricalOrders(limit?: number): Promise<T212Order[]>;

  placeMarketOrder(request: T212OrderRequest): Promise<T212OrderResult>;
  placeLimitOrder(request: T212OrderRequest): Promise<T212OrderResult>;
  placeStopOrder(request: T212OrderRequest): Promise<T212OrderResult>;
  placeStopLimitOrder(request: T212OrderRequest): Promise<T212OrderResult>;
  cancelOrder(orderId: string): Promise<T212OrderResult>;
}

export const T212_ENDPOINTS = {
  PAPER: "https://demo.trading212.com/api/v0",
  LIVE: "https://live.trading212.com/api/v0"
} as const;

export function assertQuantitySign(quantity: number, side: "BUY" | "SELL"): void {
  if (side === "BUY" && quantity <= 0) {
    throw new Error("T212_QUANTITY_SIGN_INVALID");
  }
  if (side === "SELL" && quantity >= 0) {
    throw new Error("T212_QUANTITY_SIGN_INVALID");
  }
}

export function signedQuantity(side: "BUY" | "SELL", absoluteQuantity: number): number {
  if (!(absoluteQuantity > 0)) throw new Error("T212_QUANTITY_INVALID");
  return side === "BUY" ? absoluteQuantity : -absoluteQuantity;
}
