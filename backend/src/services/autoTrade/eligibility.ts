/**
 * AutoTrade eligibility gates — WAIT never executes.
 */

import type { AutoTradeRiskLimits, AutoTradeRiskState, TradingSessionId } from "./types";

export interface EligibilityInput {
  decision: string;
  score: number | null;
  hasValidatedPlan: boolean;
  stop: number | null;
  takeProfit: number | null;
  entry: number | null;
  riskReward: number | null;
  decisionAgeMs: number;
  maxDecisionAgeMs?: number;
  marketStatus: "OPEN" | "CLOSED" | "TRADEABLE" | "UNKNOWN";
  quoteAgeMs: number;
  maxQuoteAgeMs?: number;
  spread: number | null;
  newsBlackoutActive: boolean;
  openGoldMetaPositions: number;
  conflictingPosition: boolean;
  brokerHealthy: boolean;
  session: TradingSessionId | "OTHER";
  riskState: AutoTradeRiskState;
  limits: AutoTradeRiskLimits;
  nowMs?: number;
}

export type EligibilityResult =
  | { ok: true }
  | { ok: false; reason: string };

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const decision = (input.decision || "").toUpperCase();
  if (decision === "WAIT" || (decision !== "BUY" && decision !== "SELL")) {
    return { ok: false, reason: "WAIT decisions never execute." };
  }
  if (input.riskState.locked || input.riskState.emergencyStopActive) {
    return {
      ok: false,
      reason: input.riskState.lockReason ?? "AutoTrade is locked."
    };
  }
  if (input.riskState.mode === "OFF") {
    return { ok: false, reason: "AutoTrade mode is OFF." };
  }
  if (!input.brokerHealthy) {
    return { ok: false, reason: "Broker reconciliation is unhealthy." };
  }
  if (!input.hasValidatedPlan || input.stop == null || input.takeProfit == null || input.entry == null) {
    return { ok: false, reason: "Validated trade plan with stop and take-profit is required." };
  }
  if (input.score == null || input.score < input.limits.minGoldMetaScore) {
    return {
      ok: false,
      reason: `Trade rejected — score below ${input.limits.minGoldMetaScore}.`
    };
  }
  if (input.riskReward == null || input.riskReward < input.limits.minRiskReward) {
    return {
      ok: false,
      reason: `Trade rejected — risk/reward below 1:${input.limits.minRiskReward}.`
    };
  }
  if (input.marketStatus === "CLOSED" || input.marketStatus === "UNKNOWN") {
    return { ok: false, reason: "Market is closed or status unknown." };
  }
  const maxQuote = input.maxQuoteAgeMs ?? 60_000;
  if (input.quoteAgeMs > maxQuote) {
    return { ok: false, reason: "Quote is stale." };
  }
  const maxDecision = input.maxDecisionAgeMs ?? 15 * 60_000;
  if (input.decisionAgeMs > maxDecision) {
    return { ok: false, reason: "Decision is not fresh enough." };
  }
  if (
    input.limits.maxSpread != null &&
    input.spread != null &&
    input.spread > input.limits.maxSpread
  ) {
    return { ok: false, reason: "Trade rejected — spread too high." };
  }
  if (input.newsBlackoutActive) {
    return { ok: false, reason: "Active news blackout." };
  }
  if (input.openGoldMetaPositions >= input.limits.maxOpenPositions) {
    return { ok: false, reason: "Maximum open GoldMeta positions reached." };
  }
  if (input.conflictingPosition) {
    return { ok: false, reason: "Conflicting open position exists." };
  }
  if (input.riskState.tradesUsedToday >= input.limits.maxTradesPerDay) {
    return { ok: false, reason: "Maximum trades per day reached." };
  }
  if (input.riskState.consecutiveLosses >= input.limits.maxConsecutiveLosses) {
    return { ok: false, reason: "Maximum consecutive losses reached." };
  }
  if (input.riskState.lastLossAt) {
    const elapsed = (input.nowMs ?? Date.now()) - new Date(input.riskState.lastLossAt).getTime();
    const need = input.limits.cooldownAfterLossMinutes * 60_000;
    if (elapsed < need) {
      return { ok: false, reason: "Cooldown after losing trade is still active." };
    }
  }
  const sessionAllowed =
    input.limits.allowedSessions.includes(input.session as TradingSessionId) ||
    (input.session === "LONDON_NY_OVERLAP" &&
      (input.limits.allowedSessions.includes("LONDON") ||
        input.limits.allowedSessions.includes("NEW_YORK") ||
        input.limits.allowedSessions.includes("LONDON_NY_OVERLAP")));
  if (!sessionAllowed) {
    return { ok: false, reason: "Session is not in the allowed trading sessions." };
  }

  const dailyUsed =
    Math.abs(Math.min(0, input.riskState.dailyRealisedPnl)) +
    Math.abs(Math.min(0, input.riskState.dailyUnrealisedPnl));
  // remaining capacity checked again in sizing; here hard lock if already at limit
  if (dailyUsed >= input.limits.maxDailyLoss) {
    return { ok: false, reason: "Daily loss limit reached." };
  }
  const weeklyUsed =
    Math.abs(Math.min(0, input.riskState.weeklyRealisedPnl)) +
    Math.abs(Math.min(0, input.riskState.weeklyUnrealisedPnl));
  if (weeklyUsed >= input.limits.maxWeeklyLoss) {
    return { ok: false, reason: "Weekly loss limit reached." };
  }

  return { ok: true };
}
