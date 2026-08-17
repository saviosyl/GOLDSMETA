/**
 * Shadow economics — Pepperstone XAU cash mapping for simulation only.
 * Does not retune production Demo sizing converters.
 *
 * Intended economic exposure matches today's GH Demo risk math when
 * valuePerPointPerOzEur ≈ 100 (€/point/oz): €10 risk / 0.55 stop → 0.18 XAU oz.
 */
import { frozenGhFastSoakConfig } from "../abc/frozenConfig";
import type { GoldHunterAdminConfig } from "../types";
import { plannedRiskBudgetEur } from "../riskSizing";
import type { GhShadowEconomicExposure } from "./types";

/** Proven cash approx for Pepperstone Demo XAUUSD EUR accounts (€/pt/oz). */
export const GH_SHADOW_VALUE_PER_POINT_PER_OZ_EUR = 100;

export function computeGhShadowEconomicExposure(args: {
  config: GoldHunterAdminConfig;
  valuePerPointPerOzEur?: number;
}): GhShadowEconomicExposure {
  const cfg = frozenGhFastSoakConfig();
  const riskBudgetEur = plannedRiskBudgetEur(args.config);
  const hardStopPrice = cfg.hardStop;
  const valuePerPointPerOzEur =
    args.valuePerPointPerOzEur ?? GH_SHADOW_VALUE_PER_POINT_PER_OZ_EUR;
  const denom = hardStopPrice * valuePerPointPerOzEur;
  const rawOz =
    denom > 0 && Number.isFinite(riskBudgetEur) && riskBudgetEur > 0
      ? riskBudgetEur / denom
      : 0;
  // Round down to 0.01 oz step (matches protocol cents scale for trading units).
  const economicXauOz = Math.floor(rawOz * 100 + 1e-12) / 100;
  const conventionalLotsEquivalent = economicXauOz / 100;
  return {
    riskBudgetEur,
    hardStopPrice,
    valuePerPointPerOzEur,
    economicXauOz,
    conventionalLotsEquivalent,
    frictionPrice: cfg.friction,
    formula:
      "economicXauOz = floor(riskBudgetEur / (hardStop * valuePerPointPerOzEur) * 100) / 100; " +
      "simulatedGrossPnlEur = signedPriceMove * economicXauOz * valuePerPointPerOzEur; " +
      "simulatedFrictionEur = frictionPrice * economicXauOz * valuePerPointPerOzEur; " +
      "simulatedNetPnlEur = simulatedGrossPnlEur - simulatedFrictionEur"
  };
}

export function simulateGhShadowCashPnl(args: {
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  economic: GhShadowEconomicExposure;
}): {
  grossPriceMove: number;
  frictionPrice: number;
  netPriceMove: number;
  simulatedGrossPnlEur: number;
  simulatedFrictionEur: number;
  simulatedNetPnlEur: number;
} {
  const signed =
    args.side === "BUY"
      ? args.exitPrice - args.entryPrice
      : args.entryPrice - args.exitPrice;
  const frictionPrice = args.economic.frictionPrice;
  const scale =
    args.economic.economicXauOz * args.economic.valuePerPointPerOzEur;
  const simulatedGrossPnlEur = signed * scale;
  const simulatedFrictionEur = frictionPrice * scale;
  return {
    grossPriceMove: signed,
    frictionPrice,
    netPriceMove: signed - frictionPrice,
    simulatedGrossPnlEur,
    simulatedFrictionEur,
    simulatedNetPnlEur: simulatedGrossPnlEur - simulatedFrictionEur
  };
}

/** BUY entry=Ask exit=Bid; SELL entry=Bid exit=Ask. */
export function shadowEntryPrice(
  side: "BUY" | "SELL",
  bid: number,
  ask: number
): number {
  return side === "BUY" ? ask : bid;
}

export function shadowExitPrice(
  side: "BUY" | "SELL",
  bid: number,
  ask: number
): number {
  return side === "BUY" ? bid : ask;
}

export function shadowInitialStop(
  side: "BUY" | "SELL",
  entry: number,
  hardStop: number
): number {
  return side === "BUY" ? entry - hardStop : entry + hardStop;
}
