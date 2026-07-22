import { describe, expect, it } from "vitest";
import { calculatePositionSize } from "../../../src/services/autoTrade/positionSizing";

describe("positionSizing", () => {
  const base = {
    direction: "BUY" as const,
    entryPrice: 2385.5,
    stopPrice: 2380.5,
    takeProfitPrice: 2395.5,
    maxLossPerTrade: 5,
    remainingDailyLossCapacity: 10,
    remainingWeeklyLossCapacity: 30,
    maxMarginPerPosition: 100,
    availableFunds: 9500,
    valuePerPoint: 1,
    minDealSize: 0.1,
    sizeIncrement: 0.1,
    costAllowance: 0
  };

  it("sizes from monetary risk and rounds down", () => {
    const result = calculatePositionSize(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // stop distance 5 → risk/unit 5 → size floor(5/5)=1 → but max loss 5 → size 1
    expect(result.size).toBe(1);
    expect(result.monetaryRisk).toBeLessThanOrEqual(5);
  });

  it("rejects when IG minimum size exceeds configured max loss", () => {
    const result = calculatePositionSize({
      ...base,
      minDealSize: 5,
      sizeIncrement: 1,
      stopPrice: 2380.5
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Trade skipped: IG minimum position size would risk/);
    expect(result.reason).toMatch(/Configured maximum loss is €5\.00/);
  });

  it("uses the tightest remaining budget", () => {
    const result = calculatePositionSize({
      ...base,
      remainingDailyLossCapacity: 2
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.limitingBudget).toContain("daily");
    expect(result.monetaryRisk).toBeLessThanOrEqual(2);
  });
});
