/**
 * Risk validation and locks for Stocks Intraday AutoTrade.
 */

import type { StockIntradayRiskLimits, StockIntradayMode } from "../featureFlags";
import type { StockIntradayRiskState, StockUniverseFilters, RankedIntradayOpportunity } from "../types";
import type { MarketQuote, MarketIndicators } from "../marketData/marketDataProvider";

export function dayKeyUtc(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function createDefaultRiskState(userId: string): StockIntradayRiskState {
  return {
    userId,
    mode: "OFF",
    locked: false,
    lockReason: null,
    paused: false,
    emergencyStopActive: false,
    killSwitchActive: false,
    dailyRealisedPnl: 0,
    dailyUnrealisedPnl: 0,
    tradesUsedToday: 0,
    losingTradesToday: 0,
    dailyAllocationUsed: 0,
    dayKey: dayKeyUtc(),
    updatedAt: new Date().toISOString()
  };
}

export function refreshRiskPeriod(state: StockIntradayRiskState, now = new Date()): StockIntradayRiskState {
  const key = dayKeyUtc(now);
  if (state.dayKey === key) return state;
  return {
    ...state,
    dayKey: key,
    dailyRealisedPnl: 0,
    dailyUnrealisedPnl: 0,
    tradesUsedToday: 0,
    losingTradesToday: 0,
    dailyAllocationUsed: 0,
    updatedAt: now.toISOString()
  };
}

export function validateRiskLimits(limits: StockIntradayRiskLimits): string[] {
  const errors: string[] = [];
  if (!(limits.dailyCapitalAllocation > 0)) errors.push("dailyCapitalAllocation");
  if (!(limits.maxCapitalPerTrade > 0)) errors.push("maxCapitalPerTrade");
  if (limits.maxCapitalPerTrade > limits.dailyCapitalAllocation) {
    errors.push("maxCapitalPerTrade exceeds dailyCapitalAllocation");
  }
  if (!(limits.maxSimultaneousPositions >= 1)) errors.push("maxSimultaneousPositions");
  if (!(limits.minConfidence >= 1 && limits.minConfidence <= 100)) errors.push("minConfidence");
  if (!(limits.minCashReserve >= 0)) errors.push("minCashReserve");
  if (!(limits.maxDailyLoss > 0)) errors.push("maxDailyLoss");
  if (!(limits.maxLossPerTrade > 0)) errors.push("maxLossPerTrade");
  if (!(limits.maxTradesPerDay >= 1)) errors.push("maxTradesPerDay");
  if (!(limits.minRewardRisk > 0)) errors.push("minRewardRisk");
  if (!(limits.entryCutoffBeforeCloseMinutes >= 0)) errors.push("entryCutoffBeforeCloseMinutes");
  if (!(limits.forceCloseBeforeCloseMinutes >= 0)) errors.push("forceCloseBeforeCloseMinutes");
  if (limits.forceCloseBeforeCloseMinutes > limits.entryCutoffBeforeCloseMinutes) {
    errors.push("forceCloseBeforeCloseMinutes must be <= entryCutoffBeforeCloseMinutes");
  }
  return errors;
}

export function canActivateMode(
  mode: StockIntradayMode,
  limits: StockIntradayRiskLimits,
  opts: {
    paperSubmissionEnabled: boolean;
    liveExecutionEnabled: boolean;
    marketDataReady: boolean;
  }
): { ok: boolean; reason: string | null } {
  if (mode === "OFF" || mode === "SHADOW") {
    const errors = validateRiskLimits(limits);
    if (errors.length) return { ok: false, reason: `Invalid risk settings: ${errors.join(", ")}` };
    return { ok: true, reason: null };
  }
  const errors = validateRiskLimits(limits);
  if (errors.length) return { ok: false, reason: `Invalid risk settings: ${errors.join(", ")}` };
  if (!opts.marketDataReady) {
    return { ok: false, reason: "Market-data provider not configured" };
  }
  if (mode === "T212_PAPER_AUTO" && !opts.paperSubmissionEnabled) {
    return {
      ok: false,
      reason: "T212_PAPER_ORDER_SUBMISSION_ENABLED is false — Paper Auto architecture only"
    };
  }
  if (mode === "T212_LIVE_AUTO") {
    if (!opts.liveExecutionEnabled) {
      return { ok: false, reason: "T212_LIVE_EXECUTION_FEATURE_FLAG is false — Live Auto hard-blocked" };
    }
    return { ok: false, reason: "T212_LIVE_ORDER_HARD_BLOCKED" };
  }
  return { ok: true, reason: null };
}

export type EntryBlockCode =
  | "MARKET_CLOSED"
  | "STALE_DATA"
  | "EXCESSIVE_SPREAD"
  | "EXCESSIVE_SLIPPAGE"
  | "INSUFFICIENT_LIQUIDITY"
  | "LOW_RELATIVE_VOLUME"
  | "EXCESSIVE_VOLATILITY"
  | "DAILY_LOSS_LIMIT"
  | "DAILY_TRADE_LIMIT"
  | "MAX_POSITIONS"
  | "SYMBOL_COOLDOWN"
  | "ENTRY_CUTOFF"
  | "CASH_RESERVE"
  | "DOES_NOT_QUALIFY"
  | "DUPLICATE_POSITION"
  | "KILL_SWITCH"
  | "LOCKED"
  | "MODE_OFF"
  | "CFD_EXCLUDED"
  | "NOT_IN_UNIVERSE";

export function evaluateEntryGates(args: {
  mode: StockIntradayMode;
  risk: StockIntradayRiskState;
  limits: StockIntradayRiskLimits;
  universe: StockUniverseFilters;
  opportunity: RankedIntradayOpportunity | null;
  quote: MarketQuote | null;
  indicators: MarketIndicators | null;
  openPositionCount: number;
  hasSymbolPosition: boolean;
  symbolCooldownActive: boolean;
  minutesToClose: number | null;
  estimatedSlippageBps: number;
  instrumentType: "STOCK" | "ETF" | "OTHER";
}): { allow: boolean; code: EntryBlockCode | null; message: string | null } {
  const { mode, risk, limits, opportunity } = args;

  if (mode === "OFF") return block("MODE_OFF", "Mode is OFF");
  if (risk.locked || risk.killSwitchActive || risk.emergencyStopActive) {
    return block("LOCKED", risk.lockReason ?? "AutoTrade locked");
  }
  if (risk.killSwitchActive) return block("KILL_SWITCH", "Kill switch active");
  if (args.instrumentType === "OTHER") return block("CFD_EXCLUDED", "CFD/options/warrants excluded");
  if (!opportunity) return block("DOES_NOT_QUALIFY", "WAIT — no valid intraday opportunity");
  if (!opportunity.qualifies) {
    return block("DOES_NOT_QUALIFY", opportunity.blockReasons[0] ?? "Candidate failed absolute checks");
  }
  if (!isInUniverse(opportunity.symbol, args.universe)) {
    return block("NOT_IN_UNIVERSE", "Symbol not in configured watchlist/filters");
  }
  if (args.indicators?.sessionStatus !== "OPEN") {
    return block("MARKET_CLOSED", "BLOCKED — market closed");
  }
  if (args.quote && args.indicators) {
    const age = Date.now() - new Date(args.quote.asOf).getTime();
    if (age > 60_000) return block("STALE_DATA", "BLOCKED — stale data");
  }
  if ((args.quote?.spreadBps ?? 0) > limits.maxSpreadBps) {
    return block("EXCESSIVE_SPREAD", "BLOCKED — excessive spread");
  }
  if (args.estimatedSlippageBps > limits.maxSlippageBps) {
    return block("EXCESSIVE_SLIPPAGE", "BLOCKED — excessive slippage");
  }
  if ((args.indicators?.averageDailyVolume ?? 0) < limits.minLiquidityAdv) {
    return block("INSUFFICIENT_LIQUIDITY", "BLOCKED — insufficient liquidity");
  }
  if ((args.indicators?.relativeVolume ?? 0) < args.universe.minRelativeVolume) {
    return block("LOW_RELATIVE_VOLUME", "BLOCKED — relative volume");
  }
  if ((args.indicators?.volatilityPct ?? 0) > limits.maxVolatilityPct) {
    return block("EXCESSIVE_VOLATILITY", "BLOCKED — excessive volatility");
  }
  if (Math.abs(Math.min(0, risk.dailyRealisedPnl)) >= limits.maxDailyLoss) {
    return block("DAILY_LOSS_LIMIT", "BLOCKED — daily loss limit reached");
  }
  if (risk.tradesUsedToday >= limits.maxTradesPerDay) {
    return block("DAILY_TRADE_LIMIT", "BLOCKED — max trades per day");
  }
  if (args.openPositionCount >= limits.maxSimultaneousPositions) {
    return block("MAX_POSITIONS", "BLOCKED — max simultaneous positions");
  }
  if (args.hasSymbolPosition) {
    return block("DUPLICATE_POSITION", "BLOCKED — overlapping position");
  }
  if (args.symbolCooldownActive) {
    return block("SYMBOL_COOLDOWN", "BLOCKED — symbol cooldown");
  }
  if (
    args.minutesToClose != null &&
    args.minutesToClose <= limits.entryCutoffBeforeCloseMinutes
  ) {
    return block("ENTRY_CUTOFF", "BLOCKED — market closing soon");
  }

  return { allow: true, code: null, message: null };
}

export function isInUniverse(symbol: string, universe: StockUniverseFilters): boolean {
  const sym = symbol.toUpperCase();
  if (universe.exclusionList.map((s: string) => s.toUpperCase()).includes(sym)) return false;
  if (universe.allowlist.length > 0) {
    return universe.allowlist.map((s: string) => s.toUpperCase()).includes(sym);
  }
  return true;
}

function block(code: EntryBlockCode, message: string) {
  return { allow: false, code, message };
}

export function applyKillSwitch(state: StockIntradayRiskState): StockIntradayRiskState {
  return {
    ...state,
    mode: "OFF",
    locked: true,
    lockReason: "kill_switch",
    killSwitchActive: true,
    emergencyStopActive: true,
    paused: true,
    updatedAt: new Date().toISOString()
  };
}

export function applyLock(state: StockIntradayRiskState, reason: string): StockIntradayRiskState {
  return {
    ...state,
    locked: true,
    lockReason: reason,
    paused: true,
    updatedAt: new Date().toISOString()
  };
}

export function clearLock(state: StockIntradayRiskState): StockIntradayRiskState {
  return {
    ...state,
    locked: false,
    lockReason: null,
    killSwitchActive: false,
    emergencyStopActive: false,
    paused: false,
    updatedAt: new Date().toISOString()
  };
}

export function resetModeAfterRestart(state: StockIntradayRiskState): StockIntradayRiskState {
  return {
    ...state,
    mode: "OFF",
    paused: true,
    updatedAt: new Date().toISOString()
  };
}
