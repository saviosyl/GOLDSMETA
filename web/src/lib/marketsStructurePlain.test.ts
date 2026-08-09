import { describe, expect, it } from "vitest";
import { marketsStructurePlain } from "./marketsStructurePlain";
import type { Decision } from "../types/models";

describe("marketsStructurePlain", () => {
  it("rewrites setup-score threshold copy", () => {
    const decision = {
      decision: "WAIT",
      reasonSummary: ["WAIT because setup score 61 did not reach BUY/SELL thresholds"],
      bullishEvidence: ["a"],
      bearishEvidence: []
    } as unknown as Decision;
    expect(marketsStructurePlain(decision)).toMatch(/No confirmed setup yet/i);
    expect(marketsStructurePlain(decision)).toMatch(/Bullish conditions/i);
  });
});
