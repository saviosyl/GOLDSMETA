/**
 * Broker-specific economic unit mappings for cash-risk sizing.
 *
 * Spotware ProtoOASymbol.lotSize is a catalogue field (cents). It must NOT be
 * blindly used as ounces-per-lot for risk. Only proven mappings belong here.
 */

export type BrokerUnitMappingKey = "pepperstone_ctrader_xauusd_demo";

export type BrokerEconomicUnitMapping = {
  key: BrokerUnitMappingKey;
  brokerId: "pepperstone_ctrader";
  symbolName: "XAUUSD";
  environment: "DEMO";
  /** Economic base-asset units (oz for XAUUSD) per 1.00 displayed lot. */
  ozPerLot: number;
  /** Open API protocol cents per 1.00 lot. */
  protocolCentsPerLot: number;
  /** Human-readable provenance for audits. */
  provenBy: string;
};

/**
 * Proven on Demo ctidTraderAccountId 48014710 / PID53870324:
 * protocol 1300 = 13.00 lots = 13.00 oz; PnL matches 1 oz/lot.
 */
export const PEPPERSTONE_CTRADER_XAUUSD_DEMO: BrokerEconomicUnitMapping = {
  key: "pepperstone_ctrader_xauusd_demo",
  brokerId: "pepperstone_ctrader",
  symbolName: "XAUUSD",
  environment: "DEMO",
  ozPerLot: 1,
  protocolCentsPerLot: 100,
  provenBy:
    "PID53870324: 13 lots × 0.26 × quoteToDeposit≈0.86624 ≈ €2.93 gross; UI 13.00 oz"
};

export function resolvePepperstoneXauUsdDemoMapping(args: {
  pepperstoneConfirmed: boolean;
  selectedAccountIsLive: boolean;
  symbolName: string | null | undefined;
}): BrokerEconomicUnitMapping | null {
  if (!args.pepperstoneConfirmed) return null;
  if (args.selectedAccountIsLive) return null;
  const name = String(args.symbolName ?? "")
    .trim()
    .toUpperCase();
  if (name !== "XAUUSD" && name !== "XAU/USD") return null;
  return PEPPERSTONE_CTRADER_XAUUSD_DEMO;
}

/** Protocol volume cents ↔ lots for Spotware orders. */
export function protocolVolumeFromLots(
  lots: number,
  centsPerLot = PEPPERSTONE_CTRADER_XAUUSD_DEMO.protocolCentsPerLot
): number {
  return Math.round(lots * centsPerLot);
}

export function lotsFromProtocolVolume(
  protocolVolume: number,
  centsPerLot = PEPPERSTONE_CTRADER_XAUUSD_DEMO.protocolCentsPerLot
): number {
  return protocolVolume / centsPerLot;
}

/** Reconstruct deposit-currency gross P/L for XAUUSD (oz model). */
export function estimateXauUsdGrossPnlDeposit(args: {
  lots: number;
  priceMove: number;
  ozPerLot: number;
  quoteToDepositRate: number;
}): number {
  return (
    args.lots *
    args.ozPerLot *
    args.priceMove *
    args.quoteToDepositRate
  );
}
