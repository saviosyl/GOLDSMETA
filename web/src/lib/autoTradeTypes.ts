/** Client-side AutoTrade types mirroring backend status payload (no secrets). */

export type AutoTradeMode = "OFF" | "SHADOW" | "IG_DEMO_AUTO" | "IG_LIVE_AUTO";
export type AutoTradeDisplayStatus = "OFF" | "SHADOW" | "DEMO" | "LIVE" | "LOCKED";

export interface AutoTradeStatus {
  displayStatus: AutoTradeDisplayStatus;
  mode: AutoTradeMode;
  locked: boolean;
  lockReason: string | null;
  emergencyStopActive: boolean;
  liveExecutionFeatureEnabled: boolean;
  connection: {
    connected: boolean;
    environment: "DEMO" | "LIVE" | null;
    accountIdMasked: string | null;
    accountName: string | null;
    currency: string | null;
    balance: number | null;
    available: number | null;
    marginUsed: number | null;
    marketStatus: string | null;
    marketEpic: string | null;
    marketName: string | null;
    bid: number | null;
    ask: number | null;
    spread: number | null;
    minDealSize: number | null;
    sizeIncrement: number | null;
    valuePerPoint: number | null;
    lastHeartbeatAt: string | null;
  };
  limits: {
    maxLossPerTrade: number;
    maxMarginPerPosition: number;
    maxDailyLoss: number;
    maxWeeklyLoss: number;
    maxOpenPositions: number;
    maxTradesPerDay: number;
    maxConsecutiveLosses: number;
    cooldownAfterLossMinutes: number;
    minGoldMetaScore: number;
    minRiskReward: number;
    maxSpread: number | null;
    stopProtection: string;
    allowedSessions: string[];
    currency: string;
  };
  budget: {
    dailyLossLimit: number;
    weeklyLossLimit: number;
    dailyRealisedPnl: number;
    dailyUnrealisedPnl: number;
    weeklyRealisedPnl: number;
    weeklyUnrealisedPnl: number;
    remainingDailyLossCapacity: number;
    remainingWeeklyLossCapacity: number;
    marginUsed: number;
    tradesUsed: number;
    tradesMax: number;
    currency: string;
  };
  positions: Array<{
    positionId: string;
    environment: "DEMO" | "LIVE";
    direction: "BUY" | "SELL";
    marketName: string;
    epic: string;
    entry: number;
    size: number;
    stop: number | null;
    takeProfit: number | null;
    monetaryRisk: number | null;
    currentBid: number | null;
    currentAsk: number | null;
    unrealisedPnl: number | null;
    score: number | null;
    decisionId: string | null;
    dealId: string | null;
    protectionStatus: string;
    openedAt: string;
  }>;
  activity: Array<{
    id: string;
    at: string;
    message: string;
    level: "info" | "warn" | "error" | "success";
  }>;
  strategyVersion: string;
}

export const FIRST_PILOT_LIMITS_CLIENT = {
  maxLossPerTrade: 5,
  maxMarginPerPosition: 100,
  maxDailyLoss: 10,
  maxWeeklyLoss: 30,
  maxOpenPositions: 1,
  maxTradesPerDay: 1,
  maxConsecutiveLosses: 2,
  cooldownAfterLossMinutes: 60,
  minGoldMetaScore: 85,
  minRiskReward: 2,
  maxSpread: null as number | null,
  stopProtection: "GUARANTEED_REQUIRED",
  allowedSessions: ["LONDON", "NEW_YORK", "LONDON_NY_OVERLAP"],
  currency: "EUR"
};

export function buildReviewAutoTradeStatus(
  overrides: Partial<AutoTradeStatus> = {}
): AutoTradeStatus {
  return {
    displayStatus: "OFF",
    mode: "OFF",
    locked: false,
    lockReason: null,
    emergencyStopActive: false,
    liveExecutionFeatureEnabled: false,
    connection: {
      connected: false,
      environment: null,
      accountIdMasked: null,
      accountName: null,
      currency: "EUR",
      balance: null,
      available: null,
      marginUsed: null,
      marketStatus: null,
      marketEpic: null,
      marketName: "Spot Gold",
      bid: null,
      ask: null,
      spread: null,
      minDealSize: 0.1,
      sizeIncrement: 0.1,
      valuePerPoint: 1,
      lastHeartbeatAt: null
    },
    limits: { ...FIRST_PILOT_LIMITS_CLIENT },
    budget: {
      dailyLossLimit: 10,
      weeklyLossLimit: 30,
      dailyRealisedPnl: 0,
      dailyUnrealisedPnl: 0,
      weeklyRealisedPnl: 0,
      weeklyUnrealisedPnl: 0,
      remainingDailyLossCapacity: 10,
      remainingWeeklyLossCapacity: 30,
      marginUsed: 0,
      tradesUsed: 0,
      tradesMax: 1,
      currency: "EUR"
    },
    positions: [],
    activity: [
      {
        id: "review-1",
        at: new Date().toISOString(),
        message: "AutoTrade Control Centre ready. Mode OFF.",
        level: "info"
      }
    ],
    strategyVersion: "v6.0.0-pilot",
    ...overrides
  };
}
