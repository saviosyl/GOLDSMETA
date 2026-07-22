/**
 * Risk budgets, lock reasons, and remaining loss capacity for AutoTrade.
 */

import {
  FIRST_PILOT_LIMITS,
  dayKeyUtc,
  weekKeyUtc,
  type AutoTradeRiskLimits,
  type AutoTradeRiskState
} from "./types";
import { nowIso } from "../../utils/time";

export function createDefaultRiskState(userId: string, now = new Date()): AutoTradeRiskState {
  return {
    userId,
    mode: "OFF",
    locked: false,
    lockReason: null,
    emergencyStopActive: false,
    dailyRealisedPnl: 0,
    dailyUnrealisedPnl: 0,
    weeklyRealisedPnl: 0,
    weeklyUnrealisedPnl: 0,
    tradesUsedToday: 0,
    consecutiveLosses: 0,
    lastLossAt: null,
    dayKey: dayKeyUtc(now),
    weekKey: weekKeyUtc(now),
    updatedAt: now.toISOString()
  };
}

export function refreshRiskPeriod(state: AutoTradeRiskState, now = new Date()): AutoTradeRiskState {
  const dayKey = dayKeyUtc(now);
  const weekKey = weekKeyUtc(now);
  const next = { ...state };
  if (state.dayKey !== dayKey) {
    next.dayKey = dayKey;
    next.dailyRealisedPnl = 0;
    next.dailyUnrealisedPnl = 0;
    next.tradesUsedToday = 0;
  }
  if (state.weekKey !== weekKey) {
    next.weekKey = weekKey;
    next.weeklyRealisedPnl = 0;
    next.weeklyUnrealisedPnl = 0;
  }
  next.updatedAt = now.toISOString();
  return next;
}

export function remainingDailyLossCapacity(
  state: AutoTradeRiskState,
  limits: AutoTradeRiskLimits
): number {
  const used =
    Math.abs(Math.min(0, state.dailyRealisedPnl)) +
    Math.abs(Math.min(0, state.dailyUnrealisedPnl));
  return Math.max(0, limits.maxDailyLoss - used);
}

export function remainingWeeklyLossCapacity(
  state: AutoTradeRiskState,
  limits: AutoTradeRiskLimits
): number {
  const used =
    Math.abs(Math.min(0, state.weeklyRealisedPnl)) +
    Math.abs(Math.min(0, state.weeklyUnrealisedPnl));
  return Math.max(0, limits.maxWeeklyLoss - used);
}

export function lockReasonFromBudgets(
  state: AutoTradeRiskState,
  limits: AutoTradeRiskLimits = FIRST_PILOT_LIMITS
): string | null {
  if (remainingDailyLossCapacity(state, limits) <= 0) return "daily_loss_reached";
  if (remainingWeeklyLossCapacity(state, limits) <= 0) return "weekly_loss_reached";
  if (state.consecutiveLosses >= limits.maxConsecutiveLosses) return "consecutive_loss_limit";
  return null;
}

export function applyLock(
  state: AutoTradeRiskState,
  reason: string
): AutoTradeRiskState {
  return {
    ...state,
    locked: true,
    lockReason: reason,
    updatedAt: nowIso()
  };
}

export function clearLock(state: AutoTradeRiskState): AutoTradeRiskState {
  return {
    ...state,
    locked: false,
    lockReason: null,
    emergencyStopActive: false,
    updatedAt: nowIso()
  };
}

export function applyEmergencyStop(state: AutoTradeRiskState): AutoTradeRiskState {
  return {
    ...state,
    mode: "OFF",
    locked: true,
    lockReason: "emergency_stop",
    emergencyStopActive: true,
    updatedAt: nowIso()
  };
}

/** After process/deploy restart, live mode must not auto-restore. */
export function resetModeAfterRestart(state: AutoTradeRiskState): AutoTradeRiskState {
  return {
    ...state,
    mode: "OFF",
    locked: false,
    lockReason: null,
    emergencyStopActive: false,
    updatedAt: nowIso()
  };
}

export function recordClosedTradePnl(
  state: AutoTradeRiskState,
  pnlEur: number,
  limits: AutoTradeRiskLimits = FIRST_PILOT_LIMITS
): AutoTradeRiskState {
  const refreshed = refreshRiskPeriod(state);
  const next: AutoTradeRiskState = {
    ...refreshed,
    dailyRealisedPnl: refreshed.dailyRealisedPnl + pnlEur,
    weeklyRealisedPnl: refreshed.weeklyRealisedPnl + pnlEur,
    updatedAt: nowIso()
  };
  if (pnlEur < 0) {
    next.consecutiveLosses = refreshed.consecutiveLosses + 1;
    next.lastLossAt = nowIso();
  } else {
    next.consecutiveLosses = 0;
  }
  const budgetLock = lockReasonFromBudgets(next, limits);
  if (budgetLock) {
    return applyLock(next, budgetLock);
  }
  return next;
}

export function isQuoteStale(quoteAgeMs: number, maxAgeMs = 60_000): boolean {
  return quoteAgeMs > maxAgeMs;
}

export function isSpreadExcessive(spread: number, maxSpread: number | null): boolean {
  if (maxSpread == null) return false;
  return spread > maxSpread;
}
