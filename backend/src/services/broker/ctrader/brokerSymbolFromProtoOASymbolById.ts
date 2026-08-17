/**
 * Parse ProtoOASymbolById detail into BrokerSymbol using the SAME volume and
 * stop-distance conversion rules as discoverXauUsd.
 * Never invent min/max/step/lot/stop fields.
 */
import type { BrokerEnvironment, BrokerSymbol } from "../domain";
import { parseCTraderVolumeRules } from "./volumeUnits";
import { normalizeSlDistanceToPrice } from "./ctraderStopDistance";
import {
  resolveXauUsdFromCatalogue,
  type RawCTraderSymbol
} from "./symbolResolver";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type ParseProtoOASymbolByIdArgs = {
  detail: Record<string, unknown>;
  /** Known symbol identity from connection / list (authoritative id). */
  symbolId: string | number;
  symbolName?: string | null;
  baseAsset?: string | null;
  quoteAsset?: string | null;
  environment: Extract<BrokerEnvironment, "DEMO" | "LIVE">;
  brokerId?: "pepperstone_ctrader";
};

/**
 * Convert a ProtoOASymbolById payload (+ known identity) into BrokerSymbol.
 * Returns null when volume rules cannot be parsed or catalogue gate fails.
 */
export function brokerSymbolFromProtoOASymbolById(
  args: ParseProtoOASymbolByIdArgs
): BrokerSymbol | null {
  const detail = args.detail ?? {};
  const digits = asNumber(detail.digits);
  let volumeRules: ReturnType<typeof parseCTraderVolumeRules> | null = null;
  try {
    volumeRules = parseCTraderVolumeRules({
      minVolume: detail.minVolume as number | string,
      maxVolume: detail.maxVolume as number | string,
      stepVolume: detail.stepVolume as number | string,
      lotSize: detail.lotSize as number | string
    });
  } catch {
    volumeRules = null;
  }
  if (!volumeRules) return null;

  const rawSlDistance = asNumber(detail.slDistance);
  const distanceSetInRaw =
    detail.distanceSetIn != null
      ? (detail.distanceSetIn as string | number)
      : undefined;
  let normalizedMinStopPriceDistance: number | undefined;
  if (rawSlDistance != null && digits != null) {
    const norm = normalizeSlDistanceToPrice({
      rawSlDistance,
      distanceSetIn: distanceSetInRaw ?? 1,
      digits
    });
    if (norm.ok) {
      normalizedMinStopPriceDistance = norm.normalizedMinStopPriceDistance;
    }
  }

  const detailName =
    typeof detail.symbolName === "string" && detail.symbolName.trim()
      ? detail.symbolName.trim()
      : null;
  const symbolName =
    (args.symbolName && String(args.symbolName).trim()) ||
    detailName ||
    "XAUUSD";

  const enriched: RawCTraderSymbol = {
    symbolId: args.symbolId,
    symbolName,
    description: String(detail.description ?? ""),
    baseAsset: args.baseAsset ?? "XAU",
    quoteAsset: args.quoteAsset ?? "USD",
    digits: digits ?? undefined,
    pipPosition: asNumber(detail.pipPosition) ?? undefined,
    tickSize: digits != null ? Math.pow(10, -digits) : undefined,
    minVolume: volumeRules.minLots,
    stepVolume: volumeRules.stepLots,
    maxVolume: volumeRules.maxLots,
    lotSize: volumeRules.contractSize,
    rawSlDistance: rawSlDistance ?? undefined,
    distanceSetIn: distanceSetInRaw,
    rawTpDistance: asNumber(detail.tpDistance) ?? undefined,
    normalizedMinStopPriceDistance,
    minStopDistance: normalizedMinStopPriceDistance,
    commissionType:
      typeof detail.commissionType === "string"
        ? detail.commissionType
        : undefined,
    commission: asNumber(detail.commission) ?? undefined,
    minCommission: asNumber(detail.minCommission) ?? undefined,
    swapLong: asNumber(detail.swapLong) ?? undefined,
    swapShort: asNumber(detail.swapShort) ?? undefined,
    guaranteedStopAvailable:
      typeof detail.guaranteedStopLoss === "boolean"
        ? detail.guaranteedStopLoss
        : undefined,
    scheduleId:
      typeof detail.scheduleTimeZone === "string"
        ? detail.scheduleTimeZone
        : detail.schedule != null
          ? "schedule"
          : undefined
  };

  const resolved = resolveXauUsdFromCatalogue(
    [enriched],
    args.brokerId ?? "pepperstone_ctrader",
    args.environment
  );
  if (!resolved) return null;

  const tz =
    typeof detail.scheduleTimeZone === "string"
      ? detail.scheduleTimeZone
      : null;
  return {
    ...resolved,
    tradingScheduleId: tz ?? resolved.tradingScheduleId
  };
}
