import type { IntradayPlan } from "../types/intradayPlan";
import { resolveAuthoritativeConfirmation } from "./confirmationAuthority";
import { fmtPrice } from "./intradayFormat";
import { isNoValidIntradayPlan, sanitizePlanText } from "./planTextFormat";
import { plainReason } from "./reasonCodePlain";

export type DecisionDashboardMode =
  | "WAIT"
  | "POTENTIAL_BUY"
  | "POTENTIAL_SELL"
  | "BUY_READY"
  | "SELL_READY"
  | "NO_TRADE";

export type DecisionDashboardLevelSet = {
  entry: string | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  rr: string | null;
};

export type DecisionDashboardState = {
  mode: DecisionDashboardMode;
  primaryDecision: "BUY" | "SELL" | "WAIT" | "NO TRADE";
  headline: string;
  planState: string;
  nextAction: string;
  direction: "BUY" | "SELL" | null;
  tone: "buy" | "sell" | "wait" | "notrade";
  levels: DecisionDashboardLevelSet;
  showLevels: boolean;
  confirmationLabel: string;
  confirmationDetail: string;
  confirmationPassed: boolean;
  confidenceLabel: string | null;
  lifecycleLabel: string | null;
  reason: string;
  technicalDetails: string[];
  nearestSupport: number | null;
  nearestResistance: number | null;
  priceVsEntryZone: string | null;
  reviewKind: "15M" | "5M";
};

function directionFromPlan(plan: IntradayPlan): "BUY" | "SELL" | null {
  const raw = `${plan.tradePlan?.direction ?? ""} ${plan.action ?? ""} ${plan.actionLabel ?? ""}`.toUpperCase();
  if (raw.includes("BUY") || raw.includes("BULL")) return "BUY";
  if (raw.includes("SELL") || raw.includes("BEAR")) return "SELL";
  return null;
}

function resolveLevels(plan: IntradayPlan): DecisionDashboardLevelSet {
  const tradePlan = plan.tradePlan;
  const entryRaw = sanitizePlanText(tradePlan.entryZone) || sanitizePlanText(plan.trigger);
  return {
    entry: entryRaw || (plan.triggerPrice != null ? fmtPrice(plan.triggerPrice) : null),
    stop: tradePlan.stopLoss ?? null,
    tp1: tradePlan.tp1 ?? plan.nextTargetPrice ?? null,
    tp2: tradePlan.tp2 ?? plan.afterThatTargetPrice ?? null,
    rr: sanitizePlanText(tradePlan.riskReward) || null
  };
}

function hasUsefulLevels(levels: DecisionDashboardLevelSet): boolean {
  return Boolean(levels.entry || levels.stop != null || levels.tp1 != null || levels.tp2 != null);
}

function parseEntryZone(entry: string | null): [number, number] | null {
  if (!entry) return null;
  const nums = Array.from(entry.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g))
    .map((m) => Number(m[0]))
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  if (nums.length === 1) return [nums[0]!, nums[0]!];
  return [Math.min(nums[0]!, nums[1]!), Math.max(nums[0]!, nums[1]!)];
}

function priceVsEntry(livePrice: number | null | undefined, entry: string | null): string | null {
  if (livePrice == null || !Number.isFinite(livePrice)) return null;
  const zone = parseEntryZone(entry);
  if (!zone) return null;
  const [low, high] = zone;
  if (livePrice >= low && livePrice <= high) return "Price is inside the entry zone.";
  if (livePrice < low) return `${fmtPrice(low - livePrice)} points below entry zone.`;
  return `${fmtPrice(livePrice - high)} points above entry zone.`;
}

function waitReason(plan: IntradayPlan): string {
  return plainReason(
    plan.geometryMessage ??
      plan.geometryReasonCodes?.[0] ??
      plan.planQuality?.reasons?.[0] ??
      plan.whyNotReady ??
      "No valid trade plan yet"
  );
}

function technicalDetails(plan: IntradayPlan): string[] {
  return [
    ...(plan.geometryReasonCodes ?? []),
    ...(plan.planQuality?.reasons ?? []),
    plan.geometryMessage ?? null,
    plan.whyNotReady ?? null
  ]
    .filter((item): item is string => Boolean(item))
    .map((item) => sanitizePlanText(item))
    .filter(Boolean);
}

