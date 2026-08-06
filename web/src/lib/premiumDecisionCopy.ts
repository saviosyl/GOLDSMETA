import type { DecisionDashboardState } from "./decisionDashboardState";
import { fmtPrice } from "./intradayFormat";
import type { IntradayPlan } from "../types/intradayPlan";
import { looksLikeReasonCode, plainReason } from "./reasonCodePlain";

/** Display chip for the premium hero — beginner-friendly, mockup-aligned. */
export type PremiumDecisionChip =
  | "BUY"
  | "SELL"
  | "WAIT"
  | "WATCHING"
  | "PREPARE"
  | "PREPARE BUY"
  | "PREPARE SELL"
  | "BLOCKED"
  | "NO TRADE";

export function premiumDecisionChip(
  state: DecisionDashboardState,
  plan?: IntradayPlan | null
): PremiumDecisionChip {
  if (state.mode === "BUY_READY") return "BUY";
  if (state.mode === "SELL_READY") return "SELL";
  if (state.mode === "BLOCKED") return "BLOCKED";
  if (state.mode === "WATCHING") return "WATCHING";
  if (state.mode === "WAIT") return "WAIT";
  if (state.mode === "NO_TRADE") return "NO TRADE";
  if (state.mode === "POTENTIAL_BUY") return "PREPARE BUY";
  if (state.mode === "POTENTIAL_SELL") return "PREPARE SELL";

  const action = String(plan?.action ?? "").toUpperCase();
  const status = String(plan?.planStatus ?? "").toUpperCase();
  if (action === "PREPARE" || /WAITING_FOR_ENTRY|BUILDING|ARMED|WAITING_FOR_ENTRY_ZONE/.test(status)) {
    const dir = `${plan?.tradePlan?.direction ?? ""} ${plan?.actionLabel ?? ""}`.toUpperCase();
    if (dir.includes("SELL") || dir.includes("BEAR")) return "PREPARE SELL";
    if (dir.includes("BUY") || dir.includes("BULL")) return "PREPARE BUY";
    return "PREPARE";
  }
  return "WAIT";
}

export function premiumDecisionSubtitle(
  state: DecisionDashboardState,
  livePrice?: number | null,
  plan?: IntradayPlan | null
): string {
  const chip = premiumDecisionChip(state, plan);
  if (state.nextRequiredCondition && !looksLikeReasonCode(state.nextRequiredCondition)) {
    return state.nextRequiredCondition;
  }
  const price =
    livePrice != null && Number.isFinite(livePrice)
      ? fmtPrice(livePrice)
      : plan?.triggerPrice != null
        ? fmtPrice(plan.triggerPrice)
        : null;
  switch (chip) {
    case "WAIT":
      return "No meaningful setup is forming yet";
    case "WATCHING":
      return price
        ? `Price is approaching a potential setup near ${price}`
        : "Watching for a potential setup";
    case "PREPARE":
    case "PREPARE BUY":
      return price
        ? `Watch for reclaim above ${price}`
        : sanitizeOneLine(plan?.oneSentence) || "Bullish setup forming — confirmation still needed";
    case "PREPARE SELL":
      return price
        ? `Watch for breakdown below ${price}`
        : sanitizeOneLine(plan?.oneSentence) || "Bearish setup forming — confirmation still needed";
    case "BUY":
      return "Plan confirmed — look for entry zone";
    case "SELL":
      return "Bearish plan active — wait for confirmation";
    case "BLOCKED":
      return plainReason(state.reason) || "A hard safety or data issue is blocking entry";
    case "NO TRADE":
      return "The plan failed. Do not enter.";
    default:
      return state.planState;
  }
}

function sanitizeOneLine(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}…` : trimmed;
}

export function premiumStatusLabel(
  state: DecisionDashboardState,
  plan?: IntradayPlan | null
): string {
  const chip = premiumDecisionChip(state, plan);
  if (chip === "WAIT" || chip === "WATCHING" || chip === "PREPARE" || chip === "PREPARE BUY" || chip === "PREPARE SELL") {
    return "Monitoring";
  }
  if (chip === "BUY" || chip === "SELL") return "Active";
  return "Blocked";
}

export function strengthBadgeLabel(strength: string): "MEDIUM" | "HIGH" | "STRONG" | "MINOR" {
  const s = strength.toUpperCase();
  if (s === "MAJOR" || s === "STRONG") return "STRONG";
  if (s === "MODERATE") return "MEDIUM";
  if (s === "HIGH") return "HIGH";
  return "MINOR";
}

/** Rename confidence presentation to setup quality (not probability of profit). */
export function setupQualityLabel(
  confidence: number | null | undefined,
  readyThreshold = 80
): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return `Setup quality: ${Math.round(confidence)}% · Required for ready: ${readyThreshold}%`;
}
