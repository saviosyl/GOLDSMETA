/**
 * Server-side EGLNl_EQ quantity calculation for Practice orders.
 * Uses quantity (not cash value). Never guesses fractional support.
 */

export interface InstrumentEligibility {
  ticker: string;
  minOrderQuantity: number | null;
  minOrderValue: number | null;
  /** null = unknown — must reject before first live order */
  fractionalSupported: boolean | null;
  /** Optional catalogue max open quantity */
  maxOpenQuantity: number | null;
  /** Quantity step / precision digits if known */
  quantityPrecision: number | null;
}

export interface QuantityCalcInput {
  side: "BUY" | "SELL";
  targetOrderValueEur: number;
  maxOrderValueEur: number;
  freeCashEur: number | null;
  indicativePrice: number | null;
  /** Safety buffer against adverse price movement (e.g. 0.02 = 2%). */
  priceSafetyBufferPct: number;
  holdingQuantity: number;
  pendingSellQuantity: number;
  eligibility: InstrumentEligibility;
}

export interface QuantityCalcResult {
  ok: boolean;
  quantity: number | null;
  /** Signed quantity for T212 API (SELL negative). */
  signedQuantity: number | null;
  estimatedValue: number | null;
  indicativePrice: number | null;
  bufferedPrice: number | null;
  rejectionReason: string | null;
  notes: string[];
}

function roundDownToPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(precision) || precision < 0) {
    return Math.floor(value);
  }
  const factor = 10 ** Math.min(8, Math.floor(precision));
  return Math.floor(value * factor + 1e-12) / factor;
}

