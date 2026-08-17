/**
 * Official cTrader Open API volume contract helpers (documentation + proof).
 *
 * ProtoOANewOrderReq.volume / Deal.filledVolume / Position.tradeData.volume /
 * ClosePositionReq.volume are RAW protocol integers in **0.01 of a trading unit**.
 *
 * ProtoOASymbol.lotSize is also in cents (0.01 of a trading unit per conventional lot).
 *
 * This module does NOT retune production economic sizing. Gold Hunter / Pepperstone
 * fields historically named `*Lots` often store **trading units** (≈ XAU oz under the
 * proven Pepperstone Demo mapping), not conventional 100-oz lots — rename later.
 */

/** Official Open API scale: protocol raw / 100 = trading units. */
export const CTRADER_PROTOCOL_UNITS_PER_TRADING_UNIT = 100;

export type CTraderVolumeContractBreakdown = {
  rawProtocolVolume: number;
  tradingUnits: number;
  rawLotSize: number;
  tradingUnitsPerConventionalLot: number;
  conventionalLots: number;
  /** When Pepperstone Demo XAU mapping (1 trading unit ≈ 1 oz) applies. */
  xauOuncesIfOneTradingUnitIsOneOz: number;
};

export function tradingUnitsFromRawProtocolVolume(
  rawProtocolVolume: number
): number {
  if (!Number.isFinite(rawProtocolVolume)) {
    throw new Error("CTRADER_RAW_PROTOCOL_VOLUME_INVALID");
  }
  return rawProtocolVolume / CTRADER_PROTOCOL_UNITS_PER_TRADING_UNIT;
}

export function tradingUnitsPerConventionalLotFromRawLotSize(
  rawLotSize: number
): number {
  if (!Number.isFinite(rawLotSize) || !(rawLotSize > 0)) {
    throw new Error("CTRADER_RAW_LOT_SIZE_INVALID");
  }
  return rawLotSize / CTRADER_PROTOCOL_UNITS_PER_TRADING_UNIT;
}

export function conventionalLotsFromTradingUnits(args: {
  tradingUnits: number;
  tradingUnitsPerConventionalLot: number;
}): number {
  if (
    !Number.isFinite(args.tradingUnits) ||
    !Number.isFinite(args.tradingUnitsPerConventionalLot) ||
    !(args.tradingUnitsPerConventionalLot > 0)
  ) {
    throw new Error("CTRADER_CONVENTIONAL_LOTS_INPUT_INVALID");
  }
  return args.tradingUnits / args.tradingUnitsPerConventionalLot;
}

export function breakDownCTraderVolumeContract(args: {
  rawProtocolVolume: number;
  rawLotSize: number;
}): CTraderVolumeContractBreakdown {
  const tradingUnits = tradingUnitsFromRawProtocolVolume(args.rawProtocolVolume);
  const tradingUnitsPerConventionalLot =
    tradingUnitsPerConventionalLotFromRawLotSize(args.rawLotSize);
  const conventionalLots = conventionalLotsFromTradingUnits({
    tradingUnits,
    tradingUnitsPerConventionalLot
  });
  return {
    rawProtocolVolume: args.rawProtocolVolume,
    tradingUnits,
    rawLotSize: args.rawLotSize,
    tradingUnitsPerConventionalLot,
    conventionalLots,
    xauOuncesIfOneTradingUnitIsOneOz: tradingUnits
  };
}

/**
 * Pepperstone Demo XAUUSD (symbolId 41) — raw ProtoOASymbolById fields
 * captured against demo.ctraderapi.com (same provenance as volumeUnits unit tests).
 */
export const PEPPERSTONE_XAUUSD_DEMO_PROTO_SYMBOL = {
  symbolId: "41",
  symbolName: "XAUUSD",
  minVolume: 100,
  maxVolume: 500000,
  stepVolume: 100,
  lotSize: 10000,
  digits: 2,
  pipPosition: 1,
  /** measurementUnits not always present on ProtoOASymbolById; omit when absent. */
  measurementUnits: null as string | null
} as const;

/**
 * Known Gold Hunter Demo economic size used today: protocol raw volume 18.
 * Under Pepperstone proven mapping (protocol/100 = displayed "lots" = oz):
 * intended exposure = 0.18 XAU oz.
 *
 * Official conventional-lot math with lotSize=10000:
 * tradingUnits=0.18, conventionalLots=0.0018.
 *
 * Do NOT infer from any stored `filledVolumeLots` field name.
 */
export const PEPPERSTONE_GH_DEMO_KNOWN_TRADE_RAW = {
  intendedEconomicXauOz: 0.18,
  rawNewOrderVolume: 18,
  rawDealFilledVolume: 18,
  rawPositionTradeDataVolume: 18,
  rawClosingDealClosedVolume: 18,
  rawClosePositionVolume: 18
} as const;
