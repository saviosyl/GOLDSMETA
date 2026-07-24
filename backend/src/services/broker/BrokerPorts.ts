/**
 * Broker adapter service ports — broker-neutral contracts.
 */

import type {
  BrokerAccount,
  BrokerDeal,
  BrokerEnvironment,
  BrokerHealthStatus,
  BrokerOrder,
  BrokerPosition,
  BrokerQuote,
  BrokerSymbol,
  ReconciliationResult,
  TradeIntent,
  TradePreview
} from "./domain";

export interface BrokerAccountService {
  listAuthorisedAccounts(): Promise<BrokerAccount[]>;
  getAccount(accountKeyHash: string): Promise<BrokerAccount | null>;
  confirmBrokerIdentity(accountKeyHash: string, brokerName: string): Promise<void>;
}

export interface BrokerMarketDataService {
  resolveXauUsdSymbol(accountKeyHash: string): Promise<BrokerSymbol | null>;
  getSymbol(accountKeyHash: string, symbolId: string): Promise<BrokerSymbol | null>;
  getQuote(accountKeyHash: string, symbolId: string): Promise<BrokerQuote>;
  getMarketStatus(accountKeyHash: string, symbolId: string): Promise<"OPEN" | "CLOSED" | "UNKNOWN">;
}

export interface BrokerOrderService {
  /** Always gated — must throw or no-op when submission disabled. */
  placeMarketOrder(_args: unknown): Promise<never>;
  closePosition(_args: unknown): Promise<never>;
  cancelPendingOrder(_args: unknown): Promise<never>;
  modifyProtection(_args: unknown): Promise<never>;
}

export interface BrokerPositionService {
  listOpenPositions(accountKeyHash: string): Promise<BrokerPosition[]>;
  listPendingOrders(accountKeyHash: string): Promise<BrokerOrder[]>;
  listHistoricalOrders(accountKeyHash: string): Promise<BrokerOrder[]>;
  listHistoricalDeals(accountKeyHash: string): Promise<BrokerDeal[]>;
}

export interface BrokerRiskService {
  buildPreview(args: {
    accountKeyHash: string;
    decisionId: string;
    action: string;
    confidence: number | null;
    stopLoss: number | null;
    takeProfits: number[];
    generatedAt: string | null;
    candleConfirmed: boolean;
  }): Promise<TradePreview>;
}

export interface BrokerReconciliationService {
  reconcileIntent(intent: TradeIntent): Promise<ReconciliationResult>;
  recoverUnresolved(): Promise<TradeIntent[]>;
}

export interface BrokerAdapter {
  readonly brokerId: string;
  readonly environment: BrokerEnvironment;
  health(): Promise<BrokerHealthStatus>;
  accounts: BrokerAccountService;
  marketData: BrokerMarketDataService;
  orders: BrokerOrderService;
  positions: BrokerPositionService;
  risk: BrokerRiskService;
  reconciliation: BrokerReconciliationService;
  disconnect(): Promise<void>;
}
