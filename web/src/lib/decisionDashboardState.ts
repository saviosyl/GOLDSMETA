import type { IntradayPlan } from "../types/intradayPlan";
import { resolveAuthoritativeConfirmation } from "./confirmationAuthority";
import { fmtPrice } from "./intradayFormat";
import { isNoValidIntradayPlan, sanitizePlanText } from "./planTextFormat";
import { looksLikeReasonCode, plainReason } from "./reasonCodePlain";

/** Show BUY/SELL on the hero once setup quality reaches this (not a profit probability). */
export const DIRECTION_DISPLAY_THRESHOLD = 65;

function setupQualityLabel(confidence: number | null | undefined): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return `${Math.round(confidence)}% confidence`;
}

export type DecisionDashboardMode =
  | "WAIT"
  | "WATCHING"
  | "POTENTIAL_BUY"
  | "POTENTIAL_SELL"
  | "BUY_READY"
  | "SELL_READY"
  | "HOLD"
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
  primaryDecision: "BUY" | "SELL" | "WAIT" | "NO TRADE" | "HOLD" | "WATCHING";
  headline: string;
  planState: string;
  nextAction: string;
  nextRequiredCondition: string | null;
  direction: "BUY" | "SELL" | null;
  tone: "buy" | "sell" | "wait" | "notrade";
  levels: DecisionDashboardLevelSet;
  showLevels: boolean;
  confirmationLabel: string;
  confirmationDetail: string;
  confirmationPassed: boolean;
  confidenceLabel: string | null;
  confidencePercent: number | null;
  lifecycleLabel: string | null;
  reason: string;
  technicalDetails: string[];
  nearestSupport: number | null;
  nearestResistance: number | null;
  priceVsEntryZone: string | null;
  reviewKind: "15M" | "5M";
  freshnessLines: string[];
};

/** Infer BUY/SELL lean from plan fields — never invents levels, only reads verified bias/confirmation. */
export function directionFromPlan(plan: IntradayPlan): "BUY" | "SELL" | null {
  const raw = `${plan.tradePlan?.direction ?? ""} ${plan.action ?? ""} ${plan.actionLabel ?? ""}`.toUpperCase();
  if (raw.includes("BUY") || raw.includes("BULL")) return "BUY";
  if (raw.includes("SELL") || raw.includes("BEAR")) return "SELL";

  const scenario = String(plan.primaryScenarioSide ?? "").toLowerCase();
  if (scenario === "bullish") return "BUY";
  if (scenario === "bearish") return "SELL";

  const bias = String(plan.directionBias ?? "").toUpperCase();
  if (bias.includes("BULL")) return "BUY";
  if (bias.includes("BEAR")) return "SELL";

  const confirm = String(
    plan.confirmation5m?.state ?? plan.confirmation5m?.label ?? ""
  ).toUpperCase();
  // Breakout without an explicit bearish tag leans long; rejection leans short.
  if (confirm.includes("REJECTION") && !confirm.includes("BULLISH")) return "SELL";
  if (confirm.includes("BREAKOUT") && !confirm.includes("BEARISH")) return "BUY";

  return null;
}

