import { describe, expect, it } from "vitest";
import {
  resolveBrokerFillEconomics
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/brokerFillEconomics";

describe("broker fill economics", () => {
  it("treats proto default 0 as missing — never persists zero fill/lots", () => {
    const e = resolveBrokerFillEconomics({
      fillPrice: 0,
      filledVolumeLots: 0,
      brokerOrderId: "70265866",
      brokerPositionId: "54335877",
      stopLoss: 0,
      takeProfit: 0
    });
    expect(e.fillPrice).toBeNull();
    expect(e.filledVolumeLots).toBeNull();
    expect(e.brokerStopLoss).toBeNull();
    expect(e.complete).toBe(false);
  });

  it("persists the production broker fill and lots", () => {
    const e = resolveBrokerFillEconomics({
      fillPrice: 4398.08,
      filledVolumeLots: 92,
      brokerOrderId: "70265866",
      brokerPositionId: "54335877",
      stopLoss: 4397.61,
      takeProfit: 4399.71
    });
    expect(e.fillPrice).toBe(4398.08);
    expect(e.filledVolumeLots).toBe(92);
    expect(e.complete).toBe(true);
  });
});
