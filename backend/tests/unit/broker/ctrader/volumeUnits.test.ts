import { describe, expect, it } from "vitest";
import {
  CTRADER_VOLUME_CENTS_PER_LOT,
  centsToLots,
  lotsToOrderVolumeUnits,
  parseCTraderVolumeRules,
  roundDownLotsToStep,
  validateLotsAgainstRules
} from "../../../../src/services/broker/ctrader/volumeUnits";
import { calculateCTraderVolume } from "../../../../src/services/broker/ctrader/sizing";

/**
 * Live Pepperstone Demo XAUUSD (symbolId 41) raw ProtoOASymbolById fields
 * captured 2026-08-02 against demo.ctraderapi.com — used to prove conversion.
 */
const LIVE_PEPPERSTONE_XAUUSD_RAW = {
  symbolId: "41",
  symbolName: "XAUUSD",
  minVolume: "100",
  maxVolume: "500000",
  stepVolume: "100",
  lotSize: "10000",
  digits: 2,
  pipPosition: 1
} as const;

describe("cTrader volume units (Spotware cents)", () => {
  it("documents the API scaling factor: 100 cents = 1.00 lot", () => {
    expect(CTRADER_VOLUME_CENTS_PER_LOT).toBe(100);
    expect(centsToLots(100)).toBe(1);
    expect(centsToLots(1000)).toBe(10);
    expect(centsToLots(1)).toBe(0.01);
  });

  it("converts raw cTrader volume → lots", () => {
    expect(centsToLots(Number(LIVE_PEPPERSTONE_XAUUSD_RAW.minVolume))).toBe(1);
    expect(centsToLots(Number(LIVE_PEPPERSTONE_XAUUSD_RAW.stepVolume))).toBe(1);
    expect(centsToLots(Number(LIVE_PEPPERSTONE_XAUUSD_RAW.maxVolume))).toBe(5000);
  });

  it("converts lots → order volume units for future NewOrderReq", () => {
    expect(lotsToOrderVolumeUnits(1)).toBe(100);
    expect(lotsToOrderVolumeUnits(0.01)).toBe(1);
    expect(lotsToOrderVolumeUnits(10)).toBe(1000);
    expect(lotsToOrderVolumeUnits(1.0)).toBe(
      Number(LIVE_PEPPERSTONE_XAUUSD_RAW.minVolume)
    );
  });

  it("rounds down to volume step", () => {
    expect(roundDownLotsToStep(0.02, 1)).toBe(0);
    expect(roundDownLotsToStep(1.9, 1)).toBe(1);
    expect(roundDownLotsToStep(0.025, 0.01)).toBe(0.02);
    expect(roundDownLotsToStep(0.019, 0.01)).toBe(0.01);
  });

  it("rejects below minimum after rounding", () => {
    const rules = parseCTraderVolumeRules(LIVE_PEPPERSTONE_XAUUSD_RAW);
    const result = validateLotsAgainstRules(0.02, rules);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("VOLUME_BELOW_MINIMUM_AFTER_ROUNDING");
    expect(result.orderVolumeUnits).toBeNull();
  });

  it("rejects below minimum when rounded size is still under min", () => {
    const rules = parseCTraderVolumeRules({
      minVolume: 500, // 5.00 lots
      maxVolume: 500000,
      stepVolume: 100, // 1.00 lot step
      lotSize: 10000
    });
    const result = validateLotsAgainstRules(4.9, rules);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("VOLUME_BELOW_MINIMUM");
  });

  it("rejects / caps above maximum", () => {
    const rules = parseCTraderVolumeRules({
      minVolume: 100,
      maxVolume: 300, // 3.00 lots
      stepVolume: 100,
      lotSize: 10000
    });
    const capped = validateLotsAgainstRules(10, rules);
    expect(capped.ok).toBe(true);
    expect(capped.roundedLots).toBe(3);
    expect(capped.orderVolumeUnits).toBe(300);
  });

  it("handles XAUUSD lotSize=10000 cents → contractSize 100", () => {
    const rules = parseCTraderVolumeRules(LIVE_PEPPERSTONE_XAUUSD_RAW);
    expect(rules.rawLotSize).toBe(10000);
    expect(rules.contractSize).toBe(100);
    expect(rules.minLots).toBe(1);
    expect(rules.stepLots).toBe(1);
    expect(rules.maxLots).toBe(5000);
    expect(rules.apiVolumeScalingFactor).toBe(100);
    expect(rules.orderVolumeUnitsPerLot).toBe(100);
  });

  it("€20 risk at $10 stop cannot support Pepperstone XAUUSD 1.0 lot minimum", () => {
    const rules = parseCTraderVolumeRules(LIVE_PEPPERSTONE_XAUUSD_RAW);
    // Risk = lots * contractSize * stopDistance
    const rawLots = 20 / (rules.contractSize * 10);
    expect(rawLots).toBeCloseTo(0.02, 8);
    const validated = validateLotsAgainstRules(rawLots, rules);
    expect(validated.ok).toBe(false);
    expect(validated.rejectionReason).toBe("VOLUME_BELOW_MINIMUM_AFTER_ROUNDING");

    const sizing = calculateCTraderVolume({
      equity: 50000,
      freeMargin: 50000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      entryPrice: 4046.64,
      stopLoss: 4036.64,
      lotSize: rules.contractSize,
      tickSize: 0.01,
      minVolume: rules.minLots,
      volumeStep: rules.stepLots,
      maxVolume: rules.maxLots,
      marginPerLot: 175,
      eurToAccountRate: 1
    });
    expect(sizing.ok).toBe(false);
    expect(sizing.rejectionReason).toBe("VOLUME_BELOW_MINIMUM_AFTER_ROUNDING");
  });

  it("accepts exact minimum lot and maps to order units", () => {
    const rules = parseCTraderVolumeRules(LIVE_PEPPERSTONE_XAUUSD_RAW);
    const validated = validateLotsAgainstRules(1, rules);
    expect(validated.ok).toBe(true);
    expect(validated.roundedLots).toBe(1);
    expect(validated.orderVolumeUnits).toBe(100);
  });
});
