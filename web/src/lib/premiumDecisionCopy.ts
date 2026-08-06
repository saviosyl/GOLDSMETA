import type { DecisionDashboardState } from "./decisionDashboardState";
import { DIRECTION_DISPLAY_THRESHOLD } from "./decisionDashboardState";
import { fmtPrice } from "./intradayFormat";
import type { IntradayPlan } from "../types/intradayPlan";
import { looksLikeReasonCode, plainReason } from "./reasonCodePlain";

/** Display chip for the premium hero — beginner-friendly. */
export type PremiumDecisionChip =
  | "BUY"
  | "SELL"
  | "WAIT"
  | "WATCHING"
  | "PREPARE"
  | "PREPARE BUY"
  | "PREPARE SELL"
  | "HOLD"
  | "NO TRADE";

export function premiumDecisionChip(
  state: DecisionDashboardState,
  plan?: IntradayPlan | null
): PremiumDecisionChip {
  // From 65% setup quality, prefer clear BUY/SELL on the dashboard.
  if (
    state.direction &&
    state.confidencePercent != null &&
    state.confidencePercent >= DIRECTION_DISPLAY_THRESHOLD &&
    (state.mode === "BUY_READY" ||
      state.mode === "SELL_READY" ||
      state.mode === "POTENTIAL_BUY" ||
      state.mode === "POTENTIAL_SELL")
  ) {
    return state.direction;
  }

  if (state.mode === "BUY_READY") return "BUY";
  if (state.mode === "SELL_READY") return "SELL";
  if (state.mode === "HOLD") return "HOLD";
  if (state.mode === "WATCHING") return "WATCHING";
  if (state.mode === "WAIT") return "WAIT";
  if (state.mode === "NO_TRADE") return "HOLD";
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
      return state.mode === "BUY_READY"
        ? "Plan confirmed — look for entry zone"
        : state.nextRequiredCondition || "Bullish bias — review levels before any manual entry";
    case "SELL":
      return state.mode === "SELL_READY"
        ? "Bearish plan active — review entry carefully"
        : state.nextRequiredCondition || "Bearish bias — review levels before any manual entry";
    case "HOLD":
      return plainReason(state.reason) || "Stand aside until the setup is clear";
    case "NO TRADE":
      return "Stand aside until the setup is clear";
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
  if (chip === "BUY" || chip === "SELL") {
    return state.mode === "BUY_READY" || state.mode === "SELL_READY" ? "Active" : "Forming";
  }
  if (
    chip === "WAIT" ||
    chip === "WATCHING" ||
    chip === "PREPARE" ||
    chip === "PREPARE BUY" ||
    chip === "PREPARE SELL"
  ) {
    return "Monitoring";
  }
  if (chip === "HOLD") return "On hold";
  return "Monitoring";
}

/** Build stamp helper — forces a fresh hashed asset after CDN poison recoveries. */
export const PREMIUM_STATUS_COPY_VERSION = "hold-v3";

export function strengthBadgeLabel(strength: string): "MEDIUM" | "HIGH" | "STRONG" | "MINOR" {
  const s = strength.toUpperCase();
  if (s === "MAJOR" || s === "STRONG") return "STRONG";
  if (s === "MODERATE") return "MEDIUM";
  if (s === "HIGH") return "HIGH";
  return "MINOR";
}

/** Full setup-quality line for secondary facts (not the hero). */
export function setupQualityLabel(
  confidence: number | null | undefined,
  readyThreshold = DIRECTION_DISPLAY_THRESHOLD
): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return `Setup quality: ${Math.round(confidence)}% · Direction from ${readyThreshold}%`;
}
