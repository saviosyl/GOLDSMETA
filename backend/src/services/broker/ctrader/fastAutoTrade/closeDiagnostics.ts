/**
 * Measurement-only close diagnostics. Stops are not guaranteed.
 */

export type CloseDiagnostics = {
  brokerStopLoss: number | null;
  closePrice: number | null;
  stopSlippagePrice: number | null;
  stopSlippageDeposit: number | null;
  grossPnl: number | null;
  commission: number | null;
  swap: number | null;
  netPnl: number | null;
  effectiveRiskAmount: number | null;
  grossR: number | null;
  netR: number | null;
};

export function computeCloseDiagnostics(args: {
  side: "BUY" | "SELL";
  brokerStopLoss?: number | null;
  closePrice?: number | null;
  fillPrice?: number | null;
  filledLots?: number | null;
  quoteToDeposit?: number | null;
  grossPnl?: number | null;
  commission?: number | null;
  swap?: number | null;
  netPnl?: number | null;
  effectiveRiskAmount?: number | null;
}): CloseDiagnostics {
  const sl = args.brokerStopLoss;
  const close = args.closePrice;
  let stopSlippagePrice: number | null = null;
  if (
    sl != null &&
    close != null &&
    Number.isFinite(sl) &&
    Number.isFinite(close) &&
    sl !== 0 &&
    close !== 0
  ) {
    stopSlippagePrice =
      args.side === "BUY" ? sl - close : close - sl;
  }
  let stopSlippageDeposit: number | null = null;
  if (
    stopSlippagePrice != null &&
    args.filledLots != null &&
    args.filledLots > 0 &&
    args.quoteToDeposit != null &&
    args.quoteToDeposit > 0
  ) {
    // Proven Pepperstone Demo XAUUSD: 1 lot = 1 oz. Deposit ≈ priceΔ × lots × FX.
    stopSlippageDeposit = Number(
      (stopSlippagePrice * args.filledLots * args.quoteToDeposit).toFixed(2)
    );
  }
  const risk =
    args.effectiveRiskAmount != null && args.effectiveRiskAmount > 0
      ? args.effectiveRiskAmount
      : null;
  return {
    brokerStopLoss: sl ?? null,
    closePrice: close ?? null,
    stopSlippagePrice,
    stopSlippageDeposit,
    grossPnl: args.grossPnl ?? null,
    commission: args.commission ?? null,
    swap: args.swap ?? null,
    netPnl: args.netPnl ?? null,
    effectiveRiskAmount: args.effectiveRiskAmount ?? null,
    grossR:
      risk != null && args.grossPnl != null
        ? Number((args.grossPnl / risk).toFixed(4))
        : null,
    netR:
      risk != null && args.netPnl != null
        ? Number((args.netPnl / risk).toFixed(4))
        : null
  };
}
