/** Day Trade Range Map helpers — derive display labels from verified plan data only. */

import type { ExpectedRange, IntradayPlan, ZoneGuide } from "../types/intradayPlan";

export type RangeLocationKind =
  | "below_range"
  | "near_probable_low"
  | "inside_probable_range"
  | "near_probable_high"
  | "above_range"
  | "unknown";

export type RangeConfidenceBand = "High" | "Moderate" | "Low";

export type RangeDataMode = "Complete structure" | "Live range only" | "Mismatch" | "Unavailable";

export type RangeStatusBadge =
  | "Room to rise"
  | "Room to fall"
  | "Mid-range"
  | "Near resistance"
  | "Near support"
  | "Range incomplete"
  | "No trade";

export type RangeLevelKind =
  | "stretch-low"
  | "probable-low"
  | "current"
  | "probable-high"
  | "stretch-high";

export type RangeLevelPoint = {
  id: RangeLevelKind;
  label: string;
  shortLabel: string;
  price: number;
  estimated: boolean;
  why: string;
  testId: string;
};

export function pctAlong(value: number | null, low: number | null, high: number | null): number {
  if (value == null || low == null || high == null || high <= low) return 50;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}

export function pointsAndPercent(
  from: number | null,
  to: number | null
): { points: number | null; percent: number | null } {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) {
    return { points: null, percent: null };
  }
  const points = to - from;
  const percent = from !== 0 ? (Math.abs(points) / Math.abs(from)) * 100 : null;
  return { points, percent };
}

export function distLabel(from: number | null, to: number | null): string {
  const { points, percent } = pointsAndPercent(from, to);
  if (points == null) return "—";
  if (Math.abs(points) < 0.005) return "At price";
  const arrow = points > 0 ? "↑" : "↓";
  const pct = percent != null ? ` · ${percent.toFixed(2)}%` : "";
  return `${arrow} ${Math.abs(points).toFixed(1)} pts${pct}`;
}

export function classifyRangeLocation(range: ExpectedRange): RangeLocationKind {
  if (!range.rangeAvailable) return "unknown";
  const c = range.currentPrice;
  const lo = range.probableLow;
  const hi = range.probableHigh;
  if (c == null || lo == null || hi == null || !Number.isFinite(c) || hi < lo) return "unknown";
  if (c < lo) return "below_range";
  if (c > hi) return "above_range";
  const width = hi - lo;
  const near = width > 0 ? Math.max(0.3, width * 0.18) : 0.5;
  if (c - lo <= near) return "near_probable_low";
  if (hi - c <= near) return "near_probable_high";
  return "inside_probable_range";
}

export function rangeLocationLabel(kind: RangeLocationKind): string {
  switch (kind) {
    case "below_range":
      return "Below range";
    case "near_probable_low":
      return "Near probable low";
    case "inside_probable_range":
      return "Inside probable range";
    case "near_probable_high":
      return "Near probable high";
    case "above_range":
      return "Above range";
    default:
      return "Unknown";
  }
}

export function rangeConfidenceBand(confidence: number): RangeConfidenceBand {
  if (confidence >= 70) return "High";
  if (confidence >= 45) return "Moderate";
  return "Low";
}

export function rangeDataModeLabel(mode: string | null | undefined): RangeDataMode {
  if (mode === "COMPLETE") return "Complete structure";
  if (mode === "LIVE_RANGE_ONLY") return "Live range only";
  if (mode === "MISMATCH") return "Mismatch";
  return "Unavailable";
}

export function rangeStatusBadge(args: {
  location: RangeLocationKind;
  mode: string | null | undefined;
  rangeAvailable: boolean;
  remainingAbovePoints: number | null | undefined;
  remainingBelowPoints: number | null | undefined;
}): RangeStatusBadge {
  if (args.mode === "MISMATCH") return "No trade";
  if (args.mode === "LIVE_RANGE_ONLY" || !args.rangeAvailable || args.location === "unknown") {
    return "Range incomplete";
  }
  if (args.location === "near_probable_high" || args.location === "above_range") {
    return "Near resistance";
  }
  if (args.location === "near_probable_low" || args.location === "below_range") {
    return "Near support";
  }
  const up = args.remainingAbovePoints ?? 0;
  const down = args.remainingBelowPoints ?? 0;
  if (up > down * 1.25) return "Room to rise";
  if (down > up * 1.25) return "Room to fall";
  return "Mid-range";
}

