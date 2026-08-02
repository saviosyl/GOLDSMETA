/**
 * Client-side price-source consistency for Market Structure Map.
 * Mirrors backend tolerance — never mix ~2400 fixture OHLC with ~4050 alert levels.
 */

export const XAUUSD_PRICE_CONSISTENCY_TOLERANCE = 0.02;

export type PriceSourceMeta = {
  source: string;
  symbol: string;
  exchangeOrBroker: string | null;
  timeframe: string | null;
  timestamp: string | null;
  receivedAt: string;
  quoteAgeSeconds: number | null;
};

export type PriceMismatchState = {
  mismatch: true;
  alertClose: number;
  comparisonPrice: number;
  comparisonLabel: string;
  relativeDiff: number;
  message: string;
};

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function relativePriceDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(b), Math.abs(a), 1e-9);
  return Math.abs(a - b) / denom;
}

export function pricesAreConsistent(
  a: number | null | undefined,
  b: number | null | undefined,
  tolerance = XAUUSD_PRICE_CONSISTENCY_TOLERANCE
): boolean {
  const pa = positive(a);
  const pb = positive(b);
  if (pa == null || pb == null) return true;
  return relativePriceDiff(pa, pb) <= tolerance;
}

export function detectLadderPriceMismatch(input: {
  livePrice?: number | null;
  /** Explicit TradingView alert close when known (preferred over inferring from POC). */
  alertClose?: number | null;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
  barHigh?: number | null;
  barLow?: number | null;
  tolerance?: number;
}): PriceMismatchState | null {
  const tolerance = input.tolerance ?? XAUUSD_PRICE_CONSISTENCY_TOLERANCE;
  const live = positive(input.livePrice);
  const explicitAlert = positive(input.alertClose);
  const peers: Array<{ label: string; price: number }> = [];
  for (const [label, raw] of [
    ["alert close", explicitAlert],
    ["POC", input.poc],
    ["VAH", input.vah],
    ["VAL", input.val],
    ["bar high", input.barHigh],
    ["bar low", input.barLow]
  ] as const) {
    const p = positive(raw);
    if (p != null) peers.push({ label, price: p });
  }
  if (live == null || peers.length === 0) return null;

  let worst: { label: string; price: number; relativeDiff: number } | null = null;
  for (const peer of peers) {
    if (peer.label === "alert close" && peer.price === live) continue;
    const d = relativePriceDiff(live, peer.price);
    if (d > tolerance && (!worst || d > worst.relativeDiff)) {
      worst = { label: peer.label, price: peer.price, relativeDiff: d };
    }
  }
  if (!worst) return null;

  // Prefer explicit TradingView alert close for the error copy when available.
  const alertClose =
    explicitAlert != null && relativePriceDiff(explicitAlert, live) > tolerance
      ? explicitAlert
      : worst.price > live
        ? worst.price
        : live;
  const comparisonPrice = alertClose === live ? worst.price : live;
  const comparisonLabel =
    alertClose === live ? worst.label : "Broker/live or stored price";

  return {
    mismatch: true,
    alertClose,
    comparisonPrice,
    comparisonLabel,
    relativeDiff: worst.relativeDiff,
    message: `Market data mismatch\n\nTradingView alert price: ${alertClose.toFixed(2)}\nBroker/live price: ${comparisonPrice.toFixed(2)}\nSignal blocked until the price sources match.`
  };
}

export function livePriceLabel(args: {
  dataSourceLabel?: string | null;
  isTestDecision?: boolean | null;
  marketDataTime?: string | null;
  staleAfterMs?: number;
  /** Labelled promotional / UI-review fixture — may show LIVE PRICE for mock UX only. */
  isUiReviewFixture?: boolean | null;
  /** Verified broker quote present and mapped to canonical XAUUSD. */
  brokerQuoteVerified?: boolean | null;
  marketStatus?: "OPEN" | "CLOSED" | "UNKNOWN" | null;
}): "LIVE PRICE" | "Last stored price" | "Test fixture price" | "Unavailable" {
  if (args.isUiReviewFixture) {
    return "LIVE PRICE";
  }
  if (args.isTestDecision || args.dataSourceLabel === "TEST" || args.dataSourceLabel === "MOCK") {
    return "Test fixture price";
  }
  if (args.marketStatus === "CLOSED") {
    return "Last stored price";
  }
  if (args.dataSourceLabel === "STALE" || args.dataSourceLabel === "OFFLINE") {
    return "Last stored price";
  }
  if (args.dataSourceLabel === "LIVE" || args.dataSourceLabel === "DELAYED") {
    if (args.marketDataTime) {
      const age = Date.now() - Date.parse(args.marketDataTime);
      if (Number.isFinite(age) && age > (args.staleAfterMs ?? 5 * 60_000)) {
        return "Last stored price";
      }
    }
    if (args.dataSourceLabel === "LIVE") {
      // Require confirmed mapping / freshness context before advertising LIVE.
      if (args.brokerQuoteVerified === false) return "Last stored price";
      return "LIVE PRICE";
    }
    return "Last stored price";
  }
  if (!args.dataSourceLabel) return "Unavailable";
  return "Last stored price";
}
