import type { DecisionDashboardState } from "./decisionDashboardState";
import { fmtPrice } from "./intradayFormat";
import type { IntradayPlan } from "../types/intradayPlan";

/** Display chip for the premium hero — beginner-friendly, mockup-aligned. */
export type PremiumDecisionChip = "BUY" | "SELL" | "WAIT" | "PREPARE" | "NO TRADE";

export function premiumDecisionChip(
  state: DecisionDashboardState,
  plan?: IntradayPlan | null
): PremiumDecisionChip {
  if (state.mode === "WAIT") return "WAIT";
  if (state.mode === "BUY_READY") return "BUY";
  if (state.mode === "SELL_READY") return "SELL";
  if (state.mode === "POTENTIAL_BUY" || state.mode === "POTENTIAL_SELL") return "PREPARE";

  const action = String(plan?.action ?? "").toUpperCase();
  const status = String(plan?.planStatus ?? "").toUpperCase();
  if (
    action === "PREPARE" ||
    /WAITING_FOR_ENTRY|BUILDING|ARMED|WAITING_FOR_ENTRY_ZONE/.test(status)
  ) {
    return "PREPARE";
  }
  if (state.mode === "NO_TRADE") return "NO TRADE";
  return "WAIT";
}

export function premiumDecisionSubtitle(
  state: DecisionDashboardState,
  livePrice?: number | null,
  plan?: IntradayPlan | null
): string {
  const chip = premiumDecisionChip(state, plan);
  const price =
    livePrice != null && Number.isFinite(livePrice)
      ? fmtPrice(livePrice)
      : plan?.triggerPrice != null
        ? fmtPrice(plan.triggerPrice)
        : null;
  switch (chip) {
    case "WAIT":
      return "No valid trade plan yet";
    case "PREPARE":
      return price
        ? `Watch for reclaim above ${price}`
        : sanitizeOneLine(plan?.oneSentence) || "Watch the setup — confirmation still needed";
    case "BUY":
      return "Plan confirmed — look for entry zone";
    case "SELL":
      return "Bearish plan active — wait for confirmation";
    case "NO TRADE":
      return "The plan failed. Do not enter.";
    default:
      return state.planState;
  }
}

function sanitizeOneLine(value: string | null | undefined): string {
  if (!value) return "";
  // Drop parenthetical notes (fixtures / disclaimers) for compact hero copy.
  const trimmed = value.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}…` : trimmed;
}

export function premiumStatusLabel(
  state: DecisionDashboardState,
  plan?: IntradayPlan | null
): string {
  const chip = premiumDecisionChip(state, plan);
  if (chip === "WAIT" || chip === "PREPARE") return "Monitoring";
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
