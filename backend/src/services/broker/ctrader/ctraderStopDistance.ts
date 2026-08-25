/**
 * Normalize cTrader ProtoOASymbol slDistance using distanceSetIn.
 *
 * Official model (help.ctrader.com Open API model messages):
 * - distanceSetIn: SYMBOL_DISTANCE_IN_POINTS (1) | SYMBOL_DISTANCE_IN_PERCENTAGE (2)
 * - POINTS: one point = 1 / 10^digits (tick size)
 * - PERCENTAGE: documented for gslCharge as hundredths of a percent (100 = 1%).
 *   The same distanceSetIn enum applies to slDistance; we only normalize PERCENTAGE
 *   when a finite reference price is supplied. If mode/units cannot be proven,
 *   fail closed — never invent an XAUUSD dollar buffer.
 */

export type CTraderDistanceSetIn =
  | "SYMBOL_DISTANCE_IN_POINTS"
  | "SYMBOL_DISTANCE_IN_PERCENTAGE"
  | "UNKNOWN";

export type NormalizedStopDistance =
  | {
      ok: true;
      rawSlDistance: number;
      distanceSetIn: CTraderDistanceSetIn;
      /** Price units — only field profit-lock buffer may consume. */
      normalizedMinStopPriceDistance: number;
      tickSize: number;
    }
  | {
      ok: false;
      reason: "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE";
      rawSlDistance: number | null;
      distanceSetIn: CTraderDistanceSetIn;
      detail: string;
    };

export function parseDistanceSetIn(raw: unknown): CTraderDistanceSetIn {
  if (raw == null) return "UNKNOWN";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw === 1) return "SYMBOL_DISTANCE_IN_POINTS";
    if (raw === 2) return "SYMBOL_DISTANCE_IN_PERCENTAGE";
    return "UNKNOWN";
  }
  const s = String(raw).trim().toUpperCase();
  if (
    s === "1" ||
    s === "SYMBOL_DISTANCE_IN_POINTS" ||
    s === "POINTS" ||
    s.endsWith("POINTS")
  ) {
    return "SYMBOL_DISTANCE_IN_POINTS";
  }
  if (
    s === "2" ||
    s === "SYMBOL_DISTANCE_IN_PERCENTAGE" ||
    s === "PERCENTAGE" ||
    s.endsWith("PERCENTAGE")
  ) {
    return "SYMBOL_DISTANCE_IN_PERCENTAGE";
  }
  return "UNKNOWN";
}

/**
 * Convert raw slDistance → price distance.
 * @param referencePrice required for PERCENTAGE mode (e.g. entry or TP level).
 */
export function normalizeSlDistanceToPrice(args: {
  rawSlDistance: number | null | undefined;
  distanceSetIn: unknown;
  digits: number | null | undefined;
  referencePrice?: number | null;
}): NormalizedStopDistance {
  const mode = parseDistanceSetIn(args.distanceSetIn);
  const raw =
    typeof args.rawSlDistance === "number" && Number.isFinite(args.rawSlDistance)
      ? args.rawSlDistance
      : null;

  if (raw == null || !(raw > 0)) {
    return {
      ok: false,
      reason: "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE",
      rawSlDistance: raw,
      distanceSetIn: mode,
      detail: "rawSlDistance missing or non-positive"
    };
  }

  const digits =
    typeof args.digits === "number" &&
    Number.isFinite(args.digits) &&
    args.digits >= 0 &&
    args.digits <= 8
      ? Math.floor(args.digits)
      : null;

  if (mode === "SYMBOL_DISTANCE_IN_POINTS") {
    if (digits == null) {
      return {
        ok: false,
        reason: "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE",
        rawSlDistance: raw,
        distanceSetIn: mode,
        detail: "digits required to convert POINTS → price"
      };
    }
    const tickSize = Math.pow(10, -digits);
    return {
      ok: true,
      rawSlDistance: raw,
      distanceSetIn: mode,
      normalizedMinStopPriceDistance: Number((raw * tickSize).toFixed(12)),
      tickSize
    };
  }

  if (mode === "SYMBOL_DISTANCE_IN_PERCENTAGE") {
    // Fail closed: official Open API docs establish distanceSetIn=PERCENTAGE
    // but do not sufficiently prove the raw slDistance numeric scale.
    // Do not derive scaling from gslCharge / commission / fee fields.
    return {
      ok: false,
      reason: "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE",
      rawSlDistance: raw,
      distanceSetIn: mode,
      detail:
        "SYMBOL_DISTANCE_IN_PERCENTAGE slDistance scale not independently proven — refuse invented conversion"
    };
  }

  return {
    ok: false,
    reason: "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE",
    rawSlDistance: raw,
    distanceSetIn: mode,
    detail: "unknown or missing distanceSetIn — refuse to invent units"
  };
}
