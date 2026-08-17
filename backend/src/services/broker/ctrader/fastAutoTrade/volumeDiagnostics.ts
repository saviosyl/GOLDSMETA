/**
 * Diagnostics for VOLUME_BELOW_MINIMUM_AFTER_ROUNDING.
 * Does not change economic mapping — audit-only unless tests prove a unit error.
 */

import {
  CTRADER_VOLUME_CENTS_PER_LOT,
  lotsToOrderVolumeUnits,
  parseCTraderVolumeRules,
  roundDownLotsToStep,
  type CTraderVolumeRules,
  type RawCTraderVolumeFields
} from "../volumeUnits";

export type VolumeRoundingDiagnostics = {
  effectiveRiskAmountDeposit: number | null;
  riskMultiplier: number | null;
  entryPrice: number | null;
  stopPrice: number | null;
  stopDistance: number | null;
  quoteToDepositRate: number | null;
  riskPerInternalVolumeUnit: number | null;
  rawCalculatedVolume: number | null;
  brokerMinVolumeRaw: number | null;
  brokerStepVolumeRaw: number | null;
  brokerLotSizeRaw: number | null;
  normalizedMin: number | null;
  normalizedStep: number | null;
  normalizedContractSize: number | null;
  roundedFinalSize: number | null;
  protocolVolumeCentsPerLot: typeof CTRADER_VOLUME_CENTS_PER_LOT;
  mappingUnchanged: true;
};

export function buildVolumeRoundingDiagnostics(args: {
  effectiveRiskAmountDeposit?: number | null;
  riskMultiplier?: number | null;
  entryPrice?: number | null;
  stopPrice?: number | null;
  stopDistance?: number | null;
  quoteToDepositRate?: number | null;
  riskPerLotDeposit?: number | null;
  rawLots?: number | null;
  roundedLots?: number | null;
  rawSymbol?: Partial<RawCTraderVolumeFields> | null;
  rules?: CTraderVolumeRules | null;
}): VolumeRoundingDiagnostics {
  let rules = args.rules ?? null;
  if (
    !rules &&
    args.rawSymbol &&
    args.rawSymbol.minVolume != null &&
    args.rawSymbol.stepVolume != null &&
    args.rawSymbol.lotSize != null &&
    args.rawSymbol.maxVolume != null
  ) {
    try {
      rules = parseCTraderVolumeRules(args.rawSymbol as RawCTraderVolumeFields);
    } catch {
      rules = null;
    }
  }

  return {
    effectiveRiskAmountDeposit: finiteOrNull(args.effectiveRiskAmountDeposit),
    riskMultiplier: finiteOrNull(args.riskMultiplier),
    entryPrice: finiteOrNull(args.entryPrice),
    stopPrice: finiteOrNull(args.stopPrice),
    stopDistance: finiteOrNull(args.stopDistance),
    quoteToDepositRate: finiteOrNull(args.quoteToDepositRate),
    riskPerInternalVolumeUnit: finiteOrNull(args.riskPerLotDeposit),
    rawCalculatedVolume: finiteOrNull(args.rawLots),
    brokerMinVolumeRaw: rules?.rawMinVolume ?? finiteOrNull(args.rawSymbol?.minVolume),
    brokerStepVolumeRaw: rules?.rawStepVolume ?? finiteOrNull(args.rawSymbol?.stepVolume),
    brokerLotSizeRaw: rules?.rawLotSize ?? finiteOrNull(args.rawSymbol?.lotSize),
    normalizedMin: rules?.minLots ?? null,
    normalizedStep: rules?.stepLots ?? null,
    normalizedContractSize: rules?.contractSize ?? null,
    roundedFinalSize: finiteOrNull(args.roundedLots),
    protocolVolumeCentsPerLot: CTRADER_VOLUME_CENTS_PER_LOT,
    mappingUnchanged: true
  };
}

export function computeRawLotsFromRisk(args: {
  riskAmount: number;
  riskPerLotDeposit: number;
  stepLots: number;
}): { rawLots: number; roundedLots: number; protocolVolume: number } {
  const rawLots = args.riskAmount / args.riskPerLotDeposit;
  const roundedLots = roundDownLotsToStep(rawLots, args.stepLots);
  return {
    rawLots,
    roundedLots,
    protocolVolume: roundedLots > 0 ? lotsToOrderVolumeUnits(roundedLots) : 0
  };
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
