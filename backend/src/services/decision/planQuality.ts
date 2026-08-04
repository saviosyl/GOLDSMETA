/**
 * Plan quality grading A / B / C / NO PLAN with explicit reasons.
 */

import type { DecisionRecord } from "../../models/types";
import { isPositivePrice } from "../../utils/money";
import type { PlanQuality, PlanQualityGrade } from "./sessionPlanTypes";
import type { MarketStructureMode } from "./strategySignal";

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
    return { grade: "NO_PLAN", reasons: ["NO_VALID_15M_PLAN", "MISSING_STRUCTURE"] };
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
  const poc = positive(d.marketStructure?.poc);
  const vah = positive(d.marketStructure?.vah);
  const val = positive(d.marketStructure?.val);
  const trend = d.marketStructure?.trend ?? d.higherTimeframeBias;
  const direction = d.decision;

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
  if (!args.quickTargetRrOk && direction !== "WAIT") {
    reasons.push("QUICK_TARGET_RR_WEAK");
  }
  if (!args.hasFourHourContext) {
    reasons.push("MISSING_4H_CONTEXT");
  }

  const confirmed =
    args.confirmationState != null &&
    /CONFIRMED|HELD|INSIDE_ZONE|APPROACHING/i.test(args.confirmationState);
  if (!confirmed) {
    reasons.push("AWAITING_5M_CONFIRMATION");
  }

  const essentialsOk =
    poc != null &&
    vah != null &&
    val != null &&
    entry != null &&
    stop != null &&
    tp1 != null &&
    direction !== "WAIT" &&
    isPositivePrice(entry) &&
    isPositivePrice(stop) &&
    isPositivePrice(tp1);

  if (!essentialsOk && (poc == null || vah == null || val == null)) {
    return { grade: "NO_PLAN", reasons: reasons.length ? reasons : ["INCOMPLETE_SETUP"] };
  }

  let grade: PlanQualityGrade;
  if (
    essentialsOk &&
    confirmed &&
    args.quickTargetRrOk &&
    trend &&
    trend !== "NEUTRAL" &&
    !reasons.includes("MISSING_4H_CONTEXT")
  ) {
    grade = "A";
    reasons.unshift("COMPLETE_CONFIRMED_ALIGNED");
  } else if (essentialsOk && (confirmed || args.quickTargetRrOk)) {
    grade = "B";
    reasons.unshift("COMPLETE_LEVELS_PARTIAL_CONFIRM");
  } else if (poc != null && vah != null && val != null) {
    grade = "C";
    reasons.unshift("STRUCTURE_ONLY_OR_INCOMPLETE_TRADE_PLAN");
  } else {
    grade = "NO_PLAN";
    reasons.unshift("INCOMPLETE_SETUP");
  }

  return { grade, reasons: [...new Set(reasons)] };
};
