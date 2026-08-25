/**
 * Broker fill / volume economics. Proto defaults of 0 are missing, not zero price.
 */

const SPOT_PRICE_SCALE = 100_000;
const CTRADER_VOLUME_CENTS_PER_LOT = 100;
const PLAUSIBLE_XAU_MIN = 100;
const PLAUSIBLE_XAU_MAX = 20_000;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 0 / non-finite is missing. Never treat proto default 0 as an economic value. */
export function presentEconomicNumber(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null || n === 0) return null;
  return n;
}

export function normalizeBrokerPrice(value: unknown): number | null {
  const n = presentEconomicNumber(value);
  if (n == null) return null;
  if (n > PLAUSIBLE_XAU_MAX && n / SPOT_PRICE_SCALE >= PLAUSIBLE_XAU_MIN) {
    return n / SPOT_PRICE_SCALE;
  }
  if (n < PLAUSIBLE_XAU_MIN || n > PLAUSIBLE_XAU_MAX) return null;
  return n;
}

export function normalizeFilledLots(args: {
  filledVolumeLots?: unknown;
  filledVolumeCents?: unknown;
}): number | null {
  const lots = presentEconomicNumber(args.filledVolumeLots);
  if (lots != null && lots > 0) return Number(lots.toFixed(8));
  const cents = presentEconomicNumber(args.filledVolumeCents);
  if (cents != null && cents > 0) {
    return Number((cents / CTRADER_VOLUME_CENTS_PER_LOT).toFixed(8));
  }
  return null;
}

export type BrokerFillEconomics = {
  fillPrice: number | null;
  filledVolumeLots: number | null;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  brokerStopLoss: number | null;
  brokerTakeProfit: number | null;
  complete: boolean;
};

export function resolveBrokerFillEconomics(args: {
  fillPrice?: unknown;
  filledVolumeLots?: unknown;
  filledVolumeCents?: unknown;
  brokerOrderId?: unknown;
  brokerPositionId?: unknown;
  stopLoss?: unknown;
  takeProfit?: unknown;
}): BrokerFillEconomics {
  const fillPrice = normalizeBrokerPrice(args.fillPrice);
  const filledVolumeLots = normalizeFilledLots({
    filledVolumeLots: args.filledVolumeLots,
    filledVolumeCents: args.filledVolumeCents
  });
  const brokerOrderId =
    args.brokerOrderId != null && String(args.brokerOrderId).trim()
      ? String(args.brokerOrderId).trim()
      : null;
  const brokerPositionId =
    args.brokerPositionId != null && String(args.brokerPositionId).trim()
      ? String(args.brokerPositionId).trim()
      : null;
  return {
    fillPrice,
    filledVolumeLots,
    brokerOrderId,
    brokerPositionId,
    brokerStopLoss: normalizeBrokerPrice(args.stopLoss),
    brokerTakeProfit: normalizeBrokerPrice(args.takeProfit),
    complete: fillPrice != null && filledVolumeLots != null && brokerPositionId != null
  };
}
