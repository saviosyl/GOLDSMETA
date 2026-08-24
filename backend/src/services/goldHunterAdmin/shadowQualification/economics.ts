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
import type { GhShadowEconomicExposure, GhShadowFrozenSizingSnapshot } from "./types";

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

export type GhShadowCashPnl = {
  signedPriceMove: number;
  frictionPrice: number;
  netPriceMove: number;
  grossQuote: number;
  frictionQuote: number;
  netQuote: number;
  quoteCurrency: string;
  /**
   * netQuoteUsd / riskBudgetQuoteUsd when FX converts EUR risk budget → quote USD.
   * Null when quoteToDepositRate unavailable — never USD/EUR mixed R.
   */
  plannedRiskR: number | null;
  /** Alias of plannedRiskR (legacy field name). */
  netR: number | null;
  /** stopDistance × displayedLots × ozPerLot (quote USD). */
  geometryRiskQuote: number | null;
  /** netQuoteUsd / geometryRiskQuote — valid without EUR FX. */
  geometryR: number | null;
  riskBudgetQuoteUsd: number | null;
  simulatedGrossPnlEur: number | null;
  simulatedFrictionEur: number | null;
  simulatedNetPnlEur: number | null;
  eurPnlAvailable: boolean;
  quoteToDepositRate: number | null;
};

export type GhShadowSizingInput = {
  config: GoldHunterAdminConfig;
  entryPrice: number;
  stopPrice?: number;
  side: "BUY" | "SELL";
  frozenSizing?: GhShadowFrozenSizingSnapshot;
  minLots?: number;
  maxLots?: number;
  lotStep?: number;
  valuePerPointPerLot?: number;
  quoteCurrency?: string;
  depositCurrency?: string;
  quoteToDepositRate?: number | null;
  quoteToDepositRateSource?: string | null;
  sizingProvenance?: string;
  adminSizingConfigSha?: string;
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

  const minLots =
    args.frozenSizing?.minLots ??
    args.minLots ??
    GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.minLots;
  const maxLots =
    args.frozenSizing?.maxLots ??
    args.maxLots ??
    GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.maxLots;
  const lotStep =
    args.frozenSizing?.lotStep ??
    args.lotStep ??
    GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.lotStep;
  const valuePerPointPerLot =
    args.frozenSizing?.valuePerPointPerLot ??
    args.valuePerPointPerLot ??
    GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.valuePerPointPerLot;
  const ozPerLot =
    args.frozenSizing?.ozPerLot ?? PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot;

  const sized = sizeGoldHunterDemoLots({
    config: args.config,
    entry: args.entryPrice,
    stop: stopPrice,
    valuePerPointPerLot,
    minLots,
    maxLots,
    lotStep,
    riskDistanceBuffer: cfg.entrySlippageRiskBuffer
  });
  if (!sized.ok) {
    return { ok: false, blocker: sized.blocker };
  }

  const displayedLots = sized.lots;
  const economicXauOz = displayedLots * ozPerLot;
  const rawProtocolVolumeEquivalent = protocolVolumeFromLots(displayedLots);
  const quoteToDepositRate =
    (args.frozenSizing?.quoteToDepositRate != null &&
    args.frozenSizing.quoteToDepositRate > 0
      ? args.frozenSizing.quoteToDepositRate
      : null) ??
    (args.quoteToDepositRate != null &&
    Number.isFinite(args.quoteToDepositRate) &&
    args.quoteToDepositRate > 0
      ? args.quoteToDepositRate
      : null);
  const eurPnlAvailable = quoteToDepositRate != null;
  const adminSizingConfigSha =
    args.frozenSizing?.adminSizingConfigSha ??
    args.adminSizingConfigSha ??
    "unfrozen";

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
        args.frozenSizing?.quoteCurrency ??
        args.quoteCurrency ??
        GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.quoteCurrency,
      depositCurrency:
        args.frozenSizing?.depositCurrency ??
        args.depositCurrency ??
        GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.depositCurrency,
      quoteToDepositRate,
      quoteToDepositRateSource: quoteToDepositRate
        ? args.frozenSizing?.quoteToDepositRateSource ??
          args.quoteToDepositRateSource ??
          "provided"
        : null,
      valuePerPointPerLot,
      minLots,
      maxLots,
      lotStep,
      sizingProvenance:
        args.frozenSizing?.symbolMetadataProvenance ??
        args.sizingProvenance ??
        GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.provenance,
      mappingKey:
        args.frozenSizing?.mappingKey ?? PEPPERSTONE_CTRADER_XAUUSD_DEMO.key,
      adminSizingConfigSha,
      frictionPrice: cfg.friction,
      frictionSemantics:
        "ADDITIONAL_COMMISSION_SLIPPAGE_PRICE_UNITS_NOT_SPREAD",
      eurPnlAvailable,
      formula:
        "displayedLots = sizeGoldHunterDemoLots(...); " +
        "economicXauOz = displayedLots * ozPerLot; " +
        "grossQuote = signedPriceMove * displayedLots * ozPerLot; " +
        "plannedRiskR = netQuoteUsd / (riskBudgetEur / quoteToDepositRate) when FX available else null; " +
        "geometryR = netQuoteUsd / (stopDistance * displayedLots * ozPerLot); " +
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
  const riskEur = args.economic.riskBudgetEur;
  // plannedRiskR only when EUR risk can be converted consistently into quote USD.
  let riskBudgetQuoteUsd: number | null = null;
  let plannedRiskR: number | null = null;
  if (eurOk && rate! > 0 && riskEur > 0) {
    riskBudgetQuoteUsd = riskEur / rate!;
    plannedRiskR =
      riskBudgetQuoteUsd > 0 ? netQuote / riskBudgetQuoteUsd : null;
  }
  const geometryRiskQuote =
    args.economic.stopDistance > 0 && scale > 0
      ? args.economic.stopDistance * scale
      : null;
  const geometryR =
    geometryRiskQuote != null && geometryRiskQuote > 0
      ? netQuote / geometryRiskQuote
      : null;

  return {
    signedPriceMove,
    frictionPrice,
    netPriceMove: signedPriceMove - frictionPrice,
    grossQuote,
    frictionQuote,
    netQuote,
    quoteCurrency: args.economic.quoteCurrency,
    plannedRiskR,
    netR: plannedRiskR,
    geometryRiskQuote,
    geometryR,
    riskBudgetQuoteUsd,
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
