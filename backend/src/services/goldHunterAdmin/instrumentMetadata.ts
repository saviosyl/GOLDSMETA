/**
 * Authoritative XAUUSD instrument metadata for Gold Hunter sizing.
 * Fail closed when critical fields are missing — never invent maxLots=100.
 */
import type { BrokerSymbol } from "../broker/domain";
import { getConnection } from "../broker/ctrader/connectionStore";
import { PEPPERSTONE_CTRADER_XAUUSD_DEMO } from "../broker/ctrader/brokerUnitMappings";

export type GoldHunterInstrumentMetadata = {
  symbolId: string;
  symbolName: string;
  digits: number | null;
  minLots: number;
  maxLots: number;
  lotStep: number;
  /** Quote-currency (USD) value per 1.0 price point per 1.0 lot. */
  valuePerPointPerLot: number;
  ozPerLot: number;
  minStopDistance: number | null;
  complete: boolean;
  missing: string[];
};

/**
 * Build metadata from a resolved BrokerSymbol. Missing critical fields → incomplete.
 */
export function metadataFromBrokerSymbol(
  symbol: Pick<
    BrokerSymbol,
    | "symbolId"
    | "symbolName"
    | "digits"
    | "minVolume"
    | "maxVolume"
    | "volumeStep"
    | "normalizedMinStopPriceDistance"
  >
): GoldHunterInstrumentMetadata {
  const missing: string[] = [];
  const symbolId = symbol.symbolId != null ? String(symbol.symbolId) : "";
  if (!symbolId) missing.push("symbolId");
  if (symbol.minVolume == null || !(symbol.minVolume > 0)) missing.push("minVolume");
  if (symbol.maxVolume == null || !(symbol.maxVolume > 0)) missing.push("maxVolume");
  if (symbol.volumeStep == null || !(symbol.volumeStep > 0)) missing.push("volumeStep");

  const ozPerLot = PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot;
  const valuePerPointPerLot = ozPerLot; // $1/point/oz for XAUUSD

  return {
    symbolId,
    symbolName: symbol.symbolName || "XAUUSD",
    digits: symbol.digits ?? null,
    minLots: symbol.minVolume != null && symbol.minVolume > 0 ? symbol.minVolume : 0,
    maxLots: symbol.maxVolume != null && symbol.maxVolume > 0 ? symbol.maxVolume : 0,
    lotStep: symbol.volumeStep != null && symbol.volumeStep > 0 ? symbol.volumeStep : 0,
    valuePerPointPerLot,
    ozPerLot,
    minStopDistance: symbol.normalizedMinStopPriceDistance ?? null,
    complete: missing.length === 0,
    missing
  };
}

/**
 * Resolve from connection symbolId + optional injected symbol (tests / prefetched).
 */
export async function resolveGoldHunterInstrumentMetadata(args: {
  ownerUid: string;
  symbol?: BrokerSymbol | null;
}): Promise<GoldHunterInstrumentMetadata> {
  if (args.symbol) return metadataFromBrokerSymbol(args.symbol);

  const connection = await getConnection(args.ownerUid);
  const missing: string[] = ["minVolume", "maxVolume", "volumeStep"];
  const symbolId = connection?.symbolId ? String(connection.symbolId) : "";
  if (!symbolId) missing.push("symbolId");

  // Connection alone lacks volume rules — incomplete until symbol catalogue provided.
  return {
    symbolId,
    symbolName: connection?.symbolName ?? "XAUUSD",
    digits: connection?.symbolDigits ?? null,
    minLots: 0,
    maxLots: 0,
    lotStep: 0,
    valuePerPointPerLot: PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot,
    ozPerLot: PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot,
    minStopDistance: null,
    complete: false,
    missing
  };
}
