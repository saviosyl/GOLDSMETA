/**
 * Gold Hunter entry / fill price validity.
 * entry <= 0 must never drive FILLED state or dynamic exits.
 */

export function isValidGoldHunterEntryPrice(
  entry: number | null | undefined
): boolean {
  return entry != null && Number.isFinite(entry) && entry > 0;
}

export function isValidGoldHunterBrokerPositionId(
  positionId: string | null | undefined
): boolean {
  return positionId != null && String(positionId).trim().length > 0;
}

/**
 * A broker fill may become FILLED only with finite entry > 0 and a position id.
 */
export function isAuthoritativeGoldHunterFill(args: {
  fillPrice: number | null | undefined;
  positionId: string | null | undefined;
  filledVolumeLots?: number | null;
}): boolean {
  if (!isValidGoldHunterEntryPrice(args.fillPrice)) return false;
  if (!isValidGoldHunterBrokerPositionId(args.positionId)) return false;
  if (
    args.filledVolumeLots != null &&
    (!Number.isFinite(args.filledVolumeLots) || args.filledVolumeLots <= 0)
  ) {
    return false;
  }
  return true;
}

/** Detect absurd MFE/MAE that imply entry contamination (diagnostic only). */
export function isCorruptGoldHunterMfeMae(args: {
  mfe: number | null | undefined;
  mae: number | null | undefined;
  hardStop: number;
}): boolean {
  const cap = Math.max(5, args.hardStop * 20);
  if (args.mfe != null && Number.isFinite(args.mfe) && args.mfe > cap) {
    return true;
  }
  if (args.mae != null && Number.isFinite(args.mae) && args.mae < -cap) {
    return true;
  }
  return false;
}
