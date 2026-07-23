/**
 * Broker-neutral domain types for GoldMeta.
 * Broker-specific API objects must not leak into the decision engine or UI.
 */

export type BrokerId =
  | "manual"
  | "trading212_invest"
  | "pepperstone_ctrader"
  | "ig"
  | "oanda"
  | "future";

export type BrokerEnvironment = "DEMO" | "LIVE" | "PRACTICE" | "SIMULATION";

export type BrokerConnectionState =
  | "DISCONNECTED"
  | "SETUP_REQUIRED"
  | "AUTH_SETUP_REQUIRED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEMO_READY"
  | "AUTO_TRADE_LOCKED"
  | "LIVE_LOCKED"
  | "ERROR"
  | "DEGRADED";

export type AutomationMode =
  | "OFF"
  | "MANUAL"
  | "CONFIRM"
  | "DEMO_AUTO_LOCKED"
  | "DEMO_AUTO"
  | "LIVE_LOCKED";

export type TradeAction =
  | "BUY"
  | "SELL"
  | "EXIT_LONG"
  | "EXIT_SHORT"
  | "WAIT";

export type OppositeSignalPolicy =
  | "CLOSE_ONLY"
  | "CLOSE_AND_REVERSE"
  | "IGNORE_UNTIL_FLAT";

export type PreviewState =
  | "BLOCKED"
  | "READY_FOR_CONFIRMATION"
  | "PREVIEW_APPROVED"
  | "EXPIRED"
  | "CANCELLED";

export type TradeIntentState =
  | "PREPARED"
  | "READY_FOR_CONFIRMATION"
  | "APPROVED"
  | "SUBMITTING"
  | "ACCEPTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "CANCELLED"
  | "UNKNOWN"
  | "CLOSING"
  | "CLOSED";

export interface BrokerAccount {
  brokerId: BrokerId;
  environment: BrokerEnvironment;
  /** Masked for display — never log full id */
  accountIdMasked: string;
  /** Server-only opaque account key (hashed/redacted in responses) */
  accountKeyHash: string;
  currency: string;
  balance: number | null;
  equity: number | null;
  freeMargin: number | null;
  usedMargin: number | null;
  leverage: number | null;
  accountType: string | null;
  positionMode: "HEDGED" | "NETTED" | "UNKNOWN";
  brokerName: string | null;
  brokerNameSource: "API" | "USER_CONFIRMED" | "UNKNOWN";
  isDemo: boolean;
}

export interface BrokerSymbol {
  brokerId: BrokerId;
  environment: BrokerEnvironment;
  symbolId: string;
  symbolName: string;
  displayName: string;
  baseAsset: string | null;
  quoteAsset: string | null;
  digits: number | null;
  pipPosition: number | null;
  tickSize: number | null;
  minVolume: number | null;
  volumeStep: number | null;
  maxVolume: number | null;
  lotSize: number | null;
  commissionType: string | null;
  commissionAmount: number | null;
  minCommission: number | null;
  swapLong: number | null;
  swapShort: number | null;
  minStopDistance: number | null;
  guaranteedStopAvailable: boolean | null;
  tradingScheduleId: string | null;
  metadataComplete: boolean;
  missingFields: string[];
}

export interface BrokerQuote {
  symbolId: string;
  symbolName: string;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  timestamp: string | null;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  stale: boolean;
  source: "LIVE" | "CACHED" | "FIXTURE" | "UNAVAILABLE";
}

export interface BrokerPosition {
  positionId: string;
  symbolId: string;
  symbolName: string;
  direction: "LONG" | "SHORT";
  volume: number;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  unrealisedPnl: number | null;
  openedAt: string | null;
}

export interface BrokerOrder {
  orderId: string;
  symbolId: string;
  symbolName: string;
  side: "BUY" | "SELL";
  volume: number;
  status: string;
  orderType: string;
  createdAt: string | null;
}

export interface BrokerDeal {
  dealId: string;
  orderId: string | null;
  symbolId: string;
  side: "BUY" | "SELL";
  volume: number;
  price: number | null;
  timestamp: string | null;
}

export interface BrokerExecutionEvent {
  eventId: string;
  intentKey: string | null;
  kind: string;
  timestamp: string;
  payloadRedacted: Record<string, unknown>;
}

export interface BrokerRiskLimits {
  maxRiskPerTrade: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  minConfidence: number;
  maxSignalAgeSeconds: number;
  maxSpread: number | null;
  maxSlippage: number | null;
  minRiskReward: number | null;
  oppositeSignalPolicy: OppositeSignalPolicy;
  confirmedCandleRequired: boolean;
  stopLossRequired: boolean;
  maxOpenPositions: number;
}

export interface TradeIntent {
  intentKey: string;
  intentId: string;
  ownerUidHash: string;
  brokerId: BrokerId;
  environment: BrokerEnvironment;
  accountKeyHash: string;
  decisionId: string;
  symbolId: string;
  action: TradeAction;
  state: TradeIntentState;
  requestFingerprint: string;
  createdAt: string;
  updatedAt: string;
  brokerOrderId: string | null;
  notes: string[];
}

export interface TradePreview {
  previewId: string;
  state: PreviewState;
  action: TradeAction;
  direction: "LONG" | "SHORT" | "FLAT" | "NONE";
  symbolName: string;
  decisionId: string;
  decisionTimestamp: string | null;
  decisionAgeSeconds: number | null;
  confidence: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  intendedEntry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  stopDistance: number | null;
  riskAmount: number | null;
  proposedVolume: number | null;
  estimatedMargin: number | null;
  estimatedCommission: number | null;
  estimatedMaxLoss: number | null;
  estimatedRiskReward: number | null;
  equity: number | null;
  freeMargin: number | null;
  existingPosition: BrokerPosition | null;
  pendingOrdersCount: number;
  marketStatus: string;
  passedGates: string[];
  failedGates: string[];
  demonstration: boolean;
  orderSubmissionEnabled: false;
  label: string;
}

export interface ReconciliationResult {
  intentId: string;
  previousState: TradeIntentState;
  nextState: TradeIntentState;
  source: string;
  notes: string[];
  blockedFurtherOrders: boolean;
}

export interface BrokerHealthStatus {
  brokerId: BrokerId;
  environment: BrokerEnvironment | null;
  connectionState: BrokerConnectionState;
  automationMode: AutomationMode;
  oauthHealthy: boolean | null;
  authIntegrityHealthy: boolean | null;
  executionEnabled: false;
  liveEnabled: false;
  lastErrorCode: string | null;
  notes: string[];
}
