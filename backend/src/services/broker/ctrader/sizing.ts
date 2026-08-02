/**
 * CFD position sizing for cTrader XAUUSD.
 * Always round down to volume step. Never invent 0.01 lots.
 */

import { CTRADER_DEMO_SERVER_LIMITS } from "./flags";
import { roundDownLotsToStep } from "./volumeUnits";

export interface SizingInput {
  equity: number | null;
  freeMargin: number | null;
  accountCurrency: string;
  riskAmountEur: number;
  entryPrice: number | null;
  stopLoss: number | null;
  lotSize: number | null;
  tickSize: number | null;
  minVolume: number | null;
  volumeStep: number | null;
  maxVolume: number | null;
  /** Approximate margin per 1.0 lot in account currency, when known */
  marginPerLot: number | null;
  /** EUR conversion rate for account currency (1.0 if EUR) */
  eurToAccountRate: number | null;
}

export interface SizingResult {
  ok: boolean;
  volume: number | null;
  riskAmount: number | null;
  stopDistance: number | null;
  estimatedMargin: number | null;
  estimatedMaxLoss: number | null;
  rejectionReason: string | null;
  notes: string[];
}

export function calculateCTraderVolume(input: SizingInput): SizingResult {
  const notes: string[] = [];
  const riskCap = Math.min(
    Math.max(0, input.riskAmountEur),
    CTRADER_DEMO_SERVER_LIMITS.maxRiskPerTradeEur
  );

  if (input.entryPrice == null || !(input.entryPrice > 0)) {
    return {
      ok: false,
      volume: null,
      riskAmount: null,
      stopDistance: null,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "ENTRY_PRICE_UNAVAILABLE",
      notes
    };
  }
  if (input.stopLoss == null || !(input.stopLoss > 0)) {
    return {
      ok: false,
      volume: null,
      riskAmount: null,
      stopDistance: null,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "STOP_LOSS_REQUIRED",
      notes
    };
  }

  const stopDistance = Math.abs(input.entryPrice - input.stopLoss);
  if (!(stopDistance > 0)) {
    return {
      ok: false,
      volume: null,
      riskAmount: riskCap,
      stopDistance: 0,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "STOP_DISTANCE_INVALID",
      notes
    };
  }

  if (
    input.lotSize == null ||
    input.minVolume == null ||
    input.volumeStep == null ||
    input.maxVolume == null
  ) {
    return {
      ok: false,
      volume: null,
      riskAmount: riskCap,
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "SYMBOL_METADATA_INCOMPLETE",
      notes: ["lotSize/min/step/max volume required — refuse to guess."]
    };
  }

  if (input.eurToAccountRate == null || !(input.eurToAccountRate > 0)) {
    return {
      ok: false,
      volume: null,
      riskAmount: riskCap,
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "CURRENCY_CONVERSION_UNAVAILABLE",
      notes
    };
  }

  // Risk = volumeLots * contractSize * stopDistance (quote currency).
  // For XAUUSD, P/L ≈ lots * lotSize(oz) * priceDelta(USD). Convert via eurToAccountRate.
  // minVolume/volumeStep/maxVolume/lotSize MUST already be lot-denominated
  // (see volumeUnits.parseCTraderVolumeRules — never pass raw Open API cents here).
  const riskInQuote = riskCap * input.eurToAccountRate;
  const rawVolume = riskInQuote / (input.lotSize * stopDistance);
  let volume = roundDownLotsToStep(rawVolume, input.volumeStep);

  if (!(volume > 0)) {
    return {
      ok: false,
      volume: null,
      riskAmount: riskCap,
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "VOLUME_BELOW_MINIMUM_AFTER_ROUNDING",
      notes
    };
  }
  if (volume < input.minVolume) {
    return {
      ok: false,
      volume: null,
      riskAmount: riskCap,
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "VOLUME_BELOW_MINIMUM",
      notes: [`volume ${volume} < min ${input.minVolume}`]
    };
  }
  if (volume > input.maxVolume) {
    volume = roundDownLotsToStep(input.maxVolume, input.volumeStep);
    notes.push("Capped to maxVolume.");
  }

  const estimatedMaxLoss = Number(
    ((volume * input.lotSize * stopDistance) / input.eurToAccountRate).toFixed(2)
  );
  const estimatedMargin =
    input.marginPerLot != null
      ? Number((volume * input.marginPerLot).toFixed(2))
      : null;

  if (
    estimatedMargin != null &&
    input.freeMargin != null &&
    estimatedMargin > input.freeMargin + 1e-6
  ) {
    return {
      ok: false,
      volume: null,
      riskAmount: riskCap,
      stopDistance,
      estimatedMargin,
      estimatedMaxLoss,
      rejectionReason: "INSUFFICIENT_FREE_MARGIN",
      notes
    };
  }

  return {
    ok: true,
    volume,
    riskAmount: riskCap,
    stopDistance,
    estimatedMargin,
    estimatedMaxLoss,
    rejectionReason: null,
    notes
  };
}
