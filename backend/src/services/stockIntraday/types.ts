/**
 * Stocks Intraday AutoTrade domain types.
 */

import type {
  StockDecisionOutcome,
  StockExitReason,
  StockIntradayDisplayStatus,
  StockIntradayMode,
  StockIntradayRiskLimits,
  StockInstrumentKind,
  StockSignalAction,
  StockStrategyProfile,
  StockTradeIntentState,
  T212Environment
} from "./featureFlags";

export interface StockUniverseFilters {
  allowlist: string[];
  exclusionList: string[];
  exchanges: string[];
  currencies: string[];
  sectors: string[];
  minPrice: number | null;
  maxPrice: number | null;
  minAverageVolume: number;
  minRelativeVolume: number;
  maxSpreadBps: number;
  maxVolatilityPct: number;
  maxScannedCandidates: number;
}

export const DEFAULT_STOCK_UNIVERSE: StockUniverseFilters = {
  allowlist: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "SPY", "QQQ"],
  exclusionList: [],
  exchanges: ["NASDAQ", "NYSE"],
  currencies: ["USD", "EUR"],
  sectors: [],
  minPrice: 5,
  maxPrice: null,
  minAverageVolume: 1_000_000,
  minRelativeVolume: 1.2,
  maxSpreadBps: 15,
  maxVolatilityPct: 4,
  maxScannedCandidates: 40
};

export interface StockTradingViewSignal {
  alertId: string;
  strategyId: string;
  symbol: string;
  exchange: string | null;
  timeframe: string;
  action: StockSignalAction;
  price: number | null;
  timestamp: string;
  barTime: string | null;
  barClosed: boolean;
  volume: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  vwap: number | null;
  rsi: number | null;
  atr: number | null;
  relativeVolume: number | null;
  support: number | null;
  resistance: number | null;
  marketTrend: string | null;
  confidence: number | null;
  reasonCodes: string[];
  receivedAt: string;
}

export interface RankedIntradayOpportunity {
  symbol: string;
  instrumentKind: StockInstrumentKind;
  strategy: StockStrategyProfile;
  overallScore: number;
  entryQualityScore: number;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  vwapScore: number;
  relativeStrengthScore: number;
  liquidityScore: number;
  spreadScore: number;
  volatilityScore: number;
  riskScore: number;
  marketRegimeScore: number;
  tradingViewConfirmationScore: number;
  confidence: number;
  dataAgeMs: number;
  expectedRewardRisk: number;
  supportReasons: string[];
  blockReasons: string[];
  qualifies: boolean;
  estimatedEntry: number;
  stop: number;
  takeProfit: number;
  trigger: string;
  timeframe: string;
  higherTimeframeConfirmation: string | null;
  entryBasis: string;
  stopBasis: string;
  profitTargetBasis: string;
  invalidationReason: string;
}

export interface StockTradeIntent {
  intentId: string;
  userId: string;
  symbol: string;
  environment: T212Environment;
  strategy: StockStrategyProfile;
  signalAlertId: string | null;
  barTimestamp: string | null;
  side: "BUY" | "SELL";
  state: StockTradeIntentState;
  quantity: number;
  estimatedEntry: number;
  stop: number;
  takeProfit: number;
  reservedCash: number;
  brokerOrderId: string | null;
  filledQuantity: number;
  averageFillPrice: number | null;
  outcome: StockDecisionOutcome | null;
  blockReason: string | null;
  exitReason: StockExitReason | null;
  goldMetaManaged: true;
  createdAt: string;
  updatedAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export interface StockManagedPosition {
  positionId: string;
  userId: string;
  intentId: string;
  symbol: string;
  environment: T212Environment;
  quantity: number;
  entryPrice: number;
  stop: number | null;
  takeProfit: number | null;
  currentExitRule: string;
  unrealisedPnl: number | null;
  openedAt: string;
  goldMetaManaged: true;
}

export interface StockIntradayRiskState {
  userId: string;
  mode: StockIntradayMode;
  locked: boolean;
  lockReason: string | null;
  paused: boolean;
  emergencyStopActive: boolean;
  killSwitchActive: boolean;
  dailyRealisedPnl: number;
  dailyUnrealisedPnl: number;
  tradesUsedToday: number;
  losingTradesToday: number;
  dailyAllocationUsed: number;
  dayKey: string;
  updatedAt: string;
}

export interface StockIntradayConnectionStatus {
  connected: boolean;
  environment: T212Environment | null;
  environmentLabel: string;
  cash: number | null;
  availableToTrade: number | null;
  totalValue: number | null;
  lastHeartbeatAt: string | null;
  connectionState: "Connected" | "Disconnected" | "Error";
}

export interface StockIntradayStatusPayload {
  displayStatus: StockIntradayDisplayStatus;
  mode: StockIntradayMode;
  locked: boolean;
  lockReason: string | null;
  paused: boolean;
  emergencyStopActive: boolean;
  killSwitchActive: boolean;
  paperOrderSubmissionEnabled: boolean;
  liveExecutionFeatureEnabled: boolean;
  marketDataProviderReady: boolean;
  engineRunning: boolean;
  marketSession: "OPEN" | "CLOSED" | "PRE" | "POST" | "UNKNOWN";
  connection: StockIntradayConnectionStatus;
  limits: StockIntradayRiskLimits;
  universe: StockUniverseFilters;
  budget: {
    dailyCapitalAllocation: number;
    dailyCapitalRemaining: number;
    dailyRealisedPnl: number;
    dailyUnrealisedPnl: number;
    dailyLossRemaining: number;
    tradesUsed: number;
    tradesMax: number;
    cash: number | null;
    currency: string;
  };
  rankedOpportunities: RankedIntradayOpportunity[];
  positions: StockManagedPosition[];
  pendingOrders: Array<{
    orderId: string;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    type: string;
    status: string;
  }>;
  rejectedRecently: Array<{ symbol: string; reason: string; at: string }>;
  shadowTrades: Array<{
    id: string;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    at: string;
    note: string;
  }>;
  activity: Array<{
    id: string;
    at: string;
    message: string;
    level: "info" | "warn" | "error" | "success";
  }>;
  lastTradingViewAlert: StockTradingViewSignal | null;
  lastMarketDataAt: string | null;
  strategyVersion: string;
  safetyStatement: string;
}

export const SAFETY_STATEMENT =
  "GoldMeta trades only qualifying opportunities. No trade will be placed when the safety requirements are not met.";
