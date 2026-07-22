/** Client types for Stocks Intraday AutoTrade (no secrets). */

export type StockIntradayMode = "OFF" | "SHADOW" | "T212_PAPER_AUTO" | "T212_LIVE_AUTO";

export interface StockIntradayStatus {
  displayStatus: string;
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
  marketSession: string;
  connection: {
    connected: boolean;
    environment: "PAPER" | "LIVE" | null;
    environmentLabel: string;
    cash: number | null;
    availableToTrade: number | null;
    totalValue: number | null;
    lastHeartbeatAt: string | null;
    connectionState: string;
  };
  limits: {
    dailyCapitalAllocation: number;
    maxCapitalPerTrade: number;
    maxSimultaneousPositions: number;
    minConfidence: number;
    minCashReserve: number;
    maxDailyLoss: number;
    maxLossPerTrade: number;
    maxTradesPerDay: number;
    currency: string;
  };
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
  rankedOpportunities: Array<{
    symbol: string;
    overallScore: number;
    confidence: number;
    qualifies: boolean;
    strategy: string;
    blockReasons: string[];
    supportReasons: string[];
    estimatedEntry: number;
    stop: number;
    takeProfit: number;
  }>;
  positions: Array<{
    positionId: string;
    symbol: string;
    quantity: number;
    entryPrice: number;
    stop: number | null;
    takeProfit: number | null;
    currentExitRule: string;
    unrealisedPnl: number | null;
  }>;
  pendingOrders: Array<{
    orderId: string;
    symbol: string;
    side: string;
    quantity: number;
    type: string;
    status: string;
  }>;
  rejectedRecently: Array<{ symbol: string; reason: string; at: string }>;
  shadowTrades: Array<{
    id: string;
    symbol: string;
    side: string;
    quantity: number;
    at: string;
    note: string;
  }>;
  activity: Array<{ id: string; at: string; message: string; level: string }>;
  lastTradingViewAlert: { alertId: string; symbol: string; action: string; timestamp: string } | null;
  lastMarketDataAt: string | null;
  strategyVersion: string;
  safetyStatement: string;
}

export function buildReviewStockIntradayStatus(
  overrides: Partial<StockIntradayStatus> = {}
): StockIntradayStatus {
  return {
    displayStatus: "OFF",
    mode: "OFF",
    locked: false,
    lockReason: null,
    paused: false,
    emergencyStopActive: false,
    killSwitchActive: false,
    paperOrderSubmissionEnabled: false,
    liveExecutionFeatureEnabled: false,
    marketDataProviderReady: false,
    engineRunning: false,
    marketSession: "UNKNOWN",
    connection: {
      connected: false,
      environment: "PAPER",
      environmentLabel: "T212 PAPER — ORDERS DISABLED",
      cash: null,
      availableToTrade: null,
      totalValue: null,
      lastHeartbeatAt: null,
      connectionState: "Disconnected"
    },
    limits: {
      dailyCapitalAllocation: 100,
      maxCapitalPerTrade: 40,
      maxSimultaneousPositions: 3,
      minConfidence: 80,
      minCashReserve: 500,
      maxDailyLoss: 25,
      maxLossPerTrade: 15,
      maxTradesPerDay: 5,
      currency: "EUR"
    },
    budget: {
      dailyCapitalAllocation: 100,
      dailyCapitalRemaining: 100,
      dailyRealisedPnl: 0,
      dailyUnrealisedPnl: 0,
      dailyLossRemaining: 25,
      tradesUsed: 0,
      tradesMax: 5,
      cash: null,
      currency: "EUR"
    },
    rankedOpportunities: [],
    positions: [],
    pendingOrders: [],
    rejectedRecently: [],
    shadowTrades: [],
    activity: [
      {
        id: "s1",
        at: new Date().toISOString(),
        message: "Stocks Intraday AutoTrade ready. Mode OFF. Paper/Live order flags false.",
        level: "info"
      }
    ],
    lastTradingViewAlert: null,
    lastMarketDataAt: null,
    strategyVersion: "v6.0.0-stock-intraday-scaffold",
    safetyStatement:
      "GoldMeta trades only qualifying opportunities. No trade will be placed when the safety requirements are not met.",
    ...overrides
  };
}
