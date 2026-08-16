/**
 * Risk sizing from Gold Hunter allocated capital (not full broker equity).
 * Fail closed when protection distance or metadata is unsafe.
 * No martingale / grid / averaging. No default maxLots=100.
 */

import type { GoldHunterAdminConfig } from "./types";

export type RiskSizeInput = {
  config: GoldHunterAdminConfig;
  entry: number;
  stop: number;
  /** Broker-reported tick/pip value per 1.0 lot in account/quote currency. */
  valuePerPointPerLot: number;
  maxLots: number;
  minLots: number;
  lotStep: number;
  /** Remaining GH allocation available for new risk. */
  availableAllocationEur?: number | null;
};

export type RiskSizeResult =
  | {
      ok: true;
      riskBudgetEur: number;
      dailyLossBudgetEur: number;
      stopDistance: number;
      lots: number;
    }
  | {
      ok: false;
      blocker: string;
    };

export function plannedRiskBudgetEur(config: GoldHunterAdminConfig): number {
  return (config.allocatedCapitalEur * config.riskPerTradePct) / 100;
}

export function plannedDailyLossBudgetEur(config: GoldHunterAdminConfig): number {
  return (config.allocatedCapitalEur * config.dailyLossLimitPct) / 100;
}

/**
 * Derive lots from allocation risk % and stop distance.
 * Requires complete broker volume metadata — no invented max lots.
 */
export function sizeGoldHunterDemoLots(input: RiskSizeInput): RiskSizeResult {
  const riskBudgetEur = plannedRiskBudgetEur(input.config);
  const dailyLossBudgetEur = plannedDailyLossBudgetEur(input.config);

  if (!Number.isFinite(input.entry) || !Number.isFinite(input.stop)) {
    return { ok: false, blocker: "entry_or_stop_invalid" };
  }
  const stopDistance = Math.abs(input.entry - input.stop);
  if (!(stopDistance > 0)) {
    return { ok: false, blocker: "stop_distance_zero" };
  }

  const vpp = input.valuePerPointPerLot;
  if (!Number.isFinite(vpp) || vpp <= 0) {
    return { ok: false, blocker: "WAIT — SIZING METADATA UNAVAILABLE" };
  }
  if (
    !(input.minLots > 0) ||
    !(input.maxLots > 0) ||
    !(input.lotStep > 0) ||
    !Number.isFinite(input.minLots) ||
    !Number.isFinite(input.maxLots) ||
    !Number.isFinite(input.lotStep)
  ) {
    return { ok: false, blocker: "WAIT — SIZING METADATA UNAVAILABLE" };
  }

  if (
    input.availableAllocationEur != null &&
    Number.isFinite(input.availableAllocationEur) &&
    input.availableAllocationEur < riskBudgetEur
  ) {
    return { ok: false, blocker: "WAIT — CAPITAL LIMIT" };
  }

  const rawLots = riskBudgetEur / (stopDistance * vpp);
  if (!Number.isFinite(rawLots) || rawLots <= 0) {
    return { ok: false, blocker: "lots_not_computable" };
  }

  let lots = Math.floor(rawLots / input.lotStep) * input.lotStep;
  lots = Math.round(lots * 1e8) / 1e8;
  if (lots < input.minLots) {
    return { ok: false, blocker: "risk_budget_below_min_lot" };
  }
  if (lots > input.maxLots) lots = input.maxLots;

  return {
    ok: true,
    riskBudgetEur,
    dailyLossBudgetEur,
    stopDistance,
    lots
  };
}
