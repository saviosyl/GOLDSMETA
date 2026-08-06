import { describe, expect, it } from "vitest";
import { formatWaitGroupLabel, groupHistoryItems } from "./historyGrouping";
import { plainReason } from "./reasonCodePlain";

describe("historyGrouping", () => {
  it("groups three or more identical WAIT checks", () => {
    const items = [0, 1, 2, 3].map((i) => ({
      decisionId: `d${i}`,
      decision: "WAIT",
      generatedAt: `2026-08-06T10:0${i}:00.000Z`,
      reasonCodes: ["AWAITING_5M_CONFIRMATION"],
      oneLineReason: "Waiting for 5-minute confirmation."
    }));
    const grouped = groupHistoryItems(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.kind).toBe("wait_group");
    if (grouped[0]?.kind === "wait_group") {
      expect(grouped[0].count).toBe(4);
      expect(formatWaitGroupLabel(grouped[0])).toMatch(/checks waiting for 5M confirmation/i);
    }
  });

  it("does not group BUY/SELL/PREPARE rows", () => {
    const grouped = groupHistoryItems([
      {
        decisionId: "b1",
        decision: "BUY",
        generatedAt: "2026-08-06T11:00:00.000Z"
      },
      {
        decisionId: "w1",
        decision: "WAIT",
        generatedAt: "2026-08-06T11:05:00.000Z",
        reasonCodes: ["WAIT_ONLY"]
      }
    ]);
    expect(grouped.map((g) => g.kind)).toEqual(["single", "single"]);
  });
});

describe("plainReason hides raw codes", () => {
  it("maps CONFLICTED_DATA and WAIT_ONLY to plain language", () => {
    expect(plainReason("CONFLICTED_DATA")).toMatch(/decision window/i);
    expect(plainReason("MISSING_CONFIRMATION")).toMatch(/5M candle/i);
    expect(plainReason("WAIT_ONLY")).toMatch(/incomplete/i);
  });
});