/** Short lean text for HOLD/WAIT heroes — bias only, not an entry signal. */
export function leanConfidenceLabel(
  confidencePercent: number | null | undefined,
  direction: "BUY" | "SELL" | null | undefined
): string | null {
  if (typeof confidencePercent !== "number" || !Number.isFinite(confidencePercent)) return null;
  const pct = `${Math.round(confidencePercent)}% confidence`;
  if (direction === "BUY") return `${pct} · BUY lean`;
  if (direction === "SELL") return `${pct} · SELL lean`;
  return pct;
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

/** True hard safety that must not advertise a tradeable BUY/SELL. */
function isFatalGeometry(plan: IntradayPlan): boolean {
  const codes = [
    ...(plan.geometryReasonCodes ?? []),
    ...(plan.planQuality?.reasons ?? [])
  ].map((c) => String(c).toUpperCase());
  return codes.some((c) =>
    /INVALID_TARGET_ORDER|WRONG_SIDE|STOP_TOO_TIGHT|MISSING_REQUIRED_LEVEL|ENTRY_EQUALS_STOP|ZERO_RISK/.test(
      c
    )
  );
}

function isDataConflict(plan: IntradayPlan, marketStructureMode?: string | null): boolean {
  const codes = [
    ...(plan.geometryReasonCodes ?? []),
    ...(plan.planQuality?.reasons ?? [])
  ].map((c) => String(c).toUpperCase());
  const mode = String(marketStructureMode ?? plan.freshness?.marketStructureMode ?? "").toUpperCase();
  if (mode === "MISMATCH") return true;
  return codes.some((c) =>
    /HARD_CONFLICT|PRICE_SOURCE_MISMATCH|CONFIRM_PLAN_SOURCE_KEY_MISMATCH|OUT_OF_ORDER_DATA/.test(c)
  );
}

function qualityPercent(plan: IntradayPlan): number | null {
  return typeof plan.confidence === "number" && Number.isFinite(plan.confidence)
    ? plan.confidence
    : null;
}

function meetsDirectionThreshold(plan: IntradayPlan): boolean {
  const q = qualityPercent(plan);
  return q != null && q >= DIRECTION_DISPLAY_THRESHOLD;
}

function nextCondition(
  plan: IntradayPlan,
  direction: "BUY" | "SELL" | null,
  authSupports: boolean,
  livePrice?: number | null
): string | null {
  const codes = (plan.planQuality?.reasons ?? []).map((c) => String(c).toUpperCase());
  if (codes.some((c) => /AWAITING_5M|MISSING_CONFIRMATION/.test(c)) || !authSupports) {
    const level =
      plan.triggerPrice != null
        ? fmtPrice(plan.triggerPrice)
        : plan.zones?.nearestResistance != null && direction === "BUY"
          ? fmtPrice(plan.zones.nearestResistance)
          : plan.zones?.nearestSupport != null && direction === "SELL"
            ? fmtPrice(plan.zones.nearestSupport)
            : null;
    if (direction === "BUY" && level) {
      return `Waiting for the current 5M candle to close above ${level}.`;
    }
    if (direction === "SELL" && level) {
      return `Waiting for the current 5M candle to close below ${level}.`;
    }
    return "Waiting for 15M and 5M trend direction to agree.";
  }
  if (codes.some((c) => /SOFT_DISAGREEMENT/.test(c))) {
    return "Waiting for 15M and 5M trend direction to agree.";
  }
  const support = plan.zones?.nearestSupport;
  if (direction === "BUY" && support != null && livePrice != null && livePrice > support + 0.5) {
    return `Waiting for price to return to support at ${fmtPrice(support)}.`;
  }
  const resistance = plan.zones?.nearestResistance;
  if (
    direction === "SELL" &&
    resistance != null &&
    livePrice != null &&
    livePrice < resistance - 0.5
  ) {
    return `Waiting for price to return to resistance at ${fmtPrice(resistance)}.`;
  }
  const plain = waitReason(plan);
  return looksLikeReasonCode(plain) ? null : plain;
}

function approachingSetup(
  plan: IntradayPlan,
  livePrice: number | null | undefined,
  direction: "BUY" | "SELL" | null
): boolean {
  if (livePrice == null || !Number.isFinite(livePrice)) return false;
  const support = plan.zones?.nearestSupport;
  const resistance = plan.zones?.nearestResistance;
  if (direction === "BUY" && support != null && Math.abs(livePrice - support) <= 8) return true;
  if (direction === "SELL" && resistance != null && Math.abs(livePrice - resistance) <= 8) {
    return true;
  }
  if (!direction && support != null && Math.abs(livePrice - support) <= 5) return true;
  if (!direction && resistance != null && Math.abs(livePrice - resistance) <= 5) return true;
  return false;
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
  const fatalGeometry = isFatalGeometry(plan);
  const dataConflict = isDataConflict(plan, marketStructureMode);
  const showDirection = Boolean(direction && meetsDirectionThreshold(plan) && !fatalGeometry);
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
  const confidencePercent = qualityPercent(plan);
  const confidenceLabel = setupQualityLabel(plan.confidence);
  const lifecycleLabel = plan.planStatus ? String(plan.planStatus).replace(/_/g, " ") : null;
  const freshnessLines: string[] = [];
  const base = {
    levels,
    confirmationLabel: auth.label,
    confirmationDetail: auth.detail,
    confirmationPassed: false,
    confidenceLabel,
    confidencePercent,
    lifecycleLabel,
    reason: waitReason(plan),
    technicalDetails: technicalDetails(plan),
    nearestSupport: plan.zones?.nearestSupport ?? null,
    nearestResistance: plan.zones?.nearestResistance ?? null,
    priceVsEntryZone: null as string | null,
    reviewKind: "15M" as const,
    freshnessLines
  };

  // At 65%+ with a direction: prefer BUY/SELL on the hero — never the old "Blocked" status.
  if (showDirection && direction) {
    const ready =
      auth.supportsPlan && hasUsefulLevels(levels) && !fatalGeometry && !dataConflict;
    const next = nextCondition(plan, direction, auth.supportsPlan, livePrice);
    const caution =
      dataConflict || noTrade
        ? "Stay cautious — structure sources still need to agree before acting."
        : next;

    if (ready) {
      return {
        ...base,
        mode: direction === "BUY" ? "BUY_READY" : "SELL_READY",
        primaryDecision: direction,
        headline: direction === "BUY" ? "BUY" : "SELL",
        planState: "5-minute confirmation passed",
        nextAction: "Review your own risk before any manual entry.",
        nextRequiredCondition: null,
        direction,
        tone: direction === "BUY" ? "buy" : "sell",
        showLevels: hasUsefulLevels(levels),
        confirmationPassed: true,
        priceVsEntryZone: priceVsEntry(livePrice, levels.entry),
        reviewKind: "5M"
      };
    }

    return {
      ...base,
      mode: direction === "BUY" ? "POTENTIAL_BUY" : "POTENTIAL_SELL",
      primaryDecision: direction,
      headline: direction,
      planState: caution || "Setup forming — review levels before acting",
      nextAction: caution || "Wait for confirmation. Do not enter on bias alone.",
      nextRequiredCondition: caution,
      direction,
      tone: direction === "BUY" ? "buy" : "sell",
      showLevels: hasUsefulLevels(levels),
      confirmationPassed: auth.supportsPlan,
      priceVsEntryZone: priceVsEntry(livePrice, levels.entry),
      reviewKind: "5M"
    };
  }

  // Soft hold — only when we cannot show a direction (no 65%+ bias).
  if ((fatalGeometry || dataConflict) && (hasUsefulLevels(levels) || noTrade) && !showDirection) {
    const next = nextCondition(plan, direction, false, livePrice);
    return {
      ...base,
      mode: "HOLD",
      primaryDecision: "HOLD",
      headline: "HOLD",
      planState: "Stand aside until the setup is clear",
      nextAction: next || "Stay flat until structure and confirmation agree.",
      nextRequiredCondition: next,
      direction,
      tone: "wait",
      showLevels: false,
      confirmationPassed: false
    };
  }

  if (noValid) {
    const watching = approachingSetup(plan, livePrice, direction);
    const next = nextCondition(plan, direction, false, livePrice);
    if (watching) {
      return {
        ...base,
        mode: "WATCHING",
        primaryDecision: "WATCHING",
        headline: "WATCHING",
        planState: "Price is approaching a potential setup",
        nextAction: next || "GoldMeta is watching XAUUSD for a clearer trigger.",
        nextRequiredCondition: next,
        direction,
        tone: "wait",
        showLevels: false
      };
    }
    return {
      ...base,
      mode: "WAIT",
      primaryDecision: "WAIT",
      headline: "WAIT",
      planState: "No meaningful setup is forming yet",
      nextAction:
        next ||
        "GoldMeta is monitoring XAUUSD. You can be notified when a valid opportunity becomes ready.",
      nextRequiredCondition: next,
      direction: null,
      tone: "wait",
      showLevels: false,
      confirmationLabel: "5M confirmation not required yet",
      confirmationDetail: "A valid 15M plan must appear before entry confirmation matters."
    };
  }

  if (noTrade || !direction) {
    const next = nextCondition(plan, direction, auth.supportsPlan, livePrice);
    return {
      ...base,
      mode: "HOLD",
      primaryDecision: "HOLD",
      headline: "HOLD",
      planState: direction
        ? direction === "BUY"
          ? "Bullish lean — stay flat until confirmation agrees"
          : "Bearish lean — stay flat until confirmation agrees"
        : "Stand aside until the setup is clear",
      nextAction: next || "Stay flat until market structure and confirmation agree.",
      nextRequiredCondition:
        next || "Waiting for 15M and 5M trend direction to agree.",
      // Keep lean when known so the hero can show “94% confidence · BUY lean”.
      direction,
      tone: "wait",
      showLevels: false
    };
  }

  // Direction below 65% — show PREPARE path, not HOLD/BLOCKED.
  const ready = auth.supportsPlan && hasUsefulLevels(levels) && !fatalGeometry;
  const mode: DecisionDashboardMode =
    direction === "BUY" ? (ready ? "BUY_READY" : "POTENTIAL_BUY") : ready ? "SELL_READY" : "POTENTIAL_SELL";
  const next = nextCondition(plan, direction, auth.supportsPlan, livePrice);

  return {
    ...base,
    mode,
    primaryDecision: direction,
    headline: ready ? direction : direction === "BUY" ? "PREPARE BUY" : "PREPARE SELL",
    planState: ready ? "5-minute confirmation passed" : "Setup forming — confirmation still needed",
    nextAction: ready
      ? "Review your own risk before any manual entry."
      : next || "Wait for 5M confirmation. Do not enter just because bias or levels are nearby.",
    nextRequiredCondition: ready ? null : next,
    direction,
    tone: direction === "BUY" ? "buy" : "sell",
    showLevels: hasUsefulLevels(levels),
    confirmationPassed: ready,
    priceVsEntryZone: priceVsEntry(livePrice, levels.entry),
    reviewKind: "5M"
  };
}
