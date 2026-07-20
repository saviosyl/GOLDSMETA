import { decisionConfig } from "../../config/decisionConfig";
import type { DataQualityResult, DecisionDirection, GuardResult, MarketSnapshot, TradePlan } from "../../models/types";
import { isPositivePrice } from "../../utils/money";

const decisionToTrend = (decision: Exclude<DecisionDirection, "WAIT">): "BULLISH" | "BEARISH" =>
  decision === "BUY" ? "BULLISH" : "BEARISH";

const hasHigherTimeframeContradiction = (
  snapshot: MarketSnapshot,
  decision: Exclude<DecisionDirection, "WAIT">
): boolean => {
  const components = snapshot.trend?.components ?? [];
  const currentTimeframe = Number(snapshot.timeframe);
  const desired = decisionToTrend(decision);
  return components.some((component) => {
    const componentTimeframe = Number(component.sourceTimeframe);
    if (!Number.isFinite(componentTimeframe) || componentTimeframe < currentTimeframe) {
      return false;
    }
    return component.direction !== "NEUTRAL" && component.direction !== desired && component.strength >= 60;
  });
};

export const evaluateHardGuards = (
  snapshot: MarketSnapshot,
  decision: DecisionDirection,
  plan: TradePlan,
  dataQuality: DataQualityResult
): GuardResult => {
  const reasonCodes: string[] = [];
  const warnings: string[] = [];

  if (decisionConfig.guards.safetyLock) {
    reasonCodes.push("SAFETY_LOCK");
    warnings.push("Safety lock is active");
  }

  if (dataQuality.quality === "STALE") {
    reasonCodes.push("STALE_DATA");
  }
  if (dataQuality.quality === "INVALID") {
    reasonCodes.push("INVALID_DATA");
  }
  if (dataQuality.quality === "CONFLICTED") {
    reasonCodes.push("CONFLICTED_DATA");
  }

  if (!isPositivePrice(snapshot.price)) {
    reasonCodes.push("MISSING_PRICE");
  }

  if (!snapshot.isConfirmedBar && !decisionConfig.guards.provisionalAllowed) {
    reasonCodes.push("PROVISIONAL_DISABLED");
  }

  if (decision !== "WAIT") {
    const entry = plan.entry.price;
    const stopLoss = plan.stopLoss.price;

    if (!isPositivePrice(stopLoss)) {
      reasonCodes.push("CANNOT_DETERMINE_SL");
    }

    if (!isPositivePrice(entry)) {
      reasonCodes.push("MISSING_ENTRY");
    }

    if (isPositivePrice(entry) && isPositivePrice(stopLoss)) {
      if (decision === "BUY" && stopLoss >= entry) {
        reasonCodes.push("WRONG_SIDE_STOP_LOSS");
      }
      if (decision === "SELL" && stopLoss <= entry) {
        reasonCodes.push("WRONG_SIDE_STOP_LOSS");
      }

      const hasWrongSideTarget = plan.takeProfits.some((target) =>
        decision === "BUY" ? target.price <= entry : target.price >= entry
      );
      if (hasWrongSideTarget) {
        reasonCodes.push("WRONG_SIDE_TAKE_PROFIT");
      }
    }

    const tp2RiskReward = plan.riskReward.tp2;
    if (tp2RiskReward === null || tp2RiskReward < decisionConfig.thresholds.minRiskRewardToTp2) {
      reasonCodes.push("MIN_RR_TO_TP2_NOT_MET");
    }

    if (hasHigherTimeframeContradiction(snapshot, decision)) {
      reasonCodes.push("HTF_CONTRADICTION");
    }
  }

  return {
    passed: reasonCodes.length === 0,
    reasonCodes,
    warnings
  };
};
