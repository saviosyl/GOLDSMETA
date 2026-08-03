import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByTestId("intraday-action-label")).toHaveTextContent("PREPARE — SETUP FORMING");
    expect(screen.getByTestId("intraday-one-sentence")).toHaveTextContent(/below value/i);
    expect(screen.getByTestId("intraday-one-sentence")).toHaveTextContent(/reclaim/i);
    expect(screen.getByTestId("intraday-trigger")).toHaveTextContent(/reclaim/i);
    expect(screen.getByTestId("intraday-value-location")).toHaveTextContent(/Below value/i);
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
    expect(screen.getByTestId("level-group-above")).toBeInTheDocument();
    expect(screen.getByTestId("level-group-below")).toBeInTheDocument();
    const card = screen.getByTestId("level-card-lvl-val");
    expect(card).toHaveTextContent(/reclaim/i);
    await user.click(card);
    expect(screen.getByTestId("level-detail-lvl-val")).toHaveTextContent(/below VAL/i);
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
  });

  it("renders both bullish and bearish scenarios", () => {
    render(
      <ScenarioCards
        bullish={chartExampleIntradayPlanFixture.bullishScenario}
        bearish={chartExampleIntradayPlanFixture.bearishScenario}
      />
    );
    expect(screen.getByTestId("scenario-bull")).toHaveTextContent(/Trigger/i);
    expect(screen.getByTestId("scenario-bear")).toHaveTextContent(/Invalidation/i);
  });
});