export function deriveDecisionDashboardState(args: {
  plan: IntradayPlan;
  marketStructureMode?: string | null;
  livePrice?: number | null;
}): DecisionDashboardState {
  const { plan, marketStructureMode, livePrice } = args;
  const noValid = isNoValidIntradayPlan(plan, marketStructureMode);
  const direction = directionFromPlan(plan);
  const levels = resolveLevels(plan);
  const noTrade =
    !noValid &&
    (String(plan.action).toUpperCase() === "NO_TRADE" ||
      String(plan.planStatus ?? "").toUpperCase() === "NO_TRADE" ||
      String(marketStructureMode ?? plan.freshness?.marketStructureMode ?? "").toUpperCase() ===
        "MISMATCH");
  const auth = resolveAuthoritativeConfirmation({
    confirmationState: plan.confirmation5m?.state,
    direction: direction ?? plan.tradePlan?.direction,
    action: plan.action
  });
  const confidenceLabel =
    typeof plan.confidence === "number" ? `${Math.round(plan.confidence)}% confidence` : null;
  const lifecycleLabel = plan.planStatus ? String(plan.planStatus).replace(/_/g, " ") : null;

  if (noValid) {
    return {
      mode: "WAIT",
      primaryDecision: "WAIT",
      headline: "WAIT",
      planState: "No valid trade plan yet",
      nextAction:
        "GoldMeta is monitoring XAUUSD. You can be notified when a valid opportunity becomes ready.",
      direction: null,
      tone: "wait",
      levels,
      showLevels: false,
      confirmationLabel: "5M confirmation not required yet",
      confirmationDetail: "A valid 15M plan must appear before entry confirmation matters.",
      confirmationPassed: false,
      confidenceLabel,
      lifecycleLabel,
      reason: waitReason(plan),
      technicalDetails: technicalDetails(plan),
      nearestSupport: plan.zones?.nearestSupport ?? null,
      nearestResistance: plan.zones?.nearestResistance ?? null,
      priceVsEntryZone: null,
      reviewKind: "15M"
    };
  }

  if (noTrade || !direction) {
    return {
      mode: "NO_TRADE",
      primaryDecision: "NO TRADE",
      headline: "NO TRADE",
      planState: "Conditions do not support a trade",
      nextAction: "Stay flat until market structure and confirmation agree.",
      direction: null,
      tone: "notrade",
      levels,
      showLevels: false,
      confirmationLabel: auth.label,
      confirmationDetail: auth.detail,
      confirmationPassed: false,
      confidenceLabel,
      lifecycleLabel,
      reason: waitReason(plan),
      technicalDetails: technicalDetails(plan),
      nearestSupport: plan.zones?.nearestSupport ?? null,
      nearestResistance: plan.zones?.nearestResistance ?? null,
      priceVsEntryZone: null,
      reviewKind: "15M"
    };
  }

  const ready = auth.supportsPlan && hasUsefulLevels(levels);
  const mode: DecisionDashboardMode =
    direction === "BUY" ? (ready ? "BUY_READY" : "POTENTIAL_BUY") : ready ? "SELL_READY" : "POTENTIAL_SELL";

  return {
    mode,
    primaryDecision: direction,
    headline: ready
      ? direction === "BUY"
        ? "BUY PLAN READY"
        : "SELL PLAN READY"
      : direction === "BUY"
        ? "POTENTIAL BUY"
        : "POTENTIAL SELL",
    planState: ready ? "5-minute confirmation passed" : "Waiting for 5-minute confirmation",
    nextAction: ready
      ? "Review your own risk before any manual entry."
      : "Wait for 5M confirmation. Do not enter just because bias or support/resistance is nearby.",
    direction,
    tone: direction === "BUY" ? "buy" : "sell",
    levels,
    showLevels: hasUsefulLevels(levels),
    confirmationLabel: auth.label,
    confirmationDetail: auth.detail,
    confirmationPassed: ready,
    confidenceLabel,
    lifecycleLabel,
    reason: sanitizePlanText(plan.oneSentence) || sanitizePlanText(plan.whyNotReady),
    technicalDetails: technicalDetails(plan),
    nearestSupport: plan.zones?.nearestSupport ?? null,
    nearestResistance: plan.zones?.nearestResistance ?? null,
    priceVsEntryZone: priceVsEntry(livePrice, levels.entry),
    reviewKind: ready ? "5M" : "5M"
  };
}
