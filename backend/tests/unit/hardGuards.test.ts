import { describe, expect, it } from "vitest";
import staleFixture from "../fixtures/stale.json";
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

  it("rejects setups below minimum RR to TP2", () => {
    const snapshot = mergeSnapshot(freshPayload(weakBuyPoorRrFixture));
    const quality = evaluateDataQuality(snapshot);
    const guards = evaluateHardGuards(snapshot, "BUY", buildTradePlan(snapshot, "BUY"), quality);
    expect(guards.passed).toBe(false);
    expect(guards.reasonCodes).toContain("MIN_RR_TO_TP2_NOT_MET");
  });
});
