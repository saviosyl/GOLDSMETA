/**
 * Plan quality grading A / B / C / NO PLAN with explicit reasons.
 * Optional profile / TP2 / 5M confirmation gaps are soft (grade B), not NO_PLAN.
 */

import type { DecisionRecord } from "../../models/types";
import { isPositivePrice } from "../../utils/money";
import type { PlanQuality, PlanQualityGrade } from "./sessionPlanTypes";
import type { MarketStructureMode } from "./strategySignal";
import { validateTradePlanGeometry } from "./tradePlanGeometry";

const positive = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

export const evaluatePlanQuality = (args: {
  decision: DecisionRecord | null;
  marketStructureMode: MarketStructureMode | null;
  confirmationState: string | null;
  chartMatchesRole: boolean | null;
  quickTargetRrOk: boolean;
  hasFourHourContext: boolean;
}): PlanQuality => {
  const reasons: string[] = [];
  const d = args.decision;

  if (!d || args.marketStructureMode === "UNAVAILABLE") {
    // Soft if we somehow have levels later; hard when decision absent.
    if (!d) {
      return { grade: "NO_PLAN", reasons: ["NO_VALID_15M_PLAN", "MISSING_STRUCTURE"] };
    }
    reasons.push("STRUCTURE_INCOMPLETE");
  }
  if (args.marketStructureMode === "MISMATCH") {
    return { grade: "NO_PLAN", reasons: ["PRICE_SOURCE_MISMATCH", "NO_TRADE"] };
  }
  if (args.chartMatchesRole === false) {
    return { grade: "NO_PLAN", reasons: ["CHART_ROLE_MISMATCH", "NO_TRADE"] };
  }

  const entry = positive(d.entry?.price) ?? positive(d.entry?.zoneLow);
  const stop = positive(d.stopLoss?.price);
  const tp1 = positive(d.takeProfits?.find((t) => t.label === "TP1")?.price);
  const tp2 = positive(d.takeProfits?.find((t) => t.label === "TP2")?.price);
  const poc = positive(d.marketStructure?.poc);
  const vah = positive(d.marketStructure?.vah);
  const val = positive(d.marketStructure?.val);
  const trend = d.marketStructure?.trend ?? d.higherTimeframeBias;
  const direction = d.decision;

  // Soft limitations — never alone force NO_PLAN when Entry/Stop/TP1 exist.
  if (poc == null || vah == null || val == null) {
    reasons.push("INCOMPLETE_VOLUME_PROFILE");
  }
  if (!trend || trend === "NEUTRAL") {
    reasons.push("WEAK_OR_NEUTRAL_TREND");
  }
  if (direction === "WAIT") {
    reasons.push("DECISION_WAIT");
  }
  if (entry == null) reasons.push("MISSING_ENTRY");
  if (stop == null) reasons.push("MISSING_STOP");
  if (tp1 == null) reasons.push("MISSING_TP1");
  if (tp2 == null && (direction === "BUY" || direction === "SELL")) {
    reasons.push("TP2_OPTIONAL_MISSING");
  }
  if (!args.quickTargetRrOk && direction !== "WAIT") {
    reasons.push("QUICK_TARGET_RR_WEAK");
  }
  if (!args.hasFourHourContext) {
    reasons.push("MISSING_4H_CONTEXT");
  }

  const geometry = validateTradePlanGeometry({
    direction,
    entryPrice: entry,
    entryZoneLow: positive(d.entry?.zoneLow),
    entryZoneHigh: positive(d.entry?.zoneHigh),
    stop,
    tp1,
    tp2,
    currentPrice: positive(d.lastKnownPrice),
    invalidationText: d.invalidation,
    quickTargetOk: args.quickTargetRrOk ? true : direction === "WAIT" ? null : false,
    marketStructureMode: args.marketStructureMode
  });

  if (!geometry.actionable && (direction === "BUY" || direction === "SELL")) {
    reasons.push(...geometry.hardReasonCodes);
    reasons.push("TRADE_LEVELS_FAILED_SAFETY_VALIDATION");
    return { grade: "NO_PLAN", reasons: [...new Set(reasons)] };
  }

  const confirmed =
    args.confirmationState != null &&
    /BREAKOUT_CONFIRMED|RETEST_HELD|BULLISH_CONFIRMATION|BEARISH_CONFIRMATION/i.test(
      args.confirmationState
    );
  if (!confirmed) {
    reasons.push("AWAITING_5M_CONFIRMATION");
  }

  // Essentials = hard geometry only (TP2 / profile / 5M optional).
  const essentialsOk =
    entry != null &&
    stop != null &&
    tp1 != null &&
    direction !== "WAIT" &&
    geometry.actionable &&
    isPositivePrice(entry) &&
    isPositivePrice(stop) &&
    isPositivePrice(tp1);

  if (!essentialsOk) {
    return {
      grade: "NO_PLAN",
      reasons: [
        ...new Set(["STRUCTURE_ONLY_OR_INCOMPLETE_TRADE_PLAN", "WAIT_NO_VALID_PLAN", ...reasons])
      ]
    };
  }

  let grade: PlanQualityGrade;
  if (
    essentialsOk &&
    confirmed &&
    args.quickTargetRrOk &&
    trend &&
    trend !== "NEUTRAL" &&
    poc != null &&
    vah != null &&
    val != null &&
    !reasons.includes("MISSING_4H_CONTEXT")
  ) {
    grade = "A";
    reasons.unshift("COMPLETE_CONFIRMED_ALIGNED");
  } else {
    // Valid Entry/Stop/TP1 with soft gaps → B (actionable waiting plan).
    grade = "B";
    reasons.unshift("COMPLETE_LEVELS_PARTIAL_CONFIRM");
  }

  return { grade, reasons: [...new Set(reasons)] };
};
