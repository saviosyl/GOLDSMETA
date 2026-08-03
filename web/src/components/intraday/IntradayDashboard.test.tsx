import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chartExampleIntradayPlanFixture } from "../../fixtures/intradayPlanFixture";
import { IntradayActionCard } from "./IntradayActionCard";
import { ExpectedRangeCard } from "./ExpectedRangeCard";
import { ImportantLevelsPanel } from "./ImportantLevelsPanel";
import { ScenarioCards } from "./ScenarioCards";

describe("Issue #50 intraday dashboard components", () => {
  it("shows clearer action states instead of bare WAIT", () => {
    render(
      <MemoryRouter>
        <IntradayActionCard plan={chartExampleIntradayPlanFixture} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("intraday-action-label")).toHaveTextContent("PREPARE — SETUP FORMING");
    expect(screen.getByTestId("intraday-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("intraday-why-not-ready")).toHaveTextContent(/confirmation/i);
    expect(screen.getByTestId("intraday-setup-progress")).toHaveTextContent(/3 of 6/);
    expect(screen.getByTestId("intraday-entry-confirmation")).toBeInTheDocument();
  });

  it("orders probable and stretch range markers and labels estimates", () => {
    const r = chartExampleIntradayPlanFixture.expectedRange;
    expect(r.stretchLow!).toBeLessThanOrEqual(r.probableLow!);
    expect(r.probableLow!).toBeLessThanOrEqual(r.probableHigh!);
    expect(r.probableHigh!).toBeLessThanOrEqual(r.stretchHigh!);
    render(<ExpectedRangeCard range={r} />);
    expect(screen.getByTestId("range-disclaimer")).toHaveTextContent(/estimates only/i);
    expect(screen.getByTestId("range-probable-low")).toBeInTheDocument();
    expect(screen.getByTestId("range-stretch-high")).toBeInTheDocument();
  });

  it("never renders an important level without evidence and expands by mouse/keyboard", async () => {
    const user = userEvent.setup();
    const levels = chartExampleIntradayPlanFixture.importantLevels;
    for (const level of levels) {
      expect(level.reasons.length).toBeGreaterThan(0);
    }
    render(<ImportantLevelsPanel levels={levels} allLevels={levels} />);
    const card = screen.getByTestId("level-card-lvl-vah");
    expect(card).toHaveAttribute("aria-expanded", "false");
    await user.click(card);
    expect(card).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("level-detail-lvl-vah")).toHaveTextContent(/What it is/i);
    expect(screen.getByTestId("level-evidence")).toHaveTextContent(/VAH/i);
    expect(screen.getByText(/What happens if it holds/i)).toBeInTheDocument();
    expect(screen.getByText(/Simple explanation/i)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("level-detail-lvl-vah")).not.toBeInTheDocument();

    const support = screen.getByTestId("level-card-lvl-val");
    support.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("level-detail-lvl-val")).toBeInTheDocument();
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
