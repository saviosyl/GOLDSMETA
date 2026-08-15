/**
 * Risk sizing from Gold Hunter allocated capital (not full broker equity).
 * Fail closed when protection distance or metadata is unsafe.
 * No martingale / grid / averaging.
 */

import type { GoldHunterAdminConfig } from "./types";

export type RiskSizeInput = {
  config: GoldHunterAdminConfig;
  entry: number;
  stop: number;
  /** Broker-reported tick/pip value per 1.0 lot in account currency, when known. */
  valuePerPointPerLot?: number | null;
  /** Max lots allowed by broker / instrument. */
  maxLots?: number | null;
  minLots?: number | null;
  lotStep?: number | null;
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
 * Requires a positive stop distance and a known EUR value-per-point-per-lot.
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
  if (vpp == null || !Number.isFinite(vpp) || vpp <= 0) {
    return {
      ok: false,
      blocker: "broker_value_per_point_unavailable"
    };
  }

  const rawLots = riskBudgetEur / (stopDistance * vpp);
  if (!Number.isFinite(rawLots) || rawLots <= 0) {
    return { ok: false, blocker: "lots_not_computable" };
  }

  const minLots = input.minLots != null && input.minLots > 0 ? input.minLots : 0.01;
  const maxLots = input.maxLots != null && input.maxLots > 0 ? input.maxLots : 100;
  const step = input.lotStep != null && input.lotStep > 0 ? input.lotStep : 0.01;

  let lots = Math.floor(rawLots / step) * step;
  lots = Math.round(lots * 100) / 100;
  if (lots < minLots) {
    return { ok: false, blocker: "risk_budget_below_min_lot" };
  }
  if (lots > maxLots) lots = maxLots;

  return {
    ok: true,
    riskBudgetEur,
    dailyLossBudgetEur,
    stopDistance,
    lots
  };
}
