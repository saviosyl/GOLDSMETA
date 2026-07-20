import { describe, expect, it } from "vitest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import strongSellFixture from "../fixtures/strongSell.json";
import { freshPayload } from "../helpers";
import { scoreSnapshot, directionFromScore } from "../../src/services/decision/scoringEngine";
import { mergeSnapshot } from "../../src/services/snapshot/mergeSnapshot";

describe("scoring engine", () => {
  it("classifies strong bullish setups as BUY", () => {
    const score = scoreSnapshot(mergeSnapshot(freshPayload(strongBuyFixture)));
    expect(score.score).toBeGreaterThanOrEqual(70);
    expect(directionFromScore(score.score)).toBe("BUY");
  });

  it("classifies strong bearish setups as SELL", () => {
    const score = scoreSnapshot(mergeSnapshot(freshPayload(strongSellFixture)));
    expect(score.score).toBeLessThanOrEqual(-70);
    expect(directionFromScore(score.score)).toBe("SELL");
  });
});
