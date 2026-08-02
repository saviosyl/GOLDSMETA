import { decisionConfig } from "../../config/decisionConfig";
import type { DataQualityResult, DecisionDirection, GuardResult, MarketSnapshot, TradePlan } from "../../models/types";
import { isPositivePrice } from "../../utils/money";

const decisionToTrend = (decision: Exclude<DecisionDirection, "WAIT">): "BULLISH" | "BEARISH" =>
  decision === "BUY" ? "BULLISH" : "BEARISH";

const resolveVolumeProfile = (
  snapshot: MarketSnapshot
): { poc: number | null; vah: number | null; val: number | null } => {
  const poc = snapshot.levels?.pocAll ?? snapshot.sessionVolumeProfile?.poc ?? null;
  const vah = snapshot.levels?.vahAll ?? snapshot.sessionVolumeProfile?.vah ?? null;
  const val = snapshot.levels?.valAll ?? snapshot.sessionVolumeProfile?.val ?? null;
  return {
    poc: isPositivePrice(poc) ? poc : null,
    vah: isPositivePrice(vah) ? vah : null,
    val: isPositivePrice(val) ? val : null
  };
};

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

const valueAreaRelation = (
  price: number,
  vah: number,
  val: number
): "ABOVE_VAH" | "INSIDE_VA" | "BELOW_VAL" => {
  if (price > vah) {
    return "ABOVE_VAH";
  }
  if (price < val) {
    return "BELOW_VAL";
  }
  return "INSIDE_VA";
};

const hasTrendStructureConflict = (snapshot: MarketSnapshot): boolean => {
  const trend = snapshot.trend?.direction;
  const profile = resolveVolumeProfile(snapshot);
  if (!trend || trend === "NEUTRAL" || !isPositivePrice(snapshot.price) || !profile.vah || !profile.val) {
    return false;
  }
  const relation = valueAreaRelation(snapshot.price, profile.vah, profile.val);
  if (trend === "BULLISH" && relation === "BELOW_VAL") {
    return true;
  }
  if (trend === "BEARISH" && relation === "ABOVE_VAH") {
    return true;
  }
  return false;
};

const evidenceFamilies = (snapshot: MarketSnapshot, decision: Exclude<DecisionDirection, "WAIT">): number => {
  const desired = decisionToTrend(decision);
  let count = 0;

  const trend = snapshot.trend?.direction;
  const trendStrength = snapshot.trend?.strength ?? 0;
  if (trend === desired && trendStrength > 0) {
    count += 1;
  }

  const profile = resolveVolumeProfile(snapshot);
  if (profile.poc !== null && profile.vah !== null && profile.val !== null && isPositivePrice(snapshot.price)) {
    const relation = valueAreaRelation(snapshot.price, profile.vah, profile.val);
    const pocSide = snapshot.price >= profile.poc ? "BULLISH" : "BEARISH";
    if (decision === "BUY" && (relation === "ABOVE_VAH" || pocSide === "BULLISH")) {
      count += 1;
    } else if (decision === "SELL" && (relation === "BELOW_VAL" || pocSide === "BEARISH")) {
      count += 1;
    }
  }

  const candle = snapshot.confirmationCandle;
  if (
    candle?.confirmed &&
    candle.direction === desired &&
    candle.classification &&
    candle.classification !== "NONE"
  ) {
    count += 1;
  }

  return count;
};

export const evaluateHardGuards = (
  snapshot: MarketSnapshot,
  decision: DecisionDirection,
  plan: TradePlan,
  dataQuality: DataQualityResult,
  confidence?: number
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
    if (dataQuality.warnings.some((w) => /PRICE_SOURCE_MISMATCH/i.test(w))) {
      reasonCodes.push("PRICE_SOURCE_MISMATCH");
    }
  }
  if (dataQuality.quality === "PARTIAL") {
    reasonCodes.push("INCOMPLETE_DATA");
  }

  if (dataQuality.missingInputs.includes("volumeProfile")) {
    reasonCodes.push("MISSING_VOLUME_PROFILE");
  }
  if (
    dataQuality.missingInputs.includes("trend.direction") ||
    dataQuality.missingInputs.includes("trend.strength")
  ) {
    reasonCodes.push("MISSING_TREND");
  }
  if (dataQuality.missingInputs.includes("confirmationCandle")) {
    reasonCodes.push("MISSING_CONFIRMATION");
  }

  if (!isPositivePrice(snapshot.price)) {
    reasonCodes.push("MISSING_PRICE");
  }

  if (!snapshot.isConfirmedBar && !decisionConfig.guards.provisionalAllowed) {
    reasonCodes.push("PROVISIONAL_DISABLED");
  }

  if (hasTrendStructureConflict(snapshot)) {
    reasonCodes.push("CONFLICTING_TREND");
  }

  if (decision !== "WAIT") {
    const entry = plan.entry.price;
    const stopLoss = plan.stopLoss.price;
    const profile = resolveVolumeProfile(snapshot);
    const candle = snapshot.confirmationCandle;

    if (reasonCodes.includes("PRICE_SOURCE_MISMATCH")) {
      // Already conflicted — keep BUY/SELL blocked via failed guards.
    }

    if (profile.poc === null || profile.vah === null || profile.val === null) {
      reasonCodes.push("MISSING_VOLUME_PROFILE");
    }

    if (!snapshot.trend?.direction || snapshot.trend.direction === "NEUTRAL") {
      reasonCodes.push("MISSING_TREND");
    }

    if (
      !candle?.confirmed ||
      !candle.direction ||
      !candle.classification ||
      candle.classification === "NONE"
    ) {
      reasonCodes.push("MISSING_CONFIRMATION");
    }

    if (evidenceFamilies(snapshot, decision) < 2) {
      reasonCodes.push("INSUFFICIENT_EVIDENCE");
    }

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
      reasonCodes.push("POOR_RISK_REWARD");
    }

    if (hasHigherTimeframeContradiction(snapshot, decision)) {
      reasonCodes.push("HTF_CONTRADICTION");
    }

    if (
      typeof confidence === "number" &&
      confidence < decisionConfig.thresholds.minConfidenceForTrade
    ) {
      reasonCodes.push("LOW_CONFIDENCE");
    }
  }

  return {
    passed: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)],
    warnings
  };
};
