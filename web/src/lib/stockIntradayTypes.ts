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
  marketData?: {
    providerId: string;
    feedId: string | null;
    dataLabel: string | null;
    ready: boolean;
  };
  t212ExecutionPrice?: {
    available: boolean;
    label: string;
  };
  watchlist?: {
    symbols: string[];
    rejected: Array<{ symbol: string; reasons: string[] }>;
    validatedAt: string | null;
  };
  shadowPerformance?: {
    disclaimer: string;
    marketSessionsObserved: number;
    opportunitiesEvaluated: number;
    tradesOpened: number;
    tradesClosed: number;
    winRate: number | null;
    lossRate: number | null;
    grossPnl: number;
    netPnl: number;
    averageWin: number | null;
    averageLoss: number | null;
    profitFactor: number | null;
    maximumDrawdown: number;
    maximumConsecutiveLosses: number;
    averageHoldingTimeMinutes: number | null;
    stopLossExits: number;
    takeProfitExits: number;
    trailingStopExits: number;
    strategyInvalidationExits: number;
    endOfDayExits: number;
    blockedOpportunities: number;
    waitOpportunities: number;
    dataOutages: number;
    staleDataBlocks: number;
    providerDivergenceBlocks: number;
  };
  readinessGates?: Array<{ id: string; ok: boolean; detail: string }>;
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
    marketData: {
      providerId: "unconfigured",
      feedId: null,
      dataLabel: "ALPACA IEX — SHADOW VALIDATION ONLY",
      ready: false
    },
    t212ExecutionPrice: {
      available: false,
      label: "T212 EXECUTION PRICE — NOT AVAILABLE FROM CURRENT PUBLIC API"
    },
    watchlist: {
      symbols: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "SPY", "QQQ"],
      rejected: [],
      validatedAt: null
    },
    shadowPerformance: {
      disclaimer:
        "SHADOW results are hypothetical validation only and do not guarantee future performance.",
      marketSessionsObserved: 0,
      opportunitiesEvaluated: 0,
      tradesOpened: 0,
      tradesClosed: 0,
      winRate: null,
      lossRate: null,
      grossPnl: 0,
      netPnl: 0,
      averageWin: null,
      averageLoss: null,
      profitFactor: null,
      maximumDrawdown: 0,
      maximumConsecutiveLosses: 0,
      averageHoldingTimeMinutes: null,
      stopLossExits: 0,
      takeProfitExits: 0,
      trailingStopExits: 0,
      strategyInvalidationExits: 0,
      endOfDayExits: 0,
      blockedOpportunities: 0,
      waitOpportunities: 0,
      dataOutages: 0,
      staleDataBlocks: 0,
      providerDivergenceBlocks: 0
    },
    readinessGates: [],
    strategyVersion: "v6.0.0-stock-intraday-scaffold",
    safetyStatement:
      "GoldMeta trades only qualifying opportunities. No trade will be placed when the safety requirements are not met.",
    ...overrides
  };
}
