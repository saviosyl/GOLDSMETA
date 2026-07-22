/**
 * Cross-provider safety: Alpaca analysis vs Trading 212 execution-side price.
 */

export const DEFAULT_MAX_PROVIDER_PRICE_DIVERGENCE_PCT = 1.5;

export type ProviderPriceSnapshot = {
  alpacaSymbol: string;
  alpacaLast: number;
  alpacaAsOf: string;
  alpacaFeed: string;
  alpacaBid: number | null;
  alpacaAsk: number | null;
  t212Symbol: string | null;
  t212Last: number | null;
  t212AsOf: string | null;
  t212Currency: string | null;
  t212Exchange: string | null;
  t212InstrumentStatus: string | null;
  divergencePct: number | null;
};

export type DivergenceCheckResult =
  | { ok: true; snapshot: ProviderPriceSnapshot }
  | { ok: false; code: string; snapshot: ProviderPriceSnapshot };

export function calculatePriceDivergencePct(
  alpacaLast: number,
  t212Last: number | null
): number | null {
  if (t212Last == null || t212Last <= 0 || alpacaLast <= 0) return null;
  return Number((((Math.abs(alpacaLast - t212Last) / alpacaLast) * 100)).toFixed(4));
}

export function evaluateProviderDivergence(args: {
  snapshot: Omit<ProviderPriceSnapshot, "divergencePct"> & { divergencePct?: number | null };
  maxDivergencePct?: number;
}): DivergenceCheckResult {
  const max = args.maxDivergencePct ?? DEFAULT_MAX_PROVIDER_PRICE_DIVERGENCE_PCT;
  const divergencePct =
    args.snapshot.divergencePct ??
    calculatePriceDivergencePct(args.snapshot.alpacaLast, args.snapshot.t212Last);
  const snapshot: ProviderPriceSnapshot = { ...args.snapshot, divergencePct };

  if (args.snapshot.alpacaLast <= 0) {
    return { ok: false, code: "ALPACA_PRICE_MISSING", snapshot };
  }
  if (args.snapshot.t212Last == null || args.snapshot.t212Last <= 0) {
    return { ok: false, code: "T212_PRICE_MISSING", snapshot };
  }
  if (divergencePct != null && divergencePct > max) {
    return { ok: false, code: "PROVIDER_PRICE_DIVERGENCE", snapshot };
  }
  return { ok: true, snapshot };
}
