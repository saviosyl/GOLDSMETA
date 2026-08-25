/**
 * cTrader / Spotware Open API volume units.
 *
 * Official model (help.ctrader.com Open API model messages):
 * - Order `volume`, symbol `minVolume` / `maxVolume` / `stepVolume` are in **cents**
 * - Example: protocol volume `1000` means `10.00` lots
 * - Therefore: **100 cents = 1.00 lot**
 * - Symbol `lotSize` is also in cents of the base asset
 *   (e.g. `10000` → `100.00` units of XAU per 1.00 lot)
 *
 * Never treat raw Open API integers as lots without dividing by
 * {@link CTRADER_VOLUME_CENTS_PER_LOT}.
 */

/** Spotware volume scale: protocol cents per 1.00 lot. */
export const CTRADER_VOLUME_CENTS_PER_LOT = 100;

export type RawCTraderVolumeFields = {
  minVolume: number | string;
  maxVolume: number | string;
  stepVolume: number | string;
  lotSize: number | string;
};

export type CTraderVolumeRules = {
  /** Raw protocol integers (cents). */
  rawMinVolume: number;
  rawMaxVolume: number;
  rawStepVolume: number;
  rawLotSize: number;
  /** Scale factor applied to convert protocol → lots / base units. */
  apiVolumeScalingFactor: typeof CTRADER_VOLUME_CENTS_PER_LOT;
  /** Minimum tradable size in lots. */
  minLots: number;
  /** Maximum tradable size in lots. */
  maxLots: number;
  /** Volume step in lots. */
  stepLots: number;
  /** Base-asset units per 1.00 lot (lotSize cents ÷ scale). */
  contractSize: number;
  /** Protocol volume units required when submitting 1.00 lot. */
  orderVolumeUnitsPerLot: typeof CTRADER_VOLUME_CENTS_PER_LOT;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Convert protocol volume cents → lots (or base-asset units for lotSize). */
export function centsToLots(cents: number): number {
  if (!Number.isFinite(cents)) {
    throw new Error("CTRADER_VOLUME_CENTS_INVALID");
  }
  return cents / CTRADER_VOLUME_CENTS_PER_LOT;
}

/** Convert lots → protocol volume cents for a future NewOrderReq.volume. */
export function lotsToOrderVolumeUnits(lots: number): number {
  if (!Number.isFinite(lots) || lots < 0) {
    throw new Error("CTRADER_VOLUME_LOTS_INVALID");
  }
  return Math.round(lots * CTRADER_VOLUME_CENTS_PER_LOT);
}

/** Round down to the nearest volume step (lots). */
export function roundDownLotsToStep(lots: number, stepLots: number): number {
  if (!(stepLots > 0) || !(lots > 0)) return 0;
  const units = Math.floor(lots / stepLots + 1e-12);
  return Number((units * stepLots).toFixed(8));
}

/**
 * Parse raw ProtoOASymbol volume fields into lot-denominated rules.
 * Throws if any required raw field is missing/non-numeric.
 */
export function parseCTraderVolumeRules(
  raw: RawCTraderVolumeFields
): CTraderVolumeRules {
  const rawMinVolume = asFiniteNumber(raw.minVolume);
  const rawMaxVolume = asFiniteNumber(raw.maxVolume);
  const rawStepVolume = asFiniteNumber(raw.stepVolume);
  const rawLotSize = asFiniteNumber(raw.lotSize);
  if (
    rawMinVolume == null ||
    rawMaxVolume == null ||
    rawStepVolume == null ||
    rawLotSize == null
  ) {
    throw new Error("CTRADER_VOLUME_METADATA_INCOMPLETE");
  }
  if (!(rawMinVolume > 0) || !(rawStepVolume > 0) || !(rawLotSize > 0)) {
    throw new Error("CTRADER_VOLUME_METADATA_INVALID");
  }
  return {
    rawMinVolume,
    rawMaxVolume,
    rawStepVolume,
    rawLotSize,
    apiVolumeScalingFactor: CTRADER_VOLUME_CENTS_PER_LOT,
    minLots: centsToLots(rawMinVolume),
    maxLots: centsToLots(rawMaxVolume),
    stepLots: centsToLots(rawStepVolume),
    contractSize: centsToLots(rawLotSize),
    orderVolumeUnitsPerLot: CTRADER_VOLUME_CENTS_PER_LOT
  };
}

/**
 * Validate a proposed size in lots against parsed rules.
 * Always rounds down to step before min/max checks.
 */
export function validateLotsAgainstRules(
  proposedLots: number,
  rules: CTraderVolumeRules
): {
  ok: boolean;
  roundedLots: number | null;
  orderVolumeUnits: number | null;
  rejectionReason: string | null;
} {
  if (!Number.isFinite(proposedLots) || proposedLots <= 0) {
    return {
      ok: false,
      roundedLots: null,
      orderVolumeUnits: null,
      rejectionReason: "VOLUME_BELOW_MINIMUM_AFTER_ROUNDING"
    };
  }
  const roundedLots = roundDownLotsToStep(proposedLots, rules.stepLots);
  if (!(roundedLots > 0)) {
    return {
      ok: false,
      roundedLots: null,
      orderVolumeUnits: null,
      rejectionReason: "VOLUME_BELOW_MINIMUM_AFTER_ROUNDING"
    };
  }
  if (roundedLots < rules.minLots) {
    return {
      ok: false,
      roundedLots: null,
      orderVolumeUnits: null,
      rejectionReason: "VOLUME_BELOW_MINIMUM"
    };
  }
  let finalLots = roundedLots;
  if (finalLots > rules.maxLots) {
    finalLots = roundDownLotsToStep(rules.maxLots, rules.stepLots);
    if (finalLots < rules.minLots) {
      return {
        ok: false,
        roundedLots: null,
        orderVolumeUnits: null,
        rejectionReason: "VOLUME_ABOVE_MAXIMUM"
      };
    }
  }
  return {
    ok: true,
    roundedLots: finalLots,
    orderVolumeUnits: lotsToOrderVolumeUnits(finalLots),
    rejectionReason: null
  };
}

/**
 * Central lots → broker volume conversion using lot-denominated symbol metadata.
 * Prefer this over ad-hoc `lots * 100` in management/close paths.
 */
export function lotsToValidatedBrokerVolume(args: {
  lots: number;
  minLots: number;
  maxLots: number;
  stepLots: number;
}): {
  ok: boolean;
  roundedLots: number | null;
  orderVolumeUnits: number | null;
  rejectionReason: string | null;
} {
  if (
    !(args.minLots > 0) ||
    !(args.stepLots > 0) ||
    !(args.maxLots > 0) ||
    !Number.isFinite(args.minLots) ||
    !Number.isFinite(args.stepLots) ||
    !Number.isFinite(args.maxLots)
  ) {
    return {
      ok: false,
      roundedLots: null,
      orderVolumeUnits: null,
      rejectionReason: "VOLUME_METADATA_INVALID"
    };
  }
  const rules: CTraderVolumeRules = {
    rawMinVolume: lotsToOrderVolumeUnits(args.minLots),
    rawMaxVolume: lotsToOrderVolumeUnits(args.maxLots),
    rawStepVolume: lotsToOrderVolumeUnits(args.stepLots),
    rawLotSize: lotsToOrderVolumeUnits(1),
    apiVolumeScalingFactor: CTRADER_VOLUME_CENTS_PER_LOT,
    minLots: args.minLots,
    maxLots: args.maxLots,
    stepLots: args.stepLots,
    contractSize: 1,
    orderVolumeUnitsPerLot: CTRADER_VOLUME_CENTS_PER_LOT
  };
  return validateLotsAgainstRules(args.lots, rules);
}
