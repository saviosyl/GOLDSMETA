/**
 * Authoritative FAST_AUTOTRADE_V1 execution object.
 * Downstream Demo submission must use these values — never a DecisionRecord fallback.
 */

import {
  FAST_AUTOTRADE_STRATEGY_ID,
  type FastAutoTradeDecision,
  type FastGrade,
  type FastSetupIdentity
} from "./types";

export type FastExecutionIntent = {
  direction: "BUY" | "SELL";
  signalId: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  qualityScore: number;
  grade: FastGrade;
  identity: FastSetupIdentity | null;
  strategyId: typeof FAST_AUTOTRADE_STRATEGY_ID;
};

export function buildFastExecutionIntent(
  decision: FastAutoTradeDecision
): FastExecutionIntent | null {
  if (decision.action !== "BUY" && decision.action !== "SELL") return null;
  if (!decision.geometry || !decision.signalId) return null;
  const { entry, stopLoss, takeProfit } = decision.geometry;
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(takeProfit)
  ) {
    return null;
  }
  return {
    direction: decision.action,
    signalId: decision.signalId,
    entry,
    stopLoss,
    takeProfit,
    qualityScore: decision.qualityScore,
    grade: decision.grade,
    identity: decision.identity,
    strategyId: FAST_AUTOTRADE_STRATEGY_ID
  };
}
