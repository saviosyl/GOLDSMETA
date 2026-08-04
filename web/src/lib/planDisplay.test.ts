import { describe, expect, it } from "vitest";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import type { IntradayPlan } from "../types/intradayPlan";
import {
  allMandatoryConditionsPass,
  checklistMark,
  checklistMarkGlyph,
  deriveConfirmation5m,
  deriveTimeframeAlignment,
  planColourTone,
  primaryScenarioSide,
  resolveDisplayAction,
  toneIcon
} from "./planDisplay";

function withAction(action: IntradayPlan["action"], completeAll: boolean): IntradayPlan {
  const base = structuredClone(chartExampleIntradayPlanFixture);
  base.action = action;
  base.actionLabel = action.replace(/_/g, " ");
  base.setupProgress.items = base.setupProgress.items.map((item) => ({
    ...item,
    complete: completeAll,
    mark: completeAll ? "pass" : item.id === "confirmation" ? "fail" : "pending"
  }));
  base.setupProgress.complete = completeAll ? 6 : 3;
  base.setupProgress.total = 6;
  return base;
}

describe("planDisplay colour + NOW gating", () => {
  it("maps colour tones for buy / wait / sell / notrade / info / unavailable", () => {
    expect(planColourTone("BUY_NOW")).toBe("buy");
    expect(planColourTone("PREPARE")).toBe("wait");
    expect(planColourTone("SELL_NOW")).toBe("sell");
    expect(planColourTone("NO_TRADE")).toBe("notrade");
    expect(planColourTone("RANGE_TRADE")).toBe("info");
    expect(planColourTone("PREPARE", { unavailable: true })).toBe("unavailable");
    expect(toneIcon("buy")).toBe("▲");
    expect(toneIcon("notrade")).toBe("⛔");
  });

  it("demotes BUY NOW when checklist incomplete", () => {
    const plan = withAction("BUY_NOW", false);
    const display = resolveDisplayAction(plan);
    expect(display.demotedFromNow).toBe(true);
    expect(display.shortLabel).toBe("WAIT");
    expect(display.tone).toBe("wait");
    expect(allMandatoryConditionsPass(plan)).toBe(false);
  });

  it("keeps BUY NOW only when all six conditions pass", () => {
    const plan = withAction("BUY_NOW", true);
    const display = resolveDisplayAction(plan);
    expect(display.demotedFromNow).toBe(false);
    expect(display.shortLabel).toBe("BUY NOW");
    expect(display.tone).toBe("buy");
    expect(allMandatoryConditionsPass(plan)).toBe(true);
  });

  it("checklist marks use ✓ ○ ✕", () => {
    expect(checklistMarkGlyph("pass")).toBe("✓");
    expect(checklistMarkGlyph("pending")).toBe("○");
    expect(checklistMarkGlyph("fail")).toBe("✕");
    expect(checklistMark({ id: "x", label: "x", complete: true, detail: "" })).toBe("pass");
    expect(checklistMark({ id: "x", label: "x", complete: false, detail: "", mark: "fail" })).toBe(
      "fail"
    );
  });

  it("derives 5M confirmation and timeframe alignment without inventing prices", () => {
    const plan = chartExampleIntradayPlanFixture;
    const conf = deriveConfirmation5m(plan, "NONE");
    expect(conf.meaningful).toBe(false);
    const aligned = deriveTimeframeAlignment(plan);
    expect(aligned.cells.map((c) => c.timeframe)).toEqual(["4H", "1H", "15M", "5M"]);
    expect(aligned.conclusion.length).toBeGreaterThan(10);
    expect(primaryScenarioSide(plan)).toMatch(/bullish|bearish|none/);
  });
});
