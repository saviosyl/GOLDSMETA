import { describe, expect, it } from "vitest";
import { buildFallbackExplanation } from "../../src/services/ai/fallback";

describe("AI fallback", () => {
  it("returns deterministic WAIT explanation when guards fail", () => {
    const explanation = buildFallbackExplanation(
      "WAIT",
      {
        score: 20,
        bullishEvidence: [],
        bearishEvidence: [],
        reasonCodes: [],
        marketRegime: "UNKNOWN"
      },
      {
        passed: false,
        reasonCodes: ["STALE_DATA"],
        warnings: []
      },
      ["Market data is stale"]
    );

    expect(explanation.modelId).toBeNull();
    expect(explanation.summary[0]).toContain("STALE_DATA");
    expect(explanation.recommendWait).toBe(false);
  });
});
