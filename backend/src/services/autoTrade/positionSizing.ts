/**
 * Position sizing from monetary risk budgets (never margin-only).
 * Always rounds size DOWN to the IG increment. Never rounds up.
 */

export interface PositionSizeInput {
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopPrice: number;
  takeProfitPrice: number;
  maxLossPerTrade: number;
  remainingDailyLossCapacity: number;
  remainingWeeklyLossCapacity: number;
  maxMarginPerPosition: number;
  availableFunds: number;
  valuePerPoint: number;
  minDealSize: number;
  sizeIncrement: number;
  /** Optional estimated margin per unit size */
  marginPerUnit?: number | null;
  /** Spread/cost allowance in account currency */
  costAllowance?: number;
}

export type PositionSizeResult =
  | {
      ok: true;
      size: number;
      monetaryRisk: number;
      stopDistance: number;
      riskReward: number;
      limitingBudget: string;
    }
  | {
      ok: false;
      reason: string;
    };

function roundDownToIncrement(size: number, increment: number): number {
  if (increment <= 0) return 0;
  const units = Math.floor((size + 1e-12) / increment);
  return Number((units * increment).toFixed(8));
}

export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const {
    entryPrice,
    stopPrice,
    takeProfitPrice,
    maxLossPerTrade,
    remainingDailyLossCapacity,
    remainingWeeklyLossCapacity,
    maxMarginPerPosition,
    availableFunds,
    valuePerPoint,
    minDealSize,
    sizeIncrement
  } = input;

  if (!(entryPrice > 0) || !(stopPrice > 0) || !(takeProfitPrice > 0)) {
    return { ok: false, reason: "Entry, stop, or take-profit price is invalid." };
  }
  if (!(valuePerPoint > 0) || !(minDealSize > 0) || !(sizeIncrement > 0)) {
    return { ok: false, reason: "IG instrument dealing rules are incomplete." };
  }

  const stopDistance = Math.abs(entryPrice - stopPrice);
  const rewardDistance = Math.abs(takeProfitPrice - entryPrice);
  if (!(stopDistance > 0)) {
    return { ok: false, reason: "Stop distance is invalid." };
  }

  const riskReward = rewardDistance / stopDistance;
  const cost = Math.max(0, input.costAllowance ?? 0);

  // Risk per 1.0 size unit ≈ stopDistance * valuePerPoint (+ costs)
  const riskPerUnit = stopDistance * valuePerPoint + cost;
  if (!(riskPerUnit > 0)) {
    return { ok: false, reason: "Risk per unit could not be calculated reliably." };
  }

  const budgets: Array<{ name: string; amount: number }> = [
    { name: "max loss per trade", amount: maxLossPerTrade },
    { name: "remaining daily loss capacity", amount: remainingDailyLossCapacity },
    { name: "remaining weekly loss capacity", amount: remainingWeeklyLossCapacity }
  ];

  const limiting = budgets.reduce((a, b) => (b.amount < a.amount ? b : a));
  if (!(limiting.amount > 0)) {
    return {
      ok: false,
      reason: `No remaining loss capacity under ${limiting.name}.`
    };
  }

  let size = limiting.amount / riskPerUnit;
  size = roundDownToIncrement(size, sizeIncrement);

  if (size < minDealSize) {
    const minRisk = minDealSize * riskPerUnit;
    return {
      ok: false,
      reason: `Trade skipped: IG minimum position size would risk €${minRisk.toFixed(2)}. Configured maximum loss is €${maxLossPerTrade.toFixed(2)}.`
    };
  }

  // Margin cap
  const marginPerUnit = input.marginPerUnit ?? null;
  if (marginPerUnit != null && marginPerUnit > 0) {
    const maxByMargin = roundDownToIncrement(maxMarginPerPosition / marginPerUnit, sizeIncrement);
    if (maxByMargin < size) {
      size = maxByMargin;
    }
    if (size < minDealSize) {
      return {
        ok: false,
        reason: "Required margin exceeds the configured margin cap for IG minimum size."
      };
    }
    const requiredMargin = size * marginPerUnit;
    if (requiredMargin > availableFunds) {
      return { ok: false, reason: "Available funds are insufficient for the required margin." };
    }
    if (requiredMargin > maxMarginPerPosition) {
      return { ok: false, reason: "Required margin exceeds the configured margin cap." };
    }
  }

  const monetaryRisk = size * riskPerUnit;
  if (monetaryRisk > limiting.amount + 1e-9) {
    return {
      ok: false,
      reason: "Calculated monetary risk exceeds the tightest configured budget."
    };
  }

  return {
    ok: true,
    size,
    monetaryRisk: Number(monetaryRisk.toFixed(4)),
    stopDistance,
    riskReward: Number(riskReward.toFixed(4)),
    limitingBudget: limiting.name
  };
}
