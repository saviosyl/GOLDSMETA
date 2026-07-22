/**
 * GoldMeta Stocks Intraday AutoTrade — feature flags and shared constants.
 * Completely separate from IG Gold CFD AutoTrade.
 *
 * BOTH execution flags remain false for this delivery.
 */

/** Paper order submission — disabled until Savio enables after review. */
export const T212_PAPER_ORDER_SUBMISSION_ENABLED = false;

/** Live real-money execution — hard-blocked. */
export const T212_LIVE_EXECUTION_FEATURE_FLAG = false;

export const STOCK_INTRADAY_STRATEGY_VERSION = "v6.0.0-stock-intraday-scaffold";

export const LIVE_STOCK_CONFIRMATION_PHRASE = "ENABLE LIVE STOCK AUTOTRADE";

export type StockIntradayMode =
  | "OFF"
  | "SHADOW"
  | "T212_PAPER_AUTO"
  | "T212_LIVE_AUTO";

export type StockIntradayDisplayStatus =
  | "OFF"
  | "SHADOW"
  | "PAPER"
  | "LIVE"
  | "LOCKED"
  | "PAUSED";

export type T212Environment = "PAPER" | "LIVE";

export type StockInstrumentKind = "STOCK" | "ETF";

export type StockSignalAction =
  | "ENTRY_LONG"
  | "EXIT_LONG"
  | "REDUCE"
  | "MOVE_STOP"
  | "CANCEL"
  | "WAIT";

export type StockStrategyProfile =
  | "MOMENTUM_BREAKOUT"
  | "PULLBACK_IN_TREND"
  | "VWAP_RECLAIM"
  | "OPENING_RANGE_BREAKOUT"
  | "RELATIVE_VOLUME_BREAKOUT";

/**
 * Explicit trade-intent / order state machine.
 * Timeout must never blindly resubmit (T212 market orders are not idempotent).
 */
export type StockTradeIntentState =
  | "CANDIDATE"
  | "VALIDATING"
  | "REJECTED"
  | "APPROVED"
  | "ENTRY_RESERVED"
  | "ENTRY_SUBMITTING"
  | "ENTRY_UNKNOWN"
  | "ENTRY_PENDING"
  | "PARTIALLY_FILLED"
  | "OPEN"
  | "EXIT_REQUESTED"
  | "EXIT_SUBMITTING"
  | "EXIT_UNKNOWN"
  | "EXIT_PENDING"
  | "PARTIALLY_CLOSED"
  | "CLOSED"
  | "CANCELLED"
  | "LOCKED"
  | "RECONCILIATION_REQUIRED";

export type StockDecisionOutcome =
  | "BUY"
  | "WAIT"
  | "BLOCKED";

export type StockExitReason =
  | "HARD_STOP"
  | "TAKE_PROFIT"
  | "TRAILING_STOP"
  | "BREAK_EVEN"
  | "TV_EXIT_LONG"
  | "INDICATOR_REVERSAL"
  | "VWAP_LOSS"
  | "TREND_INVALIDATION"
  | "MAX_HOLDING_TIME"
  | "RISK_EMERGENCY"
  | "DAILY_LOSS_EMERGENCY"
  | "MARKET_DATA_FAILURE"
  | "END_OF_DAY"
  | "KILL_SWITCH"
  | "MANUAL_STOP";

export interface StockIntradayRiskLimits {
  dailyCapitalAllocation: number;
  maxCapitalPerTrade: number;
  maxSimultaneousPositions: number;
  minConfidence: number;
  minCashReserve: number;
  maxDailyLoss: number;
  maxLossPerTrade: number;
  maxTradesPerDay: number;
  maxLosingTradesPerDay: number;
  maxPortfolioExposure: number;
  maxExposurePerSymbol: number;
  maxSectorConcentration: number;
  minLiquidityAdv: number;
  maxSpreadBps: number;
  maxVolatilityPct: number;
  maxSlippageBps: number;
  perSymbolCooldownMinutes: number;
  cooldownAfterLossMinutes: number;
  minRewardRisk: number;
  maxPositionDurationMinutes: number;
  /** Minutes before session close when new entries stop. */
  entryCutoffBeforeCloseMinutes: number;
  /** Minutes before session close when intraday positions must be closed. */
  forceCloseBeforeCloseMinutes: number;
  currency: "EUR";
  extendedHoursEnabled: boolean;
}

/** Editable first-delivery defaults (not fixed constants in runtime). */
export const DEFAULT_STOCK_INTRADAY_LIMITS: StockIntradayRiskLimits = {
  dailyCapitalAllocation: 100,
  maxCapitalPerTrade: 40,
  maxSimultaneousPositions: 3,
  minConfidence: 80,
  minCashReserve: 500,
  maxDailyLoss: 25,
  maxLossPerTrade: 15,
  maxTradesPerDay: 5,
  maxLosingTradesPerDay: 3,
  maxPortfolioExposure: 120,
  maxExposurePerSymbol: 40,
  maxSectorConcentration: 80,
  minLiquidityAdv: 500_000,
  maxSpreadBps: 15,
  maxVolatilityPct: 4,
  maxSlippageBps: 20,
  perSymbolCooldownMinutes: 30,
  cooldownAfterLossMinutes: 45,
  minRewardRisk: 1.5,
  maxPositionDurationMinutes: 240,
  entryCutoffBeforeCloseMinutes: 30,
  forceCloseBeforeCloseMinutes: 10,
  currency: "EUR",
  extendedHoursEnabled: false
};

export function displayStatusForStockMode(
  mode: StockIntradayMode,
  locked: boolean,
  paused: boolean
): StockIntradayDisplayStatus {
  if (locked) return "LOCKED";
  if (paused && mode !== "OFF") return "PAUSED";
  if (mode === "OFF") return "OFF";
  if (mode === "SHADOW") return "SHADOW";
  if (mode === "T212_PAPER_AUTO") return "PAPER";
  return "LIVE";
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}
