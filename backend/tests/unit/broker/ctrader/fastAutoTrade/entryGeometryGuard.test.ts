import { describe, expect, it } from "vitest";
import {
  evaluateEntryGeometryGuard,
  isPostFillTakeProfitInvalid
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/entryGeometryGuard";

describe("FAST entry geometry guard", () => {
  it("production BUY fill past TP → BLOCK_ENTRY_TARGET_ALREADY_PASSED", () => {
    const r = evaluateEntryGeometryGuard({
      side: "BUY",
      strategyEntry: 4396.35,
      strategyStopLoss: 4395.88,
      strategyTakeProfit: 4397.98,
      freshExecutionPrice: 4398.08,
      minRiskReward: 1
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("BLOCK_ENTRY_TARGET_ALREADY_PASSED");
    expect(r.diagnostics.entryDrift).toBeCloseTo(1.73, 5);
    expect(r.diagnostics.entryDriftR).toBeGreaterThan(1);
    expect(r.diagnostics.actualRewardDistance).toBeLessThan(0);
  });

  it("valid BUY geometry inside SL/TP still passes", () => {
    const r = evaluateEntryGeometryGuard({
      side: "BUY",
      strategyEntry: 4396.35,
      strategyStopLoss: 4395.88,
      strategyTakeProfit: 4397.98,
      freshExecutionPrice: 4396.4,
      minRiskReward: 1
    });
    expect(r.ok).toBe(true);
    expect(r.diagnostics.actualRR).toBeGreaterThanOrEqual(1);
  });

  it("SELL already at or through TP is blocked", () => {
    const r = evaluateEntryGeometryGuard({
      side: "SELL",
      strategyEntry: 4400,
      strategyStopLoss: 4401,
      strategyTakeProfit: 4398,
      freshExecutionPrice: 4398,
      minRiskReward: 1
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("BLOCK_ENTRY_TARGET_ALREADY_PASSED");
  });

  it("post-fill TP on the wrong side of the fill is invalid", () => {
    expect(
      isPostFillTakeProfitInvalid({
        side: "BUY",
        actualFill: 4398.08,
        takeProfit: 4397.98
      })
    ).toBe(true);
    expect(
      isPostFillTakeProfitInvalid({
        side: "BUY",
        actualFill: 4396.4,
        takeProfit: 4397.98
      })
    ).toBe(false);
  });
});
