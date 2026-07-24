/**
 * Account-specific XAUUSD symbol resolution.
 * Never hardcode symbol IDs. Never guess missing metadata.
 */

import type { BrokerSymbol } from "../domain";

export interface RawCTraderSymbol {
  symbolId?: string | number;
  symbolName?: string;
  description?: string;
  baseAsset?: string;
  quoteAsset?: string;
  digits?: number;
  pipPosition?: number;
  tickSize?: number;
  minVolume?: number;
  stepVolume?: number;
  maxVolume?: number;
  lotSize?: number;
  commissionType?: string;
  commission?: number;
  minCommission?: number;
  swapLong?: number;
  swapShort?: number;
  minStopDistance?: number;
  guaranteedStopAvailable?: boolean;
  scheduleId?: string | number;
}

const NAME_CANDIDATES = [
  /^xauusd$/i,
  /^gold$/i,
  /^xau\/usd$/i,
  /^xauusd[._-]/i,
  /^gold[._-]/i
];

function looksLikeGoldUsd(raw: RawCTraderSymbol): boolean {
  const name = `${raw.symbolName ?? ""} ${raw.description ?? ""}`.toLowerCase();
  const base = (raw.baseAsset ?? "").toUpperCase();
  const quote = (raw.quoteAsset ?? "").toUpperCase();
  if ((base === "XAU" || base === "GOLD") && (quote === "USD" || quote === "USDT")) {
    return true;
  }
  if (NAME_CANDIDATES.some((re) => re.test((raw.symbolName ?? "").trim()))) {
    // Require asset metadata when name alone is used
    if (base && quote) return (base === "XAU" || base === "GOLD") && quote.includes("USD");
    // Name match without assets is insufficient — do not accept
    return false;
  }
  if (name.includes("gold") && name.includes("usd") && base && quote) {
    return (base === "XAU" || base === "GOLD") && quote.includes("USD");
  }
  return false;
}

export function resolveXauUsdFromCatalogue(
  symbols: RawCTraderSymbol[],
  brokerId: "pepperstone_ctrader" = "pepperstone_ctrader",
  environment: "DEMO" = "DEMO"
): BrokerSymbol | null {
  const matches = symbols.filter(looksLikeGoldUsd);
  if (matches.length !== 1) return null;
  const raw = matches[0]!;
  const missing: string[] = [];
  const req: Array<[keyof RawCTraderSymbol, string]> = [
    ["symbolId", "symbolId"],
    ["symbolName", "symbolName"],
    ["baseAsset", "baseAsset"],
    ["quoteAsset", "quoteAsset"],
    ["digits", "digits"],
    ["tickSize", "tickSize"],
    ["minVolume", "minVolume"],
    ["stepVolume", "volumeStep"],
    ["maxVolume", "maxVolume"],
    ["lotSize", "lotSize"]
  ];
  for (const [key, label] of req) {
    if (raw[key] == null || raw[key] === "") missing.push(label);
  }

  return {
    brokerId,
    environment,
    symbolId: String(raw.symbolId),
    symbolName: String(raw.symbolName),
    displayName: String(raw.symbolName),
    baseAsset: raw.baseAsset ?? null,
    quoteAsset: raw.quoteAsset ?? null,
    digits: raw.digits ?? null,
    pipPosition: raw.pipPosition ?? null,
    tickSize: raw.tickSize ?? null,
    minVolume: raw.minVolume ?? null,
    volumeStep: raw.stepVolume ?? null,
    maxVolume: raw.maxVolume ?? null,
    lotSize: raw.lotSize ?? null,
    commissionType: raw.commissionType ?? null,
    commissionAmount: raw.commission ?? null,
    minCommission: raw.minCommission ?? null,
    swapLong: raw.swapLong ?? null,
    swapShort: raw.swapShort ?? null,
    minStopDistance: raw.minStopDistance ?? null,
    guaranteedStopAvailable: raw.guaranteedStopAvailable ?? null,
    tradingScheduleId:
      raw.scheduleId != null ? String(raw.scheduleId) : null,
    metadataComplete: missing.length === 0,
    missingFields: missing
  };
}
