/**
 * Per-user daily AutoTrade safety runtime (Demo / Live separate).
 * Path: users/{uid}/autotradeDailySafety/{demo|live}
 */

export type DailySafetyDocument = {
  uid: string;
  environment: "demo" | "live";
  /** YYYY-MM-DD in Europe/Dublin trading day */
  tradingDay: string;
  tradesUsed: number;
  realisedPnl: number;
  peakDailyPnl: number;
  consecutiveLosses: number;
  openPositions: number;
  cooldownUntil: string | null;
  pausedReason: string | null;
  pausedAt: string | null;
  dailyLossLocked: boolean;
  dailyProfitTargetHit: boolean;
  profitProtectionPaused: boolean;
  lastTradeClosedAt: string | null;
  lastTradeWasLoss: boolean | null;
  updatedAt: string;
  /** Idempotency keys for counted trades (correlation / journal ids). */
  countedTradeIds: string[];
};

export type DailySafetyPublicView = {
  environment: "demo" | "live";
  tradingDay: string;
  tradesToday: number;
  tradesMax: number;
  tradesLimitReached: boolean;
  dailyPnl: number;
  dailyLossLimit: number;
  dailyLossUsed: number;
  dailyLossRemaining: number;
  dailyLossLimitReached: boolean;
  consecutiveLosses: number;
  consecutiveLossMax: number;
  consecutiveLossPaused: boolean;
  openPositions: number;
  openPositionsMax: number;
  cooldownActive: boolean;
  cooldownRemainingMs: number | null;
  cooldownLabel: string;
  emergencyStopActive: boolean;
  emergencyStopLabel: string;
  autoTradeLabel: string;
  dailyProfitTarget: number | null;
  dailyProfitTargetEnabled: boolean;
  dailyProfitTargetReached: boolean;
  profitProtectionEnabled: boolean;
  profitProtectionPaused: boolean;
  peakDailyPnl: number;
  protectedMinimumPnl: number | null;
  entriesBlocked: boolean;
  entriesBlockedReason: string | null;
  currency: string;
};
