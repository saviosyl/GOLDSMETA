import type { BrokerAction } from "../../models/trading";

export interface BrokerCapabilities {
  supportsXauusdCfd: boolean;
  entry: boolean;
  stopLoss: boolean;
  takeProfit: boolean;
  partialClose: boolean;
  moveBreakeven: boolean;
  earlyExit: boolean;
  cancelPending: boolean;
  automatedSubmission: boolean;
}

export interface BrokerOrderRequest {
  decisionId: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  quantity: number;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfits: Array<{ label: string; price: number; closeFraction: number }>;
  clientOrderKey: string;
}

export interface BrokerOrderResult {
  accepted: boolean;
  brokerOrderId?: string;
  status: "PENDING" | "FILLED" | "REJECTED" | "MANUAL_ONLY" | "UNSUPPORTED";
  fillPrice?: number | null;
  message: string;
  instructions?: string[];
}

/**
 * Existing trading-mode broker interface (manual / demo-sim).
 * Phase L IG demo uses ExecutionBrokerAdapter in executionBroker.ts.
 */
export interface BrokerAdapter {
  readonly id: string;
  readonly displayName: string;
  capabilities(): BrokerCapabilities;
  supports(action: BrokerAction): boolean;
  placeEntry(request: BrokerOrderRequest): Promise<BrokerOrderResult>;
  cancelPendingOrders(): Promise<{ cancelled: number; message: string }>;
  setStopLoss?(brokerOrderId: string, price: number): Promise<BrokerOrderResult>;
  setTakeProfit?(brokerOrderId: string, price: number, closeFraction: number): Promise<BrokerOrderResult>;
  partialClose?(brokerOrderId: string, fraction: number): Promise<BrokerOrderResult>;
  moveBreakeven?(brokerOrderId: string, price: number): Promise<BrokerOrderResult>;
  earlyExit?(brokerOrderId: string): Promise<BrokerOrderResult>;
}

export const EMPTY_CAPABILITIES: BrokerCapabilities = {
  supportsXauusdCfd: false,
  entry: false,
  stopLoss: false,
  takeProfit: false,
  partialClose: false,
  moveBreakeven: false,
  earlyExit: false,
  cancelPending: false,
  automatedSubmission: false
};
