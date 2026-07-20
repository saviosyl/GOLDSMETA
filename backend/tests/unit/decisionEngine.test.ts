import { describe, expect, it } from "vitest";
import {
  decisionEngineResultSchema,
  evaluateDecision,
  evaluateManagement,
  loadDecisionEngineConfig,
  managementResultSchema
} from "../../src/services/decisionEngine";
import { fixtures, managementFixtures } from "../fixtures/decisionEngine/inputs/builders";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

describe("decision engine config", () => {
  it("loads versioned configuration", () => {
    const config = loadDecisionEngineConfig("1.0.0");
    expect(config.version).toBe("decision-engine-1.0.0");
    expect(config.weights.trendMeter.bullish).toBeGreaterThan(0);
    expect(config.thresholds.minIndependentFactors).toBeGreaterThanOrEqual(3);
  });
});

describe("evaluateDecision scenarios", () => {
  it("returns BUY for strong bullish breakout with multi-factor confirmation", () => {
    const result = evaluateDecision(fixtures.strongBullishBreakout, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("BUY");
    expect(result.setupGrade).not.toBe("No Trade");
    expect(result.confidence).toBeGreaterThanOrEqual(65);
    expect(result.tradeScore).toBeGreaterThanOrEqual(62);
    expect(result.stopLoss).not.toBeNull();
    expect(result.takeProfits.tp1).not.toBeNull();
    expect(result.riskReward.tp2).toBeGreaterThanOrEqual(1.5);
    expect(result.scoreBreakdown.length).toBeGreaterThan(5);
    expect(result.analysisOnly).toBe(true);
    expect(result.recommendedManagementAction).toBe("ENTER");
    decisionEngineResultSchema.parse(result);
  });

  it("returns BUY for bullish pullback retest", () => {
    const result = evaluateDecision(fixtures.bullishPullbackRetest, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("BUY");
    expect(result.entryType).toBe("retest");
    expect(result.supportingReasons.length).toBeGreaterThan(0);
  });

  it("returns SELL for strong bearish breakdown", () => {
    const result = evaluateDecision(fixtures.strongBearishBreakdown, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("SELL");
    expect(result.setupGrade).not.toBe("No Trade");
    expect(result.stopLoss! > result.entryRange.reference!).toBe(true);
    expect(result.takeProfits.tp1! < result.entryRange.reference!).toBe(true);
  });

  it("returns SELL for bearish retest", () => {
    const result = evaluateDecision(fixtures.bearishRetest, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("SELL");
    expect(["retest", "limit", "market"]).toContain(result.entryType);
  });

  it("returns WAIT in ranging market", () => {
    const result = evaluateDecision(fixtures.rangeMarket, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
    expect(result.setupGrade).toBe("No Trade");
    expect(result.recommendedManagementAction).toBe("WAIT_FOR_CLOSE");
  });

  it("returns WAIT when price is directly below resistance without breakout", () => {
    const result = evaluateDecision(fixtures.priceBelowResistance, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
  });

  it("returns WAIT when price is directly above support without confirmation", () => {
    const result = evaluateDecision(fixtures.priceAboveSupport, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
  });

  it("returns WAIT on conflicting indicators", () => {
    const result = evaluateDecision(fixtures.conflictingIndicators, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
    expect(result.safetyFlags.join(" ")).toMatch(/DISAGREEMENT|CONFIRMATION|CONFIDENCE|CONFLICT/i);
  });

  it("reduces confidence and prefers WAIT when indicators are missing", () => {
    const result = evaluateDecision(fixtures.missingIndicators, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
    expect(result.missingDataWarnings.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(65);
  });

  it("returns WAIT on stale data", () => {
    const result = evaluateDecision(fixtures.staleData, {
      evaluatedAt: "2026-07-20T10:00:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
    expect(result.safetyFlags).toContain("STALE_DATA");
  });

  it("returns WAIT on excessive spread", () => {
    const result = evaluateDecision(fixtures.excessiveSpread, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
    expect(result.safetyFlags).toContain("EXCESSIVE_SPREAD");
  });

  it("returns WAIT on high-impact news", () => {
    const result = evaluateDecision(fixtures.highImpactNews, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
    expect(result.safetyFlags).toContain("HIGH_IMPACT_NEWS");
  });

  it("returns WAIT on poor risk-to-reward / invalid geometry", () => {
    const result = evaluateDecision(fixtures.poorRiskReward, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(result.primaryAction).toBe("WAIT");
    expect(
      result.safetyFlags.some((f) => f === "POOR_RISK_REWARD" || f === "INVALID_GEOMETRY" || f === "INSUFFICIENT_CONFIRMATION" || f === "LOW_CONFIDENCE" || f === "STRUCTURE_CONFLICT_ZONE")
    ).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const a = evaluateDecision(fixtures.strongBullishBreakout, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    const b = evaluateDecision(fixtures.strongBullishBreakout, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    expect(a).toEqual(b);
  });

  it("never returns conflicting primary actions and marks analysisOnly", () => {
    for (const fixture of Object.values(fixtures)) {
      const result = evaluateDecision(fixture, { evaluatedAt: "2026-07-20T10:01:00.000Z" });
      expect(["BUY", "SELL", "WAIT"]).toContain(result.primaryAction);
      expect(result.analysisOnly).toBe(true);
      decisionEngineResultSchema.parse(result);
    }
  });
});

describe("evaluateManagement", () => {
  it("triggers MOVE_SL_TO_BREAKEVEN", () => {
    const result = evaluateManagement(managementFixtures.breakevenTrigger);
    expect(result.action).toBe("MOVE_SL_TO_BREAKEVEN");
    expect(result.currentR).toBeGreaterThan(0.7);
    managementResultSchema.parse(result);
  });

  it("triggers TAKE_PARTIAL", () => {
    const result = evaluateManagement(managementFixtures.partialProfitTrigger);
    expect(result.action).toBe("TAKE_PARTIAL");
  });

  it("triggers EXIT_EARLY", () => {
    const result = evaluateManagement(managementFixtures.earlyExitTrigger);
    expect(result.action).toBe("EXIT_EARLY");
  });
});

describe("decision engine contract snapshots", () => {
  it("writes example BUY/SELL/WAIT JSON artifacts for docs", () => {
    const outDir = join(__dirname, "../fixtures/decisionEngine/outputs");
    mkdirSync(outDir, { recursive: true });
    const docsDir = join(__dirname, "../../../docs/examples/decisionEngine");
    mkdirSync(docsDir, { recursive: true });

    const buy = evaluateDecision(fixtures.strongBullishBreakout, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    const sell = evaluateDecision(fixtures.strongBearishBreakdown, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });
    const wait = evaluateDecision(fixtures.rangeMarket, {
      evaluatedAt: "2026-07-20T10:01:00.000Z"
    });

    expect(buy.primaryAction).toBe("BUY");
    expect(sell.primaryAction).toBe("SELL");
    expect(wait.primaryAction).toBe("WAIT");

    for (const [name, value] of [
      ["buy_breakout", buy],
      ["sell_breakdown", sell],
      ["wait_range", wait]
    ] as const) {
      const json = `${JSON.stringify(value, null, 2)}\n`;
      writeFileSync(join(outDir, `${name}.json`), json);
      writeFileSync(join(docsDir, `${name}.output.json`), json);
      writeFileSync(
        join(docsDir, `${name}.input.json`),
        `${JSON.stringify(
          name === "buy_breakout"
            ? fixtures.strongBullishBreakout
            : name === "sell_breakdown"
              ? fixtures.strongBearishBreakdown
              : fixtures.rangeMarket,
          null,
          2
        )}\n`
      );
    }
  });
});
