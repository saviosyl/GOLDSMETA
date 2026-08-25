/**
 * Broker-neutral execution interface for future IG demo (Phase L).
 * LIVE execution is hard-disabled. No real network calls in Phase 3.
 * Kept separate from trading-mode BrokerAdapter to preserve existing adapters.
 */

export type ExecutionBrokerEnvironment = "DEMO" | "LIVE";

export interface ExecutionBrokerAccount {
  accountId: string;
  name: string;
  currency: string;
  environment: ExecutionBrokerEnvironment;
  balance: number;
}

export interface ExecutionBrokerMarket {
  symbol: string;
  epic: string;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  minDealSize: number;
}

export interface ExecutionBrokerQuote {
  symbol: string;
  bid: number;
  offer: number;
  asOf: string;
  stale: boolean;
}

export interface ExecutionBrokerPosition {
  positionId: string;
  symbol: string;
  direction: "BUY" | "SELL";
  size: number;
  openLevel: number;
  stopLevel: number | null;
  limitLevel: number | null;
}

export interface ExecutionOrderRequest {
  idempotencyKey: string;
  symbol: string;
  direction: "BUY" | "SELL";
  size: number;
  entryLevel?: number;
  stopLevel?: number;
  limitLevel?: number;
}

export interface ExecutionOrderResult {
  accepted: boolean;
  orderId: string | null;
  status: "REJECTED" | "ACCEPTED" | "FILLED" | "CANCELLED";
  reason: string | null;
}

export interface ExecutionBrokerAdapter {
  readonly name: string;
  getAccounts(): Promise<ExecutionBrokerAccount[]>;
  getMarket(symbol: string): Promise<ExecutionBrokerMarket>;
  getQuote(symbol: string): Promise<ExecutionBrokerQuote>;
  getOpenPositions(): Promise<ExecutionBrokerPosition[]>;
  previewOrder(request: ExecutionOrderRequest): Promise<ExecutionOrderResult>;
  placeDemoOrder(request: ExecutionOrderRequest): Promise<ExecutionOrderResult>;
  amendDemoOrder(orderId: string, patch: Partial<ExecutionOrderRequest>): Promise<ExecutionOrderResult>;
  closeDemoPosition(positionId: string): Promise<ExecutionOrderResult>;
  getOrderStatus(orderId: string): Promise<ExecutionOrderResult>;
}