export function calculateT212OrderQuantity(input: QuantityCalcInput): QuantityCalcResult {
  const notes: string[] = [];

  if (input.side === "SELL") {
    const available = Math.max(0, input.holdingQuantity - Math.max(0, input.pendingSellQuantity));
    if (available <= 0) {
      return {
        ok: false,
        quantity: null,
        signedQuantity: null,
        estimatedValue: null,
        indicativePrice: input.indicativePrice,
        bufferedPrice: null,
        rejectionReason: "SHORT_UNSUPPORTED_ON_T212_INVEST",
        notes: ["No sellable holding after pending sells."]
      };
    }
    const qty = roundDownToPrecision(available, input.eligibility.quantityPrecision ?? 6);
    if (qty <= 0) {
      return {
        ok: false,
        quantity: null,
        signedQuantity: null,
        estimatedValue: null,
        indicativePrice: input.indicativePrice,
        bufferedPrice: null,
        rejectionReason: "INVALID_QUANTITY",
        notes: ["Rounded sell quantity was zero."]
      };
    }
    const est =
      input.indicativePrice != null && input.indicativePrice > 0
        ? Number((qty * input.indicativePrice).toFixed(2))
        : null;
    return {
      ok: true,
      quantity: qty,
      signedQuantity: -Math.abs(qty),
      estimatedValue: est,
      indicativePrice: input.indicativePrice,
      bufferedPrice: null,
      rejectionReason: null,
      notes: ["SELL_CLOSE uses available holding only.", "Signed quantity is negative per T212 API."]
    };
  }

  // BUY
  if (input.indicativePrice == null || !(input.indicativePrice > 0) || Number.isNaN(input.indicativePrice)) {
    return {
      ok: false,
      quantity: null,
      signedQuantity: null,
      estimatedValue: null,
      indicativePrice: input.indicativePrice,
      bufferedPrice: null,
      rejectionReason: "PRICE_UNAVAILABLE",
      notes: ["Indicative price missing or invalid."]
    };
  }

  if (input.eligibility.fractionalSupported == null) {
    return {
      ok: false,
      quantity: null,
      signedQuantity: null,
      estimatedValue: null,
      indicativePrice: input.indicativePrice,
      bufferedPrice: null,
      rejectionReason: "FRACTIONAL_ELIGIBILITY_UNKNOWN",
      notes: ["Catalogue did not confirm fractional support — refuse to guess."]
    };
  }

  const buffer = Math.max(0, input.priceSafetyBufferPct);
  const bufferedPrice = input.indicativePrice * (1 + buffer);
  notes.push(`Applied price safety buffer ${buffer * 100}% → ${bufferedPrice}`);

  const target = Math.min(
    Math.max(0, input.targetOrderValueEur),
    Math.max(0, input.maxOrderValueEur)
  );
  const cashCap =
    input.freeCashEur != null ? Math.max(0, input.freeCashEur) : target;
  const orderValue = Math.min(target, cashCap);
  if (!(orderValue > 0)) {
    return {
      ok: false,
      quantity: null,
      signedQuantity: null,
      estimatedValue: null,
      indicativePrice: input.indicativePrice,
      bufferedPrice,
      rejectionReason: "INSUFFICIENT_FUNDS",
      notes
    };
  }

  const precision = input.eligibility.fractionalSupported
    ? (input.eligibility.quantityPrecision ?? 6)
    : 0;

  let quantity = roundDownToPrecision(orderValue / bufferedPrice, precision);
  if (!Number.isFinite(quantity) || quantity <= 0 || Number.isNaN(quantity)) {
    return {
      ok: false,
      quantity: null,
      signedQuantity: null,
      estimatedValue: null,
      indicativePrice: input.indicativePrice,
      bufferedPrice,
      rejectionReason: "INVALID_QUANTITY",
      notes: [...notes, "Calculated quantity was zero/NaN/invalid."]
    };
  }

  if (!input.eligibility.fractionalSupported && quantity !== Math.floor(quantity)) {
    quantity = Math.floor(quantity);
  }

  if (
    input.eligibility.minOrderQuantity != null &&
    quantity < input.eligibility.minOrderQuantity
  ) {
    return {
      ok: false,
      quantity: null,
      signedQuantity: null,
      estimatedValue: null,
      indicativePrice: input.indicativePrice,
      bufferedPrice,
      rejectionReason: "BELOW_MIN_ORDER_QUANTITY",
      notes: [
        ...notes,
        `quantity ${quantity} < minOrderQuantity ${input.eligibility.minOrderQuantity}`
      ]
    };
  }

  let estimatedValue = Number((quantity * input.indicativePrice).toFixed(2));
  if (
    input.eligibility.minOrderValue != null &&
    estimatedValue < input.eligibility.minOrderValue
  ) {
    return {
      ok: false,
      quantity: null,
      signedQuantity: null,
      estimatedValue,
      indicativePrice: input.indicativePrice,
      bufferedPrice,
      rejectionReason: "BELOW_MIN_ORDER_VALUE",
      notes: [
        ...notes,
        `estimatedValue ${estimatedValue} < minOrderValue ${input.eligibility.minOrderValue}`
      ]
    };
  }

  if (estimatedValue > input.maxOrderValueEur + 1e-6) {
    // Recompute with stricter price to stay under max
    quantity = roundDownToPrecision(input.maxOrderValueEur / bufferedPrice, precision);
    estimatedValue = Number((quantity * input.indicativePrice).toFixed(2));
    if (!(quantity > 0) || estimatedValue > input.maxOrderValueEur + 0.01) {
      return {
        ok: false,
        quantity: null,
        signedQuantity: null,
        estimatedValue,
        indicativePrice: input.indicativePrice,
        bufferedPrice,
        rejectionReason: "MAX_ORDER_VALUE_EXCEEDED",
        notes
      };
    }
  }

  if (input.freeCashEur != null && estimatedValue > input.freeCashEur + 1e-6) {
    return {
      ok: false,
      quantity: null,
      signedQuantity: null,
      estimatedValue,
      indicativePrice: input.indicativePrice,
      bufferedPrice,
      rejectionReason: "INSUFFICIENT_FUNDS",
      notes
    };
  }

  if (
    input.eligibility.maxOpenQuantity != null &&
    quantity > input.eligibility.maxOpenQuantity
  ) {
    return {
      ok: false,
      quantity: null,
      signedQuantity: null,
      estimatedValue,
      indicativePrice: input.indicativePrice,
      bufferedPrice,
      rejectionReason: "MAX_OPEN_QUANTITY_EXCEEDED",
      notes
    };
  }

  return {
    ok: true,
    quantity,
    signedQuantity: quantity,
    estimatedValue,
    indicativePrice: input.indicativePrice,
    bufferedPrice,
    rejectionReason: null,
    notes
  };
}
