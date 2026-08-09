/** Formatting helpers for Issue #50 intraday dashboard. */

export function fmtPrice(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  // Always en-US grouping so 4077.816 → "4,077.82" (never truncated "407.816").
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function fmtSignedDistance(points: number | null | undefined): string {
  if (points == null || !Number.isFinite(points)) return "—";
  if (Math.abs(points) < 0.005) return "At price";
  const arrow = points > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(points).toFixed(2)} points`;
}

export function rolePlain(role: string): string {
  switch (role) {
    case "SUPPORT":
      return "Floor (support)";
    case "RESISTANCE":
      return "Ceiling (resistance)";
    case "RECLAIM_LEVEL":
      return "Reclaim level / first resistance";
    case "BREAKDOWN_LEVEL":
      return "Breakdown level";
    case "BREAKOUT_LEVEL":
      return "Breakout level";
    case "MAGNET":
      return "Magnet / decision point";
    case "TARGET":
      return "Target";
    case "INVALIDATION":
      return "Invalidation";
    case "STRETCH_ESTIMATE":
      return "Stretch estimate";
    case "PREVIOUS_SUPPORT_NOW_RESISTANCE":
      return "Previous support — now reclaim/resistance";
    case "PREVIOUS_RESISTANCE_NOW_SUPPORT":
      return "Previous resistance — potential support after retest";
    default:
      return role.replace(/_/g, " ");
  }
}

export function actionTone(
  action: string
): "buy" | "sell" | "prepare" | "range" | "none" {
  const a = action.toUpperCase();
  if (a.startsWith("BUY")) return "buy";
  if (a.startsWith("SELL")) return "sell";
  if (a === "RANGE_TRADE") return "range";
  if (a === "PREPARE") return "prepare";
  return "none";
}

export function biasLabel(bias: string): string {
  return bias.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function marketTypeLabel(t: string): string {
  return t.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function confidenceLabel(pct: number): string {
  if (pct >= 80) return "High";
  if (pct >= 60) return "Moderate";
  if (pct >= 40) return "Cautious";
  return "Low";
}

export function valueLocationLabel(loc: string | undefined): string {
  switch (loc) {
    case "BELOW_VALUE":
      return "Below value";
    case "ABOVE_VALUE":
      return "Above value";
    case "INSIDE_VALUE":
      return "Inside value";
    case "ABOVE_POC":
      return "Above POC";
    case "BELOW_POC":
      return "Below POC";
    case "NEAR_VAH":
    case "AT_VAH":
      return "Near resistance";
    case "NEAR_VAL":
    case "AT_VAL":
      return "Near support";
    case "UNKNOWN":
    case undefined:
    case "":
      return "Context unavailable";
    default:
      return "Context unavailable";
  }
}
