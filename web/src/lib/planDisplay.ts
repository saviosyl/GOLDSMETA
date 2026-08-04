/**
 * Display helpers for Today's Intraday Plan — colour, icons, NOW gating.
 * Never invents market levels; only reshapes verified plan fields for UI.
 */

import type {
  ChecklistMark,
  Confirmation5M,
  IntradayAction,
  IntradayPlan,
  SetupChecklistItem,
  TimeframeAlignment
} from "../types/intradayPlan";
import { shortActionLabel } from "./cockpitHelpers";

/** Colour tokens: GREEN buy, AMBER wait, RED sell, DARK RED no trade, GREY unavailable, NAVY info */
export type PlanColourTone =
  | "buy"
  | "wait"
  | "sell"
  | "notrade"
  | "unavailable"
  | "info";

export type PlanDisplayAction = {
  action: IntradayAction | string;
  shortLabel: string;
  fullLabel: string;
  tone: PlanColourTone;
  icon: string;
  /** True when BUY NOW / SELL NOW were demoted because checklist incomplete */
  demotedFromNow: boolean;
};

export function checklistMark(item: SetupChecklistItem): ChecklistMark {
  if (item.mark === "pass" || item.mark === "pending" || item.mark === "fail") {
    return item.mark;
  }
  return item.complete ? "pass" : "pending";
}

export function checklistMarkGlyph(mark: ChecklistMark): string {
  if (mark === "pass") return "✓";
  if (mark === "fail") return "✕";
  return "○";
}

export function allMandatoryConditionsPass(plan: IntradayPlan): boolean {
  const items = plan.setupProgress?.items ?? [];
  if (items.length === 0) {
    return (
      plan.setupProgress.complete >= plan.setupProgress.total && plan.setupProgress.total > 0
    );
  }
  return items.every((item) => checklistMark(item) === "pass");
}

export function planColourTone(action: string, opts?: { unavailable?: boolean }): PlanColourTone {
  if (opts?.unavailable) return "unavailable";
  const a = action.toUpperCase();
  if (a === "NO_TRADE" || a === "INVALIDATED" || a === "EXPIRED") return "notrade";
  if (a.startsWith("BUY")) return "buy";
  if (a.startsWith("SELL")) return "sell";
  if (a === "RANGE_TRADE") return "info";
  if (a === "PREPARE" || a === "WAIT") return "wait";
  if (a === "UNAVAILABLE" || a === "UNKNOWN") return "unavailable";
  return "info";
}

export function toneIcon(tone: PlanColourTone): string {
  switch (tone) {
    case "buy":
      return "▲";
    case "sell":
      return "▼";
    case "wait":
      return "◐";
    case "notrade":
      return "⛔";
    case "unavailable":
      return "–";
    case "info":
    default:
      return "◆";
  }
}

/**
 * BUY NOW / SELL NOW only when all mandatory checklist conditions pass.
 * Incomplete → demote to PREPARE / wait tone (never invent a new market plan).
 */
export function resolveDisplayAction(plan: IntradayPlan): PlanDisplayAction {
  const raw = String(plan.action).toUpperCase();
  const nowAction = raw === "BUY_NOW" || raw === "SELL_NOW";
  const pass = allMandatoryConditionsPass(plan);
  const demoted = nowAction && !pass;
  const action = demoted ? "PREPARE" : plan.action;
  const shortLabel = demoted
    ? "WAIT"
    : shortActionLabel(plan.action, plan.actionLabel);
  const fullLabel = demoted
    ? "WAIT — CONDITIONS INCOMPLETE"
    : plan.actionLabel;
  const tone = planColourTone(String(action), {
    unavailable: plan.freshness?.marketStructureMode === "UNAVAILABLE"
  });
  return {
    action,
    shortLabel,
    fullLabel,
    tone,
    icon: toneIcon(tone),
    demotedFromNow: demoted
  };
}

/** Map legacy actionTone values onto the plan colour system. */
export function actionToneToPlanColour(
  legacy: "buy" | "sell" | "prepare" | "range" | "none"
): PlanColourTone {
  switch (legacy) {
    case "buy":
      return "buy";
    case "sell":
      return "sell";
    case "prepare":
      return "wait";
    case "range":
      return "info";
    case "none":
    default:
      return "notrade";
  }
}

