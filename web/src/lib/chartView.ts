/**
 * Pure helpers for XAUUSD chart default fit / visible ranges.
 * Rendering only — does not alter trading values.
 */

export type ChartCandleLike = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ChartLevelPrices = {
  resistance?: number | null;
  vah?: number | null;
  poc?: number | null;
  val?: number | null;
  support?: number | null;
  currentPrice?: number | null;
};

/** Default number of recent bars to show on initial / Fit view. */
export const DEFAULT_VISIBLE_BARS = 90;
/** Right-side empty logical bars so live price has room. */
export const DEFAULT_RIGHT_OFFSET_BARS = 8;
/** Vertical padding fraction around min/max. */
export const DEFAULT_PRICE_PAD_RATIO = 0.1;

export function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Collect finite overlay prices (filters NaN/Infinity/null). */
export function collectLevelPrices(levels: ChartLevelPrices): number[] {
  return [
    levels.resistance,
    levels.vah,
    levels.poc,
    levels.val,
    levels.support,
    levels.currentPrice
  ].filter(isFinitePrice);
}

/** Most-recent N candles (same subset Fit shows horizontally). */
export function selectRecentCandles(
  candles: ChartCandleLike[],
  visibleBars = DEFAULT_VISIBLE_BARS
): ChartCandleLike[] {
  if (!candles.length) return [];
  const n = Math.min(Math.max(1, visibleBars), candles.length);
  return candles.slice(candles.length - n);
}

/** Candles covered by a visible logical index range. */
export function selectCandlesForLogicalRange(
  candles: ChartCandleLike[],
  from: number,
  to: number
): ChartCandleLike[] {
  if (!candles.length) return [];
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return selectRecentCandles(candles);
  }
  const start = Math.max(0, Math.floor(Math.min(from, to)));
  const end = Math.min(candles.length - 1, Math.ceil(Math.max(from, to)));
  if (end < start) return [];
  return candles.slice(start, end + 1);
}

/**
 * Compute a useful vertical price range from candles + overlays.
 * Returns null when no usable span exists (caller should fall back).
 */
export function computeUsefulPriceRange(
  candles: ChartCandleLike[],
  levels: ChartLevelPrices,
  padRatio = DEFAULT_PRICE_PAD_RATIO
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const c of candles) {
    if (isFinitePrice(c.low)) min = Math.min(min, c.low);
    if (isFinitePrice(c.high)) max = Math.max(max, c.high);
  }
  for (const p of collectLevelPrices(levels)) {
    min = Math.min(min, p);
    max = Math.max(max, p);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max < min) return null;
  if (max === min) {
    const bump = Math.max(Math.abs(max) * 0.001, 0.5);
    return { min: min - bump, max: max + bump };
  }
  const pad = (max - min) * Math.max(0, padRatio);
  return { min: min - pad, max: max + pad };
}

/**
 * Vertical Fit geometry aligned with horizontal recent-N Fit.
 * Hidden older candles (e.g. outlier spikes) must not dominate.
 */
export function computeFitPriceRange(
  candles: ChartCandleLike[],
  levels: ChartLevelPrices,
  visibleBars = DEFAULT_VISIBLE_BARS,
  padRatio = DEFAULT_PRICE_PAD_RATIO
): { min: number; max: number } | null {
  return computeUsefulPriceRange(
    selectRecentCandles(candles, visibleBars),
    levels,
    padRatio
  );
}

/**
 * Logical range that shows the most recent bars with right-side breathing room.
 */
export function computeDefaultLogicalRange(
  barCount: number,
  visibleBars = DEFAULT_VISIBLE_BARS,
  rightOffset = DEFAULT_RIGHT_OFFSET_BARS
): { from: number; to: number } | null {
  if (!Number.isFinite(barCount) || barCount <= 0) return null;
  const span = Math.min(Math.max(1, visibleBars), barCount);
  const to = barCount - 1 + Math.max(0, rightOffset);
  const from = Math.max(-0.5, to - span - rightOffset);
  return { from, to };
}

/** Spread from bid/ask when both finite. */
export function computeSpread(
  bid: number | null | undefined,
  ask: number | null | undefined
): number | null {
  if (!isFinitePrice(bid) || !isFinitePrice(ask)) return null;
  const s = ask - bid;
  return Number.isFinite(s) ? s : null;
}
