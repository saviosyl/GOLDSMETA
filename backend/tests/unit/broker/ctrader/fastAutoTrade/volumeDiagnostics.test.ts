import { describe, expect, it } from "vitest";
import {
  buildVolumeRoundingDiagnostics,
  computeRawLotsFromRisk
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/volumeDiagnostics";
import {
  CTRADER_VOLUME_CENTS_PER_LOT,
  parseCTraderVolumeRules
} from "../../../../../src/services/broker/ctrader/volumeUnits";

describe("FAST volume-unit audit", () => {
  it("documents official cents mapping and does not upsize below min", () => {
    // Official: protocol volume 1000 = 10.00 lots; 100 cents = 1.00 lot.
    expect(CTRADER_VOLUME_CENTS_PER_LOT).toBe(100);
    const rules = parseCTraderVolumeRules({
      minVolume: 100,
      maxVolume: 10_000_000,
      stepVolume: 100,
      lotSize: 100
    });
    expect(rules.minLots).toBe(1);
    expect(rules.stepLots).toBe(1);
    expect(rules.contractSize).toBe(1);
    const raw = computeRawLotsFromRisk({
      riskAmount: 20,
      riskPerLotDeposit: 30.7,
      stepLots: rules.stepLots
    });
    expect(raw.rawLots).toBeLessThan(1);
    expect(raw.roundedLots).toBe(0);
    const diag = buildVolumeRoundingDiagnostics({
      effectiveRiskAmountDeposit: 20,
      riskMultiplier: 1,
      entryPrice: 4409.84,
      stopPrice: 4379.134,
      stopDistance: 30.706,
      quoteToDepositRate: 0.86,
      riskPerLotDeposit: 30.7,
      rawLots: raw.rawLots,
      roundedLots: raw.roundedLots,
      rules
    });
    expect(diag.mappingUnchanged).toBe(true);
    expect(diag.protocolVolumeCentsPerLot).toBe(100);
    expect(diag.roundedFinalSize).toBe(0);
    expect(diag.brokerMinVolumeRaw).toBe(100);
    expect(diag.normalizedMin).toBe(1);
  });
});
