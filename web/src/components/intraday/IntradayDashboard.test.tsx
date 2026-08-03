import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chartExampleIntradayPlanFixture } from "../../fixtures/intradayPlanFixture";
import { IntradayActionCard } from "./IntradayActionCard";
import { ExpectedRangeCard } from "./ExpectedRangeCard";
import { ImportantLevelsPanel } from "./ImportantLevelsPanel";
import { ScenarioCards } from "./ScenarioCards";
import { CompactTradePlanCard } from "./CompactTradePlanCard";

describe("Issue #50 intraday dashboard components", () => {
  it("shows below-value reclaim language instead of bare WAIT / floor above price", () => {
    render(
      <MemoryRouter>
        <IntradayActionCard plan={chartExampleIntradayPlanFixture} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("PREPARE");
    expect(screen.getByTestId("intraday-action-subtitle")).toHaveTextContent("Setup forming");
    expect(screen.getByTestId("intraday-action-label")).toHaveTextContent(/PREPARE/);
    expect(screen.getByTestId("intraday-action-label")).not.toHaveTextContent(/PREPARE — PREPARE/i);
    expect(screen.getByTestId("intraday-one-sentence")).toHaveTextContent(/below value/i);
    expect(screen.getByTestId("intraday-one-sentence")).toHaveTextContent(/reclaim/i);
    expect(screen.getByTestId("intraday-trigger")).toHaveTextContent(/reclaim/i);
    expect(screen.getByTestId("intraday-value-location")).toHaveTextContent(/Below value/i);
    expect(screen.getByTestId("intraday-next-target")).toHaveTextContent(/4041\.2/);
    expect(screen.getByTestId("intraday-after-that")).toHaveTextContent(/POC/i);
    expect(screen.getByTestId("intraday-major-target")).toHaveTextContent(/VAH/i);
  });

  it("keeps current price inside probable low/high when range is available", () => {
    const r = chartExampleIntradayPlanFixture.expectedRange;
    expect(r.rangeAvailable).toBe(true);
    expect(r.probableLow!).toBeLessThanOrEqual(r.currentPrice!);
    expect(r.currentPrice!).toBeLessThanOrEqual(r.probableHigh!);
    expect(r.stretchLow!).toBeLessThanOrEqual(r.probableLow!);
    expect(r.probableHigh!).toBeLessThanOrEqual(r.stretchHigh!);
    render(<ExpectedRangeCard range={r} />);
    expect(screen.getByTestId("range-probable-low")).toBeInTheDocument();
    expect(screen.getByTestId("range-disclaimer")).toHaveTextContent(/estimates only/i);
  });

  it("labels VAL above price as reclaim, not plain support", async () => {
    const user = userEvent.setup();
    const levels = chartExampleIntradayPlanFixture.importantLevels;
    const val = levels.find((l) => l.id === "lvl-val");
    expect(val?.roleAtCurrentPrice).toBe("RECLAIM_LEVEL");
    expect(val?.proximity).toBe("ABOVE");
    for (const level of levels) {
      if (level.roleAtCurrentPrice === "SUPPORT") {
        expect(level.proximity).not.toBe("ABOVE");
      }
    }
    render(<ImportantLevelsPanel levels={levels} allLevels={levels} />);
    const desktop = screen.getByTestId("levels-desktop-full");
    expect(within(desktop).getByTestId("level-group-above")).toBeInTheDocument();
    expect(within(desktop).getByTestId("level-group-below")).toBeInTheDocument();
    const card = within(desktop).getByTestId("level-card-lvl-val");
    expect(card).toHaveTextContent(/reclaim/i);
    await user.click(card);
    expect(within(desktop).getByTestId("level-detail-lvl-val")).toHaveTextContent(/below VAL/i);
  });

  it("does not show an active stop/TP plan for PREPARE NONE", () => {
    render(
      <MemoryRouter>
        <CompactTradePlanCard tradePlan={chartExampleIntradayPlanFixture.tradePlan} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("tp-no-active")).toBeInTheDocument();
    expect(screen.getByTestId("bullish-conditional")).toBeInTheDocument();
    expect(screen.getByTestId("bearish-conditional")).toBeInTheDocument();
    expect(screen.queryByTestId("tp-stop")).not.toBeInTheDocument();
    expect(screen.getByTestId("bullish-conditional")).toHaveTextContent(/Target 1/i);
    expect(screen.getByTestId("bullish-conditional")).not.toHaveTextContent(/Reference TP1/i);
    expect(screen.getByTestId("bullish-conditional-target1")).toHaveTextContent(/4041\.2/);
    expect(screen.getByTestId("bearish-conditional-target1")).toHaveTextContent(/Unavailable/i);
  });

  it("10) desktop shows both scenario cards without relying on selector tiles", () => {
    render(
      <ScenarioCards
        plan={chartExampleIntradayPlanFixture}
        bullish={chartExampleIntradayPlanFixture.bullishScenario}
        bearish={chartExampleIntradayPlanFixture.bearishScenario}
      />
    );
    const grid = screen.getByTestId("scenario-grid");
    expect(within(grid).getByTestId("scenario-bull")).toBeInTheDocument();
    expect(within(grid).getByTestId("scenario-bear")).toBeInTheDocument();
    // Tabs exist for mobile but are marked gm-mobile-only (hidden on desktop via CSS).
    expect(screen.getByTestId("scenario-cards").querySelector(".gm-scenario-tabs")).toHaveClass(
      "gm-mobile-only"
    );
    expect(screen.getByTestId("scenario-bull")).toHaveTextContent(/TP1/i);
    expect(screen.getByTestId("scenario-bull")).toHaveTextContent(/4041\.2/);
    expect(screen.getByTestId("scenario-bear")).toHaveTextContent(/Unavailable/i);
  });

  it("11) mobile tabs select one scenario at a time", async () => {
    const user = userEvent.setup();
    render(
      <ScenarioCards
        plan={chartExampleIntradayPlanFixture}
        bullish={chartExampleIntradayPlanFixture.bullishScenario}
        bearish={chartExampleIntradayPlanFixture.bearishScenario}
      />
    );
    expect(screen.getByTestId("scenario-bull")).toHaveClass("is-active");
    expect(screen.getByTestId("scenario-bear")).not.toHaveClass("is-active");
    await user.click(screen.getByTestId("scenario-tab-bear"));
    expect(screen.getByTestId("scenario-bear")).toHaveClass("is-active");
    expect(screen.getByTestId("scenario-bull")).not.toHaveClass("is-active");
  });

  it("12) mobile Important Levels defaults to 3 above + 3 below", () => {
    const levels = chartExampleIntradayPlanFixture.importantLevels;
    render(<ImportantLevelsPanel levels={levels} allLevels={levels} />);
    const mobile = screen.getByTestId("levels-mobile-compact");
    const aboveCards = mobile.querySelectorAll(
      '[data-testid="level-group-above"] [data-testid^="level-card-"]'
    );
    const belowCards = mobile.querySelectorAll(
      '[data-testid="level-group-below"] [data-testid^="level-card-"]'
    );
    expect(aboveCards.length).toBeLessThanOrEqual(3);
    expect(belowCards.length).toBeLessThanOrEqual(3);
    expect(screen.getByTestId("levels-show-all")).toHaveTextContent(/Show all levels/i);
    expect(screen.getByTestId("levels-desktop-full")).toBeInTheDocument();
  });

  it("trigger is not equal to first target on fixture scenarios", () => {
    const b = chartExampleIntradayPlanFixture.bullishScenario;
    const s = chartExampleIntradayPlanFixture.bearishScenario;
    expect(b.firstTargetPrice).not.toBeNull();
    expect(Math.abs((b.triggerPrice ?? 0) - (b.firstTargetPrice ?? 0))).toBeGreaterThan(0.05);
    expect(s.firstTarget).toMatch(/Unavailable/i);
    expect(chartExampleIntradayPlanFixture.nextTargetPrice).toBe(4041.2);
  });
});
