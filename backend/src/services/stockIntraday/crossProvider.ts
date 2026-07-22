/**
 * Cross-provider safety: Alpaca analysis vs Trading 212 execution-side checks.
 *
 * Official Trading 212 instrument metadata does NOT include a current/last price.
 * Separate:
 *   A) instrument eligibility
 *   B) execution-side price availability
 *   C) Alpaca/T212 price divergence
 */

export const DEFAULT_MAX_PROVIDER_PRICE_DIVERGENCE_PCT = 1.5;

export const T212_EXECUTION_PRICE_NOT_AVAILABLE_LABEL =
  "T212 EXECUTION PRICE — NOT AVAILABLE FROM CURRENT PUBLIC API";

export type T212ExecutionPriceAvailability =
  | { available: true; price: number; asOf: string | null; source: "PORTFOLIO" | "OTHER" }
  | { available: false; reason: "NOT_AVAILABLE_FROM_PUBLIC_API" };

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
  t212ExecutionPriceAvailability: T212ExecutionPriceAvailability;
  divergencePct: number | null;
  /** True only when both prices exist and divergence was evaluated. */
  divergenceValidated: boolean;
};

export type DivergenceCheckResult =
  | { ok: true; snapshot: ProviderPriceSnapshot; skipped?: false }
  | {
      ok: true;
      snapshot: ProviderPriceSnapshot;
      skipped: true;
      skipReason: "T212_EXECUTION_PRICE_NOT_AVAILABLE";
    }
  | { ok: false; code: string; snapshot: ProviderPriceSnapshot };

export function calculatePriceDivergencePct(
  alpacaLast: number,
  t212Last: number | null
): number | null {
  if (t212Last == null || t212Last <= 0 || alpacaLast <= 0) return null;
  return Number((((Math.abs(alpacaLast - t212Last) / alpacaLast) * 100)).toFixed(4));
}

/**
 * SHADOW: missing T212 execution price does not block; divergence is skipped.
 * PAPER/LIVE: missing T212 execution price is a hard blocker (caller enforces).
 */
export function evaluateProviderDivergence(args: {
  snapshot: Omit<
    ProviderPriceSnapshot,
    "divergencePct" | "divergenceValidated" | "t212ExecutionPriceAvailability"
  > & {
    divergencePct?: number | null;
    t212ExecutionPriceAvailability?: T212ExecutionPriceAvailability;
  };
  maxDivergencePct?: number;
  mode: "SHADOW" | "T212_PAPER_AUTO" | "T212_LIVE_AUTO" | "OFF";
}): DivergenceCheckResult {
  const max = args.maxDivergencePct ?? DEFAULT_MAX_PROVIDER_PRICE_DIVERGENCE_PCT;
  const availability: T212ExecutionPriceAvailability =
    args.snapshot.t212ExecutionPriceAvailability ??
    (args.snapshot.t212Last != null && args.snapshot.t212Last > 0
      ? {
          available: true,
          price: args.snapshot.t212Last,
          asOf: args.snapshot.t212AsOf,
          source: "OTHER"
        }
      : { available: false, reason: "NOT_AVAILABLE_FROM_PUBLIC_API" });

  const t212Last = availability.available ? availability.price : null;
  const divergencePct =
    args.snapshot.divergencePct ?? calculatePriceDivergencePct(args.snapshot.alpacaLast, t212Last);

  const snapshot: ProviderPriceSnapshot = {
    ...args.snapshot,
    t212Last,
    t212ExecutionPriceAvailability: availability,
    divergencePct: availability.available ? divergencePct : null,
    divergenceValidated: false
  };

  if (args.snapshot.alpacaLast <= 0) {
    return { ok: false, code: "ALPACA_PRICE_MISSING", snapshot };
  }

  if (!availability.available) {
    if (args.mode === "SHADOW" || args.mode === "OFF") {
      return {
        ok: true,
        skipped: true,
        skipReason: "T212_EXECUTION_PRICE_NOT_AVAILABLE",
        snapshot: {
          ...snapshot,
          divergenceValidated: false,
          divergencePct: null
        }
      };
    }
    return { ok: false, code: "T212_EXECUTION_PRICE_REQUIRED", snapshot };
  }

  if (divergencePct != null && divergencePct > max) {
    return {
      ok: false,
      code: "PROVIDER_PRICE_DIVERGENCE",
      snapshot: { ...snapshot, divergenceValidated: true }
    };
  }
  return {
    ok: true,
    snapshot: { ...snapshot, divergenceValidated: true }
  };
}
