import { describe, expect, it } from "vitest";
import { computeDailyManualRiskStatus, estimateManualRisk } from "./manualRisk";
import type { ManualRiskSettings, SetupRecord } from "../types/models";

const risk: ManualRiskSettings = {
  currency: "EUR",
  maxCashRiskPerTrade: 20,
  maxSimultaneousManualTrades: 1,
  maxDailyRealisedLoss: 40,
  stopAfterConsecutiveLosses: 2,
  valuePerPoint: 1,
  estimatedSpreadPoints: 0.3,
  noAveragingDown: true,
  noMartingale: true,
  noAutomaticRecovery: true
};

describe("estimateManualRisk", () => {
  it("computes estimate without calling a broker", () => {
    const result = estimateManualRisk({
      currency: "EUR",
      maxCashRisk: 20,
      entryPrice: 2650,
      stopLossPrice: 2640,
      instrument: "XAUUSD",
      estimatedSpreadPoints: 0.3,
      valuePerPoint: 1,
      manualPositionSize: null,
      actualFillPrice: null
    });
    expect(result.estimateOnly).toBe(true);
    expect(result.stopDistance).toBe(10);
    expect(result.estimatedPositionSize).toBe(2);
    // Stop risk (€20) + spread cost pushes total slightly over max → warn.
    expect(result.exceedsMaxRisk).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/exceeds/i);
  });

  it("warns when value-per-point is missing", () => {
    const result = estimateManualRisk({
      currency: "EUR",
      maxCashRisk: 20,
      entryPrice: 2650,
      stopLossPrice: 2640,
      instrument: "XAUUSD",
      estimatedSpreadPoints: null,
      valuePerPoint: null,
      manualPositionSize: null,
      actualFillPrice: null
    });
    expect(result.missingValuePerPoint).toBe(true);
    expect(result.estimatedPositionSize).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/does not guess/i);
  });
});

describe("computeDailyManualRiskStatus", () => {
  it("flags stop trading after consecutive losses", () => {
    const setups = [
      {
        setupId: "a",
        manualExecution: {
          action: "ENTERED",
          actualPnl: -10,
          tradedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          systemOutcomeUntouched: true
        }
      },
      {
        setupId: "b",
        manualExecution: {
          action: "ENTERED",
          actualPnl: -12,
          tradedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          systemOutcomeUntouched: true
        }
      }
    ] as SetupRecord[];

    const status = computeDailyManualRiskStatus(setups, risk);
    expect(status.consecutiveLosses).toBe(2);
    expect(status.stopTradingToday).toBe(true);
    expect(status.reasons.join(" ")).toMatch(/consecutive/i);
  });
});
