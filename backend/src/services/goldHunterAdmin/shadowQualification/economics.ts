/**
 * Shadow economics — production Demo sizing parity (no artificial 0.18×100 model).
 *
 * Uses sizeGoldHunterDemoLots + PEPPERSTONE_CTRADER_XAUUSD_DEMO mapping.
 * Spread is already in Ask→Bid / Bid→Ask executable prices.
 * frictionPrice is ADDITIONAL frozen commission/slippage in price units.
 */
import {
  PEPPERSTONE_CTRADER_XAUUSD_DEMO,
  estimateXauUsdGrossPnlDeposit,
  protocolVolumeFromLots
} from "../../broker/ctrader/brokerUnitMappings";
import { frozenGhFastSoakConfig } from "../abc/frozenConfig";
import {
  plannedRiskBudgetEur,
  sizeGoldHunterDemoLots
} from "../riskSizing";
import type { GoldHunterAdminConfig } from "../types";
import type { GhShadowCashPnl, GhShadowEconomicExposure } from "./types";

/** Pepperstone Demo XAU proven volume defaults when live catalogue unavailable. */
export const GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS = {
  minLots: 1,
  maxLots: 5000,
  lotStep: 1,
  valuePerPointPerLot: PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot,
  quoteCurrency: "USD",
  depositCurrency: "EUR",
  provenance:
    "PEPPERSTONE_CTRADER_XAUUSD_DEMO_PROVEN_DEFAULTS (min=1 step=1 max=5000; ozPerLot=1)"
} as const;

export type GhShadowSizingInput = {
  config: GoldHunterAdminConfig;
  entryPrice: number;
  /** Optional override; default = entry ± frozen hardStop. */
  stopPrice?: number;
  side: "BUY" | "SELL";
  minLots?: number;
  maxLots?: number;
  lotStep?: number;
  valuePerPointPerLot?: number;
  quoteCurrency?: string;
  depositCurrency?: string;
  quoteToDepositRate?: number | null;
  quoteToDepositRateSource?: string | null;
  sizingProvenance?: string;
};

export type GhShadowSizingResult =
  | { ok: true; economic: GhShadowEconomicExposure }
  | { ok: false; blocker: string };

export function computeGhShadowEconomicExposure(
  args: GhShadowSizingInput
): GhShadowSizingResult {
  const cfg = frozenGhFastSoakConfig();
  const hardStopPrice = cfg.hardStop;
  const stopPrice =
    args.stopPrice ??
    (args.side === "BUY"
      ? args.entryPrice - hardStopPrice
      : args.entryPrice + hardStopPrice);

  const minLots = args.minLots ?? GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.minLots;
  const maxLots = args.maxLots ?? GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.maxLots;
  const lotStep = args.lotStep ?? GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.lotStep;
  const valuePerPointPerLot =
    args.valuePerPointPerLot ??
    GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.valuePerPointPerLot;
  const ozPerLot = PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot;

  const sized = sizeGoldHunterDemoLots({
    config: args.config,
    entry: args.entryPrice,
    stop: stopPrice,
    valuePerPointPerLot,
    minLots,
    maxLots,
    lotStep
  });
  if (!sized.ok) {
    return { ok: false, blocker: sized.blocker };
  }

  const displayedLots = sized.lots;
  const economicXauOz = displayedLots * ozPerLot;
  const rawProtocolVolumeEquivalent = protocolVolumeFromLots(displayedLots);
  const quoteToDepositRate =
    args.quoteToDepositRate != null &&
    Number.isFinite(args.quoteToDepositRate) &&
    args.quoteToDepositRate > 0
      ? args.quoteToDepositRate
      : null;
  const eurPnlAvailable = quoteToDepositRate != null;

  return {
    ok: true,
    economic: {
      riskBudgetEur: sized.riskBudgetEur,
      stopDistance: sized.stopDistance,
      hardStopPrice,
      displayedLots,
      ozPerLot,
      economicXauOz,
      rawProtocolVolumeEquivalent,
      quoteCurrency:
        args.quoteCurrency ?? GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.quoteCurrency,
      depositCurrency:
        args.depositCurrency ??
        GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.depositCurrency,
      quoteToDepositRate,
      quoteToDepositRateSource: quoteToDepositRate
        ? args.quoteToDepositRateSource ?? "provided"
        : null,
      valuePerPointPerLot,
      minLots,
      maxLots,
      lotStep,
      sizingProvenance:
        args.sizingProvenance ??
        GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.provenance,
      mappingKey: PEPPERSTONE_CTRADER_XAUUSD_DEMO.key,
      frictionPrice: cfg.friction,
      frictionSemantics:
        "ADDITIONAL_COMMISSION_SLIPPAGE_PRICE_UNITS_NOT_SPREAD",
      eurPnlAvailable,
      formula:
        "displayedLots = sizeGoldHunterDemoLots(...); " +
        "economicXauOz = displayedLots * ozPerLot; " +
        "grossQuote = signedPriceMove * displayedLots * ozPerLot; " +
        "grossEur = quoteToDepositRate != null ? grossQuote * quoteToDepositRate : UNAVAILABLE; " +
        "friction is ADDITIONAL price friction (spread already in Ask/Bid)"
    }
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

/**
 * Cash P/L: quote first; EUR only with valid quoteToDepositRate.
 * Does NOT invent EUR. Does NOT re-subtract spread.
 */
export function simulateGhShadowCashPnl(args: {
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  economic: GhShadowEconomicExposure;
}): GhShadowCashPnl {
  const signedPriceMove =
    args.side === "BUY"
      ? args.exitPrice - args.entryPrice
      : args.entryPrice - args.exitPrice;
  const frictionPrice = args.economic.frictionPrice;
  const scale = args.economic.displayedLots * args.economic.ozPerLot;
  const grossQuote = signedPriceMove * scale;
  const frictionQuote = frictionPrice * scale;
  const netQuote = grossQuote - frictionQuote;
  const rate = args.economic.quoteToDepositRate;
  const eurOk =
    rate != null && Number.isFinite(rate) && rate > 0 && args.economic.eurPnlAvailable;

  return {
    signedPriceMove,
    frictionPrice,
    netPriceMove: signedPriceMove - frictionPrice,
    grossQuote,
    frictionQuote,
    netQuote,
    quoteCurrency: args.economic.quoteCurrency,
    simulatedGrossPnlEur: eurOk ? grossQuote * rate! : null,
    simulatedFrictionEur: eurOk ? frictionQuote * rate! : null,
    simulatedNetPnlEur: eurOk ? netQuote * rate! : null,
    eurPnlAvailable: Boolean(eurOk),
    quoteToDepositRate: eurOk ? rate! : null
  };
}

/** Broker-proven parity helper (re-export for tests). */
export function provenGrossPnlEurExample(args: {
  lots: number;
  priceMove: number;
  quoteToDepositRate: number;
  ozPerLot?: number;
}): number {
  return estimateXauUsdGrossPnlDeposit({
    lots: args.lots,
    priceMove: args.priceMove,
    ozPerLot: args.ozPerLot ?? PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot,
    quoteToDepositRate: args.quoteToDepositRate
  });
}

export { plannedRiskBudgetEur, PEPPERSTONE_CTRADER_XAUUSD_DEMO };
