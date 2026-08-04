import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { chartExampleIntradayPlanFixture } from "../../fixtures/intradayPlanFixture";
import type { IntradayPlan } from "../../types/intradayPlan";
import { PrimaryPlanCard } from "./PrimaryPlanCard";
import { SetupChecklist } from "./SetupChecklist";
import { Confirmation5MCard } from "./Confirmation5MCard";
import { TimeframeAlignmentPanel } from "./TimeframeAlignmentPanel";
import { AlternativeScenario } from "./AlternativeScenario";
import { ExplainThisPage } from "./ExplainThisPage";

function wrap(ui: ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

function buyNowPlan(complete: boolean): IntradayPlan {
  const plan = structuredClone(chartExampleIntradayPlanFixture);
  plan.action = "BUY_NOW";
  plan.actionLabel = "BUY NOW";
  plan.whyNotReady = complete ? null : "Waiting on confirmation";
  plan.planSourceKey = "XAUUSD|LONDON|1|PLAN_15M";
  plan.oneSentence = "Buy pullback confirmed. Manage risk manually.";
  plan.setupProgress.items = plan.setupProgress.items.map((item) => ({
    ...item,
    complete,
    mark: complete ? "pass" : "pending"
  }));
  plan.setupProgress.complete = complete ? 6 : 4;
  plan.tradePlan = {
    ...plan.tradePlan,
    cardKind: complete ? "ACTIVE_PLAN" : "CONDITIONAL_REFERENCE",
    actionable: complete,
    orderingValid: complete,
    direction: complete ? "BUY" : "NONE",
    entryZone: "4040 – 4041",
    stopLoss: 4038,
    tp1: 4045,
    tp2: 4049
  };
  plan.geometryValid = complete ? true : null;
  plan.confirmation5m = complete
    ? {
        state: "BREAKOUT_CONFIRMED",
        label: "BREAKOUT CONFIRMED",
        meaningful: true,
        detail: "5M close held above trigger"
      }
    : {
        state: "NONE",
        label: "No meaningful 5M confirmation yet",
        meaningful: false,
        detail: "Waiting"
      };
  plan.freshness = {
    ...plan.freshness,
    marketStructureMode: "COMPLETE",
    sourceLabel: "GoldMeta Bridge 3.0.0"
  };
  return plan;
}

describe("Today's Intraday Plan UI", () => {
  it("renders one primary card with 2x2 Entry/Stop/TP1/TP2 prices", () => {
    const plan = buyNowPlan(true);
    render(wrap(<PrimaryPlanCard plan={plan} />));
    expect(screen.getByTestId("todays-intraday-plan")).toHaveTextContent(/Today's Intraday Plan/i);
    expect(screen.getByTestId("plan-level-entry").querySelector(".gm-plan-price")).toBeTruthy();
    expect(screen.getByTestId("plan-level-stop")).toHaveTextContent(/4,?038/);
    expect(screen.getByTestId("plan-level-tp1")).toHaveTextContent(/4,?045/);
    expect(screen.getByTestId("plan-level-tp2")).toHaveTextContent(/4,?049/);
    expect(screen.getByTestId("intraday-action-card")).toBeInTheDocument();
  });

  it("never shows fixture labels or joined prices", () => {
    render(wrap(<PrimaryPlanCard plan={chartExampleIntradayPlanFixture} />));
    const card = screen.getByTestId("todays-intraday-plan");
    expect(card).not.toHaveTextContent(/LABELLED FIXTURE/i);
    expect(card).not.toHaveTextContent(/not live market data/i);
    expect(card).not.toHaveTextContent(/preview fixture/i);
    expect(card.textContent || "").not.toMatch(/\d+\.\d+\d{1,3},\d{3}\.\d{2}/);
  });

  it("shows six-condition checklist with pass/pending marks", () => {
    render(<SetupChecklist plan={chartExampleIntradayPlanFixture} />);
    const list = screen.getByTestId("setup-checklist");
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByTestId("checklist-item-structure")).toHaveAttribute("data-mark", "pass");
    expect(screen.getByTestId("checklist-item-confirmation")).toHaveAttribute(
      "data-mark",
      "pending"
    );
  });

  it("colour-codes action with text+icon and gates BUY NOW", () => {
    const incomplete = buyNowPlan(false);
    const { rerender } = render(wrap(<PrimaryPlanCard plan={incomplete} />));
    expect(screen.getByTestId("intraday-action-card")).toHaveAttribute("data-tone", "wait");
    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("WAIT");
    expect(screen.getByTestId("action-now-gated")).toBeInTheDocument();

    rerender(wrap(<PrimaryPlanCard plan={buyNowPlan(true)} />));
    expect(screen.getByTestId("intraday-action-card")).toHaveAttribute("data-tone", "buy");
    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("BUY NOW");
    expect(screen.queryByTestId("action-now-gated")).not.toBeInTheDocument();
  });

  it("5M confirmation shows meaningful state only", () => {
    const { rerender } = render(<Confirmation5MCard plan={buyNowPlan(false)} />);
    expect(screen.getByTestId("confirmation-5m-card")).toHaveAttribute("data-meaningful", "0");
    rerender(<Confirmation5MCard plan={buyNowPlan(true)} />);
    expect(screen.getByTestId("confirmation-5m-card")).toHaveAttribute("data-meaningful", "1");
    expect(screen.getByTestId("confirm-5m-state")).toHaveTextContent(/BREAKOUT/i);
  });

  it("timeframe alignment concludes in plain language", () => {
    render(<TimeframeAlignmentPanel plan={chartExampleIntradayPlanFixture} />);
    expect(screen.getByTestId("tf-cell-4H")).toBeInTheDocument();
    expect(screen.getByTestId("tf-cell-5M")).toBeInTheDocument();
    expect(screen.getByTestId("tf-alignment-conclusion")).toHaveTextContent(/Conclusion/i);
  });

  it("alternative scenario stays collapsed by default", () => {
    render(<AlternativeScenario plan={chartExampleIntradayPlanFixture} />);
    const details = screen.getByTestId("alternative-scenario") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details).toHaveTextContent(/Alternative Scenario/i);
  });

  it("explain this plan opens beginner help", async () => {
    const user = userEvent.setup();
    render(<ExplainThisPage />);
    await user.click(screen.getByRole("button", { name: /Explain this plan/i }));
    expect(screen.getByTestId("explain-page-panel")).toHaveTextContent(/Colour meanings/i);
    expect(screen.getByTestId("explain-page-panel")).toHaveAttribute("role", "dialog");
  });

  it("NO TRADE uses dark-red tone and hides actionable levels", () => {
    const plan = structuredClone(chartExampleIntradayPlanFixture);
    plan.action = "NO_TRADE";
    plan.actionLabel = "NO TRADE";
    plan.planSourceKey = "XAUUSD|LONDON|1|PLAN_15M";
    plan.freshness = { ...plan.freshness, marketStructureMode: "MISMATCH" };
    render(wrap(<PrimaryPlanCard plan={plan} marketStructureMode="MISMATCH" />));
    expect(screen.getByTestId("intraday-action-card")).toHaveAttribute("data-tone", "notrade");
    expect(screen.getByTestId("plan-levels-hidden")).toBeInTheDocument();
  });

  it("NO_VALID_PLAN / LIVE_RANGE_ONLY shows waiting copy without levels", () => {
    const plan = structuredClone(chartExampleIntradayPlanFixture);
    plan.planStatus = "NO_VALID_PLAN";
    render(wrap(<PrimaryPlanCard plan={plan} marketStructureMode="LIVE_RANGE_ONLY" />));
    expect(screen.getByTestId("no-valid-plan-title")).toHaveTextContent(/NO VALID INTRADAY PLAN/i);
    expect(screen.getByTestId("no-valid-plan-next")).toHaveTextContent(/15-minute/i);
    expect(screen.queryByTestId("plan-level-entry")).not.toBeInTheDocument();
    expect(screen.getByTestId("todays-intraday-plan")).not.toHaveTextContent(/LABELLED FIXTURE/i);
  });

  it("legacy plan data shows enhanced-pending banner", () => {
    const plan = structuredClone(chartExampleIntradayPlanFixture);
    plan.planSourceKey = null;
    plan.freshness = { ...plan.freshness, marketStructureMode: "COMPLETE", sourceLabel: "2.1.0" };
    render(wrap(<PrimaryPlanCard plan={plan} marketStructureMode="COMPLETE" />));
    expect(screen.getByTestId("legacy-plan-banner")).toHaveTextContent(/Legacy plan data/i);
  });
});
