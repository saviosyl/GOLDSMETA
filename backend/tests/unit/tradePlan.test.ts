import { describe, expect, it } from "vitest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import weakBuyPoorRrFixture from "../fixtures/weakBuyPoorRR.json";
import { freshPayload } from "../helpers";
import { buildTradePlan } from "../../src/services/decision/tradePlanEngine";
import { mergeSnapshot } from "../../src/services/snapshot/mergeSnapshot";

describe("trade plan engine", () => {
  it("builds BUY plans with TP2 risk/reward at or above the minimum", () => {
    const plan = buildTradePlan(mergeSnapshot(freshPayload(strongBuyFixture)), "BUY");
    expect(plan.stopLoss.price).toBeLessThan(plan.entry.price ?? 0);
    expect(plan.riskReward.tp2).toBeGreaterThanOrEqual(1.5);
  });

  it("exposes poor TP2 risk/reward for guard enforcement", () => {
    const plan = buildTradePlan(mergeSnapshot(freshPayload(weakBuyPoorRrFixture)), "BUY");
    expect(plan.riskReward.tp2).toBeLessThan(1.5);
  });
});
