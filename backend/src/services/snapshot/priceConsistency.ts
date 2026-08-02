/**
 * Price-source consistency for TradingView alerts vs levels / broker mid.
 * Prevents silently combining incompatible gold price regimes (e.g. ~2400 fixture with ~4050 live).
 */

export type PricePointMeta = {
  source: string;
  symbol: string;
  exchangeOrBroker: string | null;
  timeframe: string | null;
  timestamp: string | null;
  receivedAt: string;
  quoteAgeSeconds: number | null;
};

export type PriceConsistencyInput = {
  symbol?: string | null;
  alertClose: number | null;
  ohlc?: { open?: number | null; high?: number | null; low?: number | null; close?: number | null } | null;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
  /** Optional verified broker mid (bid+ask)/2 */
  brokerMid?: number | null;
  /** Relative tolerance, e.g. 0.02 = 2% */
  tolerance?: number;
};

export type PriceConsistencyResult = {
  ok: boolean;
  code: "OK" | "PRICE_SOURCE_MISMATCH" | "MISSING_ALERT_CLOSE" | "MISSING_BROKER_MID";
  relativeDiff: number | null;
  alertClose: number | null;
  brokerMid: number | null;
  referencePrice: number | null;
  mismatchedLevels: Array<{ name: string; price: number; relativeDiff: number }>;
  message: string;
};

/** Default max relative divergence for XAUUSD alert vs levels/broker. */
export const XAUUSD_PRICE_CONSISTENCY_TOLERANCE = 0.02;

export function relativePriceDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(b), Math.abs(a), 1e-9);
  return Math.abs(a - b) / denom;
}

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Validate that alert close, OHLC, volume-profile levels, and optional broker mid
 * belong to the same price regime.
 */
export function evaluatePriceConsistency(input: PriceConsistencyInput): PriceConsistencyResult {
  const tolerance = input.tolerance ?? XAUUSD_PRICE_CONSISTENCY_TOLERANCE;
  const alertClose = positive(input.alertClose) ?? positive(input.ohlc?.close);
  const brokerMid = positive(input.brokerMid);
  const levels: Array<{ name: string; price: number }> = [];
  for (const [name, raw] of [
    ["open", input.ohlc?.open],
    ["high", input.ohlc?.high],
    ["low", input.ohlc?.low],
    ["close", input.ohlc?.close],
    ["poc", input.poc],
    ["vah", input.vah],
    ["val", input.val],
    ["brokerMid", brokerMid]
  ] as const) {
    const p = positive(raw);
    if (p != null) levels.push({ name, price: p });
  }

  if (alertClose == null) {
    return {
      ok: false,
      code: "MISSING_ALERT_CLOSE",
      relativeDiff: null,
      alertClose: null,
      brokerMid,
      referencePrice: null,
      mismatchedLevels: [],
      message: "Alert close price is missing — cannot validate price sources."
    };
  }

  const mismatchedLevels = levels
    .map((l) => ({
      name: l.name,
      price: l.price,
      relativeDiff: relativePriceDiff(alertClose, l.price)
    }))
    .filter((l) => l.relativeDiff > tolerance);

  let brokerDiff: number | null = null;
  if (brokerMid != null) {
    brokerDiff = relativePriceDiff(alertClose, brokerMid);
    if (brokerDiff > tolerance && !mismatchedLevels.some((m) => m.name === "brokerMid")) {
      mismatchedLevels.push({
        name: "brokerMid",
        price: brokerMid,
        relativeDiff: brokerDiff
      });
    }
  }

  if (mismatchedLevels.length > 0) {
    const worst = mismatchedLevels.reduce((a, b) =>
      a.relativeDiff > b.relativeDiff ? a : b
    );
    return {
      ok: false,
      code: "PRICE_SOURCE_MISMATCH",
      relativeDiff: worst.relativeDiff,
      alertClose,
      brokerMid,
      referencePrice: alertClose,
      mismatchedLevels,
      message: `Market data mismatch: alert close ${alertClose.toFixed(2)} disagrees with ${worst.name} ${worst.price.toFixed(2)} (Δ ${(worst.relativeDiff * 100).toFixed(1)}%). Signal blocked until price sources match.`
    };
  }

  return {
    ok: true,
    code: "OK",
    relativeDiff: brokerDiff,
    alertClose,
    brokerMid,
    referencePrice: alertClose,
    mismatchedLevels: [],
    message: "Price sources are consistent within tolerance."
  };
}

/** Client/server helper: compare two arbitrary prices (e.g. briefing POC vs decision close). */
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
