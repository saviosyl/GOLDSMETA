/**
 * CFD position sizing for cTrader XAUUSD.
 * Always round down to volume step. Never invent 0.01 lots.
 * Never silently increase risk to satisfy broker minimum volume.
 */

import { roundDownLotsToStep } from "./volumeUnits";

export type LotSizingMode = "automatic_risk" | "manual_lots";

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
  /** User-selected sizing mode — defaults to automatic risk-based. */
  sizingMode?: LotSizingMode;
  /** Required when sizingMode === manual_lots */
  manualLotSize?: number | null;
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

function validateCommonSizingMeta(input: SizingInput, notes: string[]): SizingResult | null {
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
      riskAmount: Math.max(0, input.riskAmountEur),
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
      riskAmount: Math.max(0, input.riskAmountEur),
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
      riskAmount: Math.max(0, input.riskAmountEur),
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "CURRENCY_CONVERSION_UNAVAILABLE",
      notes
    };
  }
  return null;
}

function attachEstimates(
  volume: number,
  input: SizingInput,
  stopDistance: number,
  riskAmount: number,
  notes: string[]
): SizingResult {
  const estimatedMaxLoss = Number(
    ((volume * (input.lotSize as number) * stopDistance) / (input.eurToAccountRate as number)).toFixed(
      2
    )
  );
  const estimatedMargin =
    input.marginPerLot != null ? Number((volume * input.marginPerLot).toFixed(2)) : null;

  if (
    estimatedMargin != null &&
    input.freeMargin != null &&
    estimatedMargin > input.freeMargin + 1e-6
  ) {
    return {
      ok: false,
      volume: null,
      riskAmount,
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
    riskAmount,
    stopDistance,
    estimatedMargin,
    estimatedMaxLoss,
    rejectionReason: null,
    notes
  };
}

/** Manual lot size — validates broker min/max/step; never silently changes the lot. */
export function calculateManualLotVolume(input: SizingInput): SizingResult {
  const notes: string[] = ["Manual lot size mode"];
  const early = validateCommonSizingMeta(input, notes);
  if (early) return early;
  const stopDistance = Math.abs((input.entryPrice as number) - (input.stopLoss as number));
  const requested = input.manualLotSize;
  if (requested == null || !(requested > 0)) {
    return {
      ok: false,
      volume: null,
      riskAmount: Math.max(0, input.riskAmountEur),
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "MANUAL_LOT_SIZE_REQUIRED",
      notes
    };
  }
  const min = input.minVolume as number;
  const step = input.volumeStep as number;
  const max = input.maxVolume as number;
  if (requested < min) {
    return {
      ok: false,
      volume: null,
      riskAmount: Math.max(0, input.riskAmountEur),
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "VOLUME_BELOW_MINIMUM",
      notes: [
        `Requested ${requested} lots is below broker minimum ${min}. Adjust the lot size — it will not be increased automatically.`
      ]
    };
  }
  if (requested > max) {
    return {
      ok: false,
      volume: null,
      riskAmount: Math.max(0, input.riskAmountEur),
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "VOLUME_ABOVE_MAXIMUM",
      notes: [`Requested ${requested} lots exceeds broker maximum ${max}.`]
    };
  }
  const rounded = roundDownLotsToStep(requested, step);
  if (Math.abs(rounded - requested) > 1e-9) {
    return {
      ok: false,
      volume: null,
      riskAmount: Math.max(0, input.riskAmountEur),
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "VOLUME_STEP_MISMATCH",
      notes: [
        `Requested ${requested} lots does not match broker step ${step}. Nearest valid (round down) would be ${rounded} — not applied automatically.`
      ]
    };
  }
  return attachEstimates(requested, input, stopDistance, Math.max(0, input.riskAmountEur), notes);
}

export function calculateCTraderVolume(input: SizingInput): SizingResult {
  if (input.sizingMode === "manual_lots") {
    return calculateManualLotVolume(input);
  }

  const notes: string[] = ["Automatic risk-based sizing"];
  // Use the user's chosen risk — do not silently raise it to meet broker minimums.
  const riskAmount = Math.max(0, input.riskAmountEur);
  const early = validateCommonSizingMeta(input, notes);
  if (early) return early;

  const stopDistance = Math.abs((input.entryPrice as number) - (input.stopLoss as number));

  // Risk = volumeLots * contractSize * stopDistance (quote currency).
  // minVolume/volumeStep/maxVolume/lotSize MUST already be lot-denominated
  // (see volumeUnits.parseCTraderVolumeRules — never pass raw Open API cents here).
  const riskInQuote = riskAmount * (input.eurToAccountRate as number);
  const rawVolume = riskInQuote / ((input.lotSize as number) * stopDistance);
  const volume = roundDownLotsToStep(rawVolume, input.volumeStep as number);

  if (!(volume > 0)) {
    return {
      ok: false,
      volume: null,
      riskAmount,
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "VOLUME_BELOW_MINIMUM_AFTER_ROUNDING",
      notes: [
        ...notes,
        "Calculated volume rounds below the broker minimum. Increase risk or stop distance — volume will not be raised automatically."
      ]
    };
  }
  if (volume < (input.minVolume as number)) {
    return {
      ok: false,
      volume: null,
      riskAmount,
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "VOLUME_BELOW_MINIMUM",
      notes: [
        ...notes,
        `Calculated ${volume} lots < broker minimum ${input.minVolume}. Adjust risk or switch to manual lots.`
      ]
    };
  }
  if (volume > (input.maxVolume as number)) {
    return {
      ok: false,
      volume: null,
      riskAmount,
      stopDistance,
      estimatedMargin: null,
      estimatedMaxLoss: null,
      rejectionReason: "VOLUME_ABOVE_MAXIMUM",
      notes: [
        ...notes,
        `Calculated ${volume} lots exceeds broker maximum ${input.maxVolume}. Reduce risk — volume will not be capped silently.`
      ]
    };
  }

  return attachEstimates(volume, input, stopDistance, riskAmount, notes);
}