export function deriveConfirmation5m(
  plan: IntradayPlan,
  decisionConfirmation?: string | null
): Confirmation5M {
  if (plan.confirmation5m) return plan.confirmation5m;

  const item = plan.setupProgress.items.find((i) => i.id === "confirmation");
  const cls = (decisionConfirmation || item?.detail || "").toUpperCase();
  const meaningfulStates = [
    "BREAKOUT",
    "REJECTION",
    "RETEST",
    "CONFIRMED",
    "FAILED",
    "HELD"
  ];
  const hasMeaningful = meaningfulStates.some((s) => cls.includes(s));
  const mark = item ? checklistMark(item) : "pending";

  if (!hasMeaningful && mark !== "pass") {
    return {
      state: "NONE",
      label: "No meaningful 5M confirmation yet",
      meaningful: false,
      detail: item?.detail ?? "Waiting for a confirmed 5-minute state change."
    };
  }

  let state = "OUTSIDE_ZONE";
  if (cls.includes("BREAKOUT")) state = "BREAKOUT_CONFIRMED";
  else if (cls.includes("REJECTION")) state = "REJECTION_CONFIRMED";
  else if (cls.includes("RETEST") && cls.includes("HELD")) state = "RETEST_HELD";
  else if (cls.includes("FAILED")) state = "CONFIRMATION_FAILED";
  else if (mark === "pass") state = "BREAKOUT_CONFIRMED";

  return {
    state,
    label: state.replace(/_/g, " "),
    meaningful: true,
    detail: item?.detail ?? plan.entryConfirmation[0] ?? null
  };
}

export function confirmationTone(state: string | null | undefined): PlanColourTone {
  const s = (state || "").toUpperCase();
  if (!s || s === "NONE" || s === "UNAVAILABLE") return "unavailable";
  if (s.includes("FAILED") || s.includes("INVALID")) return "notrade";
  if (s.includes("BREAKOUT") || s.includes("HELD") || s.includes("CONFIRMED")) {
    if (s.includes("REJECTION")) return "sell";
    return "buy";
  }
  if (s.includes("REJECTION")) return "sell";
  if (s.includes("PENDING") || s.includes("APPROACHING") || s.includes("INSIDE")) return "wait";
  return "info";
}

export function deriveTimeframeAlignment(plan: IntradayPlan): TimeframeAlignment {
  if (plan.timeframeAlignment?.cells?.length) {
    return plan.timeframeAlignment;
  }

  const bias = plan.directionBias;
  const biasTone: PlanColourTone = bias.includes("BULL")
    ? "buy"
    : bias.includes("BEAR")
      ? "sell"
      : "wait";
  const biasLabel = bias.replace(/_/g, " ");

  const cells = [
    {
      timeframe: "4H",
      direction: biasLabel,
      structure: plan.marketType,
      label: "Wider context",
      tone: biasTone === "wait" ? "info" : biasTone
    },
    {
      timeframe: "1H",
      direction: biasLabel,
      structure: null,
      label: "Main bias",
      tone: biasTone
    },
    {
      timeframe: "15M",
      direction: plan.actionLabel,
      structure: plan.marketType,
      label: "Plan structure",
      tone: planColourTone(plan.action)
    },
    {
      timeframe: "5M",
      direction: plan.setupProgress.items.find((i) => i.id === "confirmation")?.detail ?? "Pending",
      structure: null,
      label: "Entry confirm",
      tone: plan.setupProgress.items.find((i) => i.id === "confirmation")?.complete
        ? planColourTone(plan.action)
        : "wait"
    }
  ] as TimeframeAlignment["cells"];

  const conclusion = buildAlignmentConclusion(plan, biasTone);
  return { cells, conclusion };
}

function buildAlignmentConclusion(plan: IntradayPlan, biasTone: PlanColourTone): string {
  if (plan.timeframeAlignment?.conclusion) return plan.timeframeAlignment.conclusion;
  if (plan.action === "NO_TRADE") {
    return "Timeframes do not support a trade — stay flat until structure clears.";
  }
  if (plan.action === "BUY_NOW" && allMandatoryConditionsPass(plan)) {
    return "Higher timeframes and 5M confirmation align for a manual buy plan.";
  }
  if (plan.action === "SELL_NOW" && allMandatoryConditionsPass(plan)) {
    return "Higher timeframes and 5M confirmation align for a manual sell plan.";
  }
  if (biasTone === "buy") {
    return "Bias leans bullish — wait for trigger and 5M confirmation before acting.";
  }
  if (biasTone === "sell") {
    return "Bias leans bearish — wait for trigger and 5M confirmation before acting.";
  }
  return "Mixed or neutral alignment — prefer patience over forcing an entry.";
}

export function primaryScenarioSide(
  plan: IntradayPlan
): "bullish" | "bearish" | "none" {
  if (plan.primaryScenarioSide === "bullish" || plan.primaryScenarioSide === "bearish") {
    return plan.primaryScenarioSide;
  }
  if (plan.primaryScenarioSide === "none") return "none";
  if (plan.tradePlan.direction === "BUY") return "bullish";
  if (plan.tradePlan.direction === "SELL") return "bearish";
  if (plan.directionBias.includes("BULL")) return "bullish";
  if (plan.directionBias.includes("BEAR")) return "bearish";
  if (String(plan.action).startsWith("BUY")) return "bullish";
  if (String(plan.action).startsWith("SELL")) return "bearish";
  return "none";
}

export function planStatusLabel(status: string | null | undefined): string {
  if (!status) return "Plan status unavailable";
  return status.replace(/_/g, " ");
}