/** Plain-language guidance from verified location + structure mode only. */
export function dayTradeGuidance(args: {
  location: RangeLocationKind;
  mode: string | null | undefined;
  rangeAvailable: boolean;
}): string {
  if (args.mode === "MISMATCH") {
    return "Price and structure disagree — NO TRADE.";
  }
  if (args.mode === "LIVE_RANGE_ONLY" || !args.rangeAvailable) {
    return "Complete structure is missing — use this range for observation only.";
  }
  switch (args.location) {
    case "near_probable_high":
    case "above_range":
      return "Price is near the probable high — avoid chasing without confirmation.";
    case "near_probable_low":
    case "below_range":
      return "Price is near probable support — watch for a confirmed hold.";
    case "inside_probable_range":
      return "Price is in the middle of the range — lower-quality entry area.";
    default:
      return "Range position is unclear — wait for verified structure before acting.";
  }
}

export function buildRangeLevels(range: ExpectedRange): RangeLevelPoint[] {
  if (
    !range.rangeAvailable ||
    range.stretchLow == null ||
    range.stretchHigh == null ||
    range.probableLow == null ||
    range.probableHigh == null ||
    range.currentPrice == null
  ) {
    return [];
  }
  return [
    {
      id: "stretch-low",
      label: "Stretch Low",
      shortLabel: "Stretch L",
      price: range.stretchLow,
      estimated: true,
      why: "Outer downside estimate. Markets can still move beyond stretch levels.",
      testId: "range-stretch-low"
    },
    {
      id: "probable-low",
      label: "Probable Low",
      shortLabel: "Prob. Low",
      price: range.probableLow,
      estimated: true,
      why: "Nearest verified support / downside bound for the current research window.",
      testId: "range-probable-low"
    },
    {
      id: "current",
      label: "Current Price",
      shortLabel: "Current",
      price: range.currentPrice,
      estimated: false,
      why: "Live / last verified price marker for the day-trade range map.",
      testId: "range-current"
    },
    {
      id: "probable-high",
      label: "Probable High",
      shortLabel: "Prob. High",
      price: range.probableHigh,
      estimated: true,
      why: "Nearest verified resistance / upside bound for the current research window.",
      testId: "range-probable-high"
    },
    {
      id: "stretch-high",
      label: "Stretch High",
      shortLabel: "Stretch H",
      price: range.stretchHigh,
      estimated: true,
      why: "Outer upside estimate. Stretch is not a guaranteed target.",
      testId: "range-stretch-high"
    }
  ];
}

/** Nearest upside/downside from zones or probable bounds — never invents prices. */
export function nearestDecisionLevels(
  range: ExpectedRange,
  zones?: ZoneGuide | null
): { upside: number | null; downside: number | null } {
  const upside =
    zones?.nearestResistance ??
    (range.currentPrice != null &&
    range.probableHigh != null &&
    range.probableHigh >= range.currentPrice
      ? range.probableHigh
      : range.stretchHigh);
  const downside =
    zones?.nearestSupport ??
    (range.currentPrice != null &&
    range.probableLow != null &&
    range.probableLow <= range.currentPrice
      ? range.probableLow
      : range.stretchLow);
  return { upside: upside ?? null, downside: downside ?? null };
}

export function nextDecisionModeMessage(mode: string | null | undefined): string | null {
  if (mode === "LIVE_RANGE_ONLY") {
    return "Range observation only — waiting for the next complete TradingView strategy signal.";
  }
  if (mode === "MISMATCH") {
    return "NO TRADE — quote and structure sources disagree.";
  }
  return null;
}

export function confirmationSummary(plan: IntradayPlan): string {
  const first = plan.entryConfirmation[0];
  if (first) return first;
  if (plan.action === "NO_TRADE") return "No trade — confirmation not applicable";
  return "Confirmation not listed";
}
