/** Formatting helpers for Issue #50 intraday dashboard. */

export function fmtPrice(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function fmtDistance(points: number | null | undefined): string {
  if (points == null || !Number.isFinite(points)) return "—";
  const abs = Math.abs(points);
  const dir = points > 0 ? "above" : points < 0 ? "below" : "at";
  if (points === 0) return "At price";
  return `${abs.toFixed(1)} pts ${dir}`;
}

export function kindPlain(kind: string): string {
  switch (kind.toUpperCase()) {
    case "RESISTANCE":
      return "Ceiling (resistance)";
    case "SUPPORT":
      return "Floor (support)";
    case "BREAKOUT":
      return "Breakout (break and hold)";
    case "BREAKDOWN":
      return "Breakdown (break and hold lower)";
    case "TARGET":
      return "Target";
    case "STRETCH":
      return "Stretch target (estimate)";
    default:
      return kind.replace(/_/g, " ");
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
