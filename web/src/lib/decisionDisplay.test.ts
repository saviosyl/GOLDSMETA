import { describe, expect, it } from "vitest";
import type { Decision } from "../types/models";
import wait from "../fixtures/wait.json";
import buy from "../fixtures/buy.json";
import sell from "../fixtures/sell.json";
import {
  displayQualityLabel,
  filterHistory,
  primaryReason,
  recommendedActionLabel,
  tradePlanEntryLabel,
  tradePlanRrLabel,
  tradePlanStopLabel,
  tradePlanTpLabel
} from "./decisionDisplay";
import { isTestDecision } from "./format";

describe("decisionDisplay", () => {
  it("maps WAIT stale decisions to fresh-data action and N/A plan labels", () => {
    const decision = wait as Decision;
    expect(recommendedActionLabel(decision)).toBe("Wait for fresh market data");
    expect(tradePlanEntryLabel(decision)).toBe("Wait");
    expect(tradePlanStopLabel(decision)).toBe("Not applicable");
    expect(tradePlanTpLabel(decision, "TP1")).toBe("Not applicable");
    expect(tradePlanRrLabel(decision)).toBe("Not applicable");
    expect(displayQualityLabel(decision)).toBe("STALE");
    expect(primaryReason(decision)).toMatch(/fresh market data|WAIT/i);
  });

  it("treats only genuine test flags as TEST", () => {
    expect(isTestDecision(buy as Decision)).toBe(true);
    expect(
      isTestDecision({
        isTestDecision: false,
        environment: "LIVE",
        dataSourceLabel: "TEST"
      })
    ).toBe(false);
    expect(displayQualityLabel(buy as Decision)).toBe("LIVE");
  });

  it("filters history by decision side", () => {
    const items = [buy as Decision, sell as Decision, wait as Decision];
    expect(filterHistory(items, "BUY")).toHaveLength(1);
    expect(filterHistory(items, "ALL")).toHaveLength(3);
  });
});
