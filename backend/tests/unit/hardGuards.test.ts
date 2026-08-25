import { describe, expect, it } from "vitest";
import staleFixture from "../fixtures/stale.json";
import partialFixture from "../fixtures/partial.json";
import weakBuyPoorRrFixture from "../fixtures/weakBuyPoorRR.json";
import { freshPayload, stalePayload } from "../helpers";
import { evaluateHardGuards } from "../../src/services/decision/hardGuards";
import { scoreSnapshot, directionFromScore } from "../../src/services/decision/scoringEngine";
import { buildTradePlan } from "../../src/services/decision/tradePlanEngine";
import { evaluateDataQuality } from "../../src/services/snapshot/dataQuality";
import { mergeSnapshot } from "../../src/services/snapshot/mergeSnapshot";

describe("hard guards", () => {
  it("forces WAIT on stale data", () => {
    const snapshot = mergeSnapshot(stalePayload(staleFixture));
    const quality = evaluateDataQuality(snapshot);
    const score = scoreSnapshot(snapshot);
    const direction = directionFromScore(score.score);
    const guards = evaluateHardGuards(snapshot, direction, buildTradePlan(snapshot, direction), quality);
    expect(guards.passed).toBe(false);
    expect(guards.reasonCodes).toContain("STALE_DATA");
  });

  it("enforces min RR to TP2 only when TP2 exists", () => {
    const snapshot = mergeSnapshot(freshPayload(weakBuyPoorRrFixture));
    const quality = evaluateDataQuality(snapshot);
    const plan = buildTradePlan(snapshot, "BUY");
    const guards = evaluateHardGuards(snapshot, "BUY", plan, quality, 80);
    const hasTp2 = plan.takeProfits.some((t) => t.label === "TP2");
    if (hasTp2) {
      expect(guards.reasonCodes).toContain("MIN_RR_TO_TP2_NOT_MET");
      expect(guards.reasonCodes).toContain("POOR_RISK_REWARD");
      expect(guards.passed).toBe(false);
    } else {
      expect(guards.reasonCodes).not.toContain("MIN_RR_TO_TP2_NOT_MET");
    }
  });

  it("treats incomplete volume profile as soft warning, not hard fail", () => {
    const snapshot = mergeSnapshot(freshPayload(partialFixture));
    const quality = evaluateDataQuality(snapshot);
    const guards = evaluateHardGuards(snapshot, "BUY", buildTradePlan(snapshot, "BUY"), quality, 80);
    expect(guards.reasonCodes).not.toContain("MISSING_VOLUME_PROFILE");
    expect(guards.warnings).toContain("MISSING_VOLUME_PROFILE");
  });
});
