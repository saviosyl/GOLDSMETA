import { describe, expect, it } from "vitest";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";
import {
  evaluateGoldHunterOrderGates,
  type GoldHunterGateInput
} from "../../../../src/services/goldHunterAdmin/orderGates";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../../../src/services/goldHunterAdmin/types";

function gate(over: Partial<GoldHunterGateInput> = {}) {
  return evaluateGoldHunterOrderGates({
    config: {
      ...GH_ADMIN_DEFAULT_CONFIG,
      demoAutoTradeEnabled: true,
      allocatedCapitalEur: 1000,
      riskPerTradePct: 1,
      dailyLossLimitPct: 3,
      maxOpenTrades: 1
    },
    brokerEnvironment: "DEMO",
    brokerConnected: true,
    accountSnapshotValid: true,
    marketOpen: true,
    feedFresh: true,
    depthValid: true,
    spreadOk: true,
    capitalOk: true,
    dailyLossOk: true,
    openTradeCount: 0,
    signalPresent: true,
    signalConsumed: false,
    isAdmin: true,
    ...over
  });
}

describe("stale quote blocks Gold Hunter execution", () => {
  it("feedFresh=false fails WAIT — FEED STALE", () => {
    const result = gate({ feedFresh: false });
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("WAIT — FEED STALE");
  });

  it("spreadOk=false fails WAIT — SPREAD TOO WIDE", () => {
    const result = gate({ spreadOk: false });
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("WAIT — SPREAD TOO WIDE");
  });

  it("Live remains locked", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
  });
});
