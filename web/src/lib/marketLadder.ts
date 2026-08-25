/**
 * Build Market Structure Map rows from verified decision/briefing fields only.
 * Never fabricates support/resistance — only uses stored POC/VAH/VAL/price/OHLC.
 * Never labels a price LIVE unless the caller marks it as a verified live source.
 */

import {
  detectLadderPriceMismatch,
  livePriceLabel,
  type PriceMismatchState
} from "./priceConsistency";

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
  source?: string | null;
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
  /** Explicit TradingView alert close for mismatch copy. */
  alertClose?: number | null;
  /** Only set when price is from a verified fresh LIVE broker/market source. */
  dataSourceLabel?: string | null;
  isTestDecision?: boolean | null;
  marketDataTime?: string | null;
  priceSource?: string | null;
  isUiReviewFixture?: boolean | null;
  brokerQuoteVerified?: boolean | null;
  marketStatus?: "OPEN" | "CLOSED" | "UNKNOWN" | null;
  /** When true, only show live/bar high/low — incomplete strategy signal. */
  liveRangeOnly?: boolean | null;
};

export type LadderBuildResult = {
  rows: MarketLevelRow[];
  mismatch: PriceMismatchState | null;
  liveLabel: ReturnType<typeof livePriceLabel>;
};

export function buildMarketLevelLadder(input: LadderInput): MarketLevelRow[] {
  return buildMarketLevelLadderDetailed(input).rows;
}

export function buildMarketLevelLadderDetailed(input: LadderInput): LadderBuildResult {
  const mismatch = detectLadderPriceMismatch(input);
  const liveLabel = livePriceLabel({
    dataSourceLabel: input.dataSourceLabel,
    isTestDecision: input.isTestDecision,
    marketDataTime: input.marketDataTime,
    isUiReviewFixture: input.isUiReviewFixture,
    brokerQuoteVerified: input.brokerQuoteVerified,
    marketStatus: input.marketStatus
  });

  // On mismatch, do not render a combined ladder — caller shows the error state.
  if (mismatch) {
    return { rows: [], mismatch, liveLabel };
  }

  const live = num(input.livePrice);
  const rows: MarketLevelRow[] = [];
  const source = input.priceSource ?? input.dataSourceLabel ?? null;
  const liveRangeOnly = Boolean(input.liveRangeOnly);

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
      verified,
      source
    });
  };

  if (live != null) {
    push(
      "live",
      live,
      "live",
      liveLabel,
      liveLabel === "LIVE PRICE"
        ? "Verified fresh market/broker last price"
        : liveLabel === "Test fixture price"
          ? "TEST FIXTURE — NOT LIVE BROKER DATA"
          : "Stored price — not labelled as live",
      liveLabel === "LIVE PRICE" ? "live" : "neutral",
      liveLabel === "LIVE PRICE"
    );
  }

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

  // Incomplete OHLC-only events: do not present fabricated/absent strategy levels.
  if (!liveRangeOnly) {
    push("poc", num(input.poc), "poc", "Session POC", "Point of control", "poc");
    push("vah", num(input.vah), "vah", "VAH", "Value area high", "vah-val");
    push("val", num(input.val), "val", "VAL", "Value area low", "vah-val");
    push("entry", num(input.entry), "entry", "Plan entry", "Shadow plan entry", "plan");
    push("stop", num(input.stop), "stop", "Plan stop", "Shadow plan stop", "plan");
    push("tp1", num(input.tp1), "tp", "TP1", "Shadow plan take-profit 1", "plan");
    push("tp2", num(input.tp2), "tp", "TP2", "Shadow plan take-profit 2", "plan");
    push("tp3", num(input.tp3), "tp", "TP3", "Shadow plan take-profit 3", "plan");
  }

  rows.sort((a, b) => b.price - a.price || a.id.localeCompare(b.id));
  return { rows, mismatch: null, liveLabel };
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
