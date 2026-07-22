/**
 * Position sizing for Stocks Intraday AutoTrade.
 * Uses the smaller of capital, allocation, cash-above-reserve, exposure, and risk-based quantity.
 */

import type { StockIntradayRiskLimits } from "../featureFlags";

export interface PositionSizeInput {
  estimatedEntry: number;
  stop: number;
  limits: StockIntradayRiskLimits;
  availableCash: number;
  dailyAllocationRemaining: number;
  portfolioExposureUsed: number;
  symbolExposureUsed: number;
  minTradeQuantity: number;
  quantityStep?: number;
}

export interface PositionSizeResult {
  ok: boolean;
  quantity: number;
  estimatedCost: number;
  riskAmount: number;
  reason: string | null;
  components: {
    riskBasedQty: number;
    capitalBasedQty: number;
    allocationBasedQty: number;
    cashReserveBasedQty: number;
    exposureBasedQty: number;
    selectedQty: number;
  };
}

export function calculateStockPositionSize(input: PositionSizeInput): PositionSizeResult {
  const {
    estimatedEntry,
    stop,
    limits,
    availableCash,
    dailyAllocationRemaining,
    portfolioExposureUsed,
    symbolExposureUsed,
    minTradeQuantity
  } = input;
  const step = input.quantityStep ?? minTradeQuantity;

  if (!(estimatedEntry > 0) || !(stop > 0) || stop >= estimatedEntry) {
    return fail("Invalid entry/stop for long-only sizing");
  }

  const stopDistance = estimatedEntry - stop;
  const riskBasedQty = limits.maxLossPerTrade / stopDistance;
  const capitalBasedQty = limits.maxCapitalPerTrade / estimatedEntry;
  const allocationBasedQty = dailyAllocationRemaining / estimatedEntry;
  const cashAboveReserve = Math.max(0, availableCash - limits.minCashReserve);
  const cashReserveBasedQty = cashAboveReserve / estimatedEntry;
  const remainingPortfolio = Math.max(0, limits.maxPortfolioExposure - portfolioExposureUsed);
  const remainingSymbol = Math.max(0, limits.maxExposurePerSymbol - symbolExposureUsed);
  const exposureBasedQty = Math.min(remainingPortfolio, remainingSymbol) / estimatedEntry;

  const selectedRaw = Math.min(
    riskBasedQty,
    capitalBasedQty,
    allocationBasedQty,
    cashReserveBasedQty,
    exposureBasedQty
  );

  const selectedQty = floorToStep(selectedRaw, step);

  if (selectedQty < minTradeQuantity) {
    return fail("Minimum tradable quantity would exceed risk/capital limits", {
      riskBasedQty,
      capitalBasedQty,
      allocationBasedQty,
      cashReserveBasedQty,
      exposureBasedQty,
      selectedQty
    });
  }

  const estimatedCost = selectedQty * estimatedEntry;
  if (estimatedCost > limits.maxCapitalPerTrade + 1e-9) {
    return fail("Estimated cost exceeds max capital per trade");
  }
  if (availableCash - estimatedCost < limits.minCashReserve) {
    return fail("Trade would breach minimum cash reserve");
  }

  return {
    ok: true,
    quantity: selectedQty,
    estimatedCost: Number(estimatedCost.toFixed(4)),
    riskAmount: Number((selectedQty * stopDistance).toFixed(4)),
    reason: null,
    components: {
      riskBasedQty: Number(riskBasedQty.toFixed(6)),
      capitalBasedQty: Number(capitalBasedQty.toFixed(6)),
      allocationBasedQty: Number(allocationBasedQty.toFixed(6)),
      cashReserveBasedQty: Number(cashReserveBasedQty.toFixed(6)),
      exposureBasedQty: Number(exposureBasedQty.toFixed(6)),
      selectedQty
    }
  };
}

function floorToStep(value: number, step: number): number {
  if (!(step > 0)) return Number(value.toFixed(6));
  return Number((Math.floor(value / step) * step).toFixed(6));
}

function fail(
  reason: string,
  components?: PositionSizeResult["components"]
): PositionSizeResult {
  return {
    ok: false,
    quantity: 0,
    estimatedCost: 0,
    riskAmount: 0,
    reason,
    components: components ?? {
      riskBasedQty: 0,
      capitalBasedQty: 0,
      allocationBasedQty: 0,
      cashReserveBasedQty: 0,
      exposureBasedQty: 0,
      selectedQty: 0
    }
  };
}
