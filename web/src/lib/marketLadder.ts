/**
 * Build Market Structure Map rows from verified decision/briefing fields only.
 * Never fabricates support/resistance — only uses stored POC/VAH/VAL/price/OHLC.
 */

export type LevelKind =
  | "live"
  | "poc"
  | "vah"
  | "val"
  | "bar-high"
  | "bar-low"
  | "entry"
  | "stop"
  | "tp";

export type MarketLevelRow = {
  id: string;
  price: number;
  kind: LevelKind;
  classification: string;
  context: string;
  tone:
    | "live"
    | "poc"
    | "vah-val"
    | "resistance"
    | "support"
    | "plan"
    | "neutral";
  distance: number | null;
  position: "above" | "below" | "at" | null;
  verified: boolean;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export type LadderInput = {
  livePrice?: number | null;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
  barHigh?: number | null;
  barLow?: number | null;
  entry?: number | null;
  stop?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
};

export function buildMarketLevelLadder(input: LadderInput): MarketLevelRow[] {
  const live = num(input.livePrice);
  const rows: MarketLevelRow[] = [];

  const push = (
    id: string,
    price: number | null,
    kind: LevelKind,
    classification: string,
    context: string,
    tone: MarketLevelRow["tone"],
    verified = true
  ) => {
    if (price == null) return;
    let position: MarketLevelRow["position"] = null;
    let distance: number | null = null;
    if (live != null) {
      distance = Math.round((price - live) * 100) / 100;
      if (Math.abs(distance) < 0.05) position = "at";
      else position = distance > 0 ? "above" : "below";
    }
    rows.push({
      id,
      price,
      kind,
      classification,
      context,
      tone,
      distance,
      position,
      verified
    });
  };

  push("live", live, "live", "LIVE PRICE", "Current verified last price", "live");
  push("poc", num(input.poc), "poc", "Session POC", "Point of control", "poc");
  push("vah", num(input.vah), "vah", "VAH", "Value area high", "vah-val");
  push("val", num(input.val), "val", "VAL", "Value area low", "vah-val");

  const barHigh = num(input.barHigh);
  const barLow = num(input.barLow);
  if (barHigh != null && live != null && barHigh > live) {
    push("bar-high", barHigh, "bar-high", "Bar high", "Confirmed bar high", "resistance");
  } else if (barHigh != null) {
    push("bar-high", barHigh, "bar-high", "Bar high", "Confirmed bar high", "neutral");
  }
  if (barLow != null && live != null && barLow < live) {
    push("bar-low", barLow, "bar-low", "Bar low", "Confirmed bar low", "support");
  } else if (barLow != null) {
    push("bar-low", barLow, "bar-low", "Bar low", "Confirmed bar low", "neutral");
  }

  push("entry", num(input.entry), "entry", "Plan entry", "Shadow plan entry", "plan");
  push("stop", num(input.stop), "stop", "Plan stop", "Shadow plan stop", "plan");
  push("tp1", num(input.tp1), "tp", "TP1", "Shadow plan take-profit 1", "plan");
  push("tp2", num(input.tp2), "tp", "TP2", "Shadow plan take-profit 2", "plan");
  push("tp3", num(input.tp3), "tp", "TP3", "Shadow plan take-profit 3", "plan");

  // Sort highest price at top; stable by id for ties
  rows.sort((a, b) => b.price - a.price || a.id.localeCompare(b.id));
  return rows;
}

export function nearestLevels(rows: MarketLevelRow[]): {
  resistance: MarketLevelRow | null;
  support: MarketLevelRow | null;
} {
  const above = rows.filter((r) => r.kind !== "live" && r.position === "above");
  const below = rows.filter((r) => r.kind !== "live" && r.position === "below");
  const resistance = above.length
    ? above.reduce((best, r) =>
        best.distance == null || (r.distance != null && Math.abs(r.distance) < Math.abs(best.distance))
          ? r
          : best
      )
    : null;
  const support = below.length
    ? below.reduce((best, r) =>
        best.distance == null || (r.distance != null && Math.abs(r.distance) < Math.abs(best.distance))
          ? r
          : best
      )
    : null;
  return { resistance, support };
}
