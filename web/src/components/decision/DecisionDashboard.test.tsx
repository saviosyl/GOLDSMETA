import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { chartExampleIntradayPlanFixture } from "../../fixtures/intradayPlanFixture";
import type { IntradayPlan } from "../../types/intradayPlan";
import type { MarketFeedHealth } from "../../types/models";
import { DecisionDashboard } from "./DecisionDashboard";
import { DetailedReportSections } from "./DetailedReportSections";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ api: {} })
}));

function wrap(ui: ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

const greenFeed: MarketFeedHealth = {
  status: "green",
  title: "GoldMeta Market Feed",
  subtitle: "All systems operational",
  quoteStatus: "live",
  lastVerifiedAt: new Date().toISOString(),
  lastVerifiedLabel: "12 seconds ago"
};

function basePlan(): IntradayPlan {
  const plan = structuredClone(chartExampleIntradayPlanFixture);
  plan.planSourceKey = "XAUUSD|LONDON|1|PLAN_15M";
  plan.freshness = { ...plan.freshness, marketStructureMode: "COMPLETE" };
  plan.geometryValid = true;
  plan.planQuality = { grade: "A", reasons: [] };
  return plan;
}

function potentialBuy(): IntradayPlan {
  const plan = basePlan();
  plan.action = "BUY_ON_PULLBACK";
  plan.actionLabel = "BUY ON PULLBACK";
  plan.oneSentence = "Manual long plan forming.";
  plan.planStatus = "ARMED";
  plan.tradePlan = {
    ...plan.tradePlan,
    cardKind: "CONDITIONAL_REFERENCE",
    actionable: false,
    orderingValid: true,
    direction: "BUY",
    entryZone: "4,040.00 - 4,042.00",
    stopLoss: 4036,
    tp1: 4048,
    tp2: 4054,
    riskReward: "1 : 2"
  };
  plan.confirmation5m = {
    state: "NONE",
    label: "No meaningful 5M confirmation yet",
    meaningful: false,
    detail: "Waiting"
  };
  return plan;
}

describe("DecisionDashboard", () => {
  it("shows a clear WAIT decision and plain no-valid copy", () => {
    const plan = basePlan();
    plan.planStatus = "NO_VALID_PLAN";
    plan.geometryValid = false;
    plan.geometryMessage = "Trade levels failed safety validation.";

    render(wrap(<DecisionDashboard plan={plan} marketFeedHealth={greenFeed} marketStructureMode="LIVE_RANGE_ONLY" />));

    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("WAIT");
    expect(screen.getByTestId("decision-plan-state")).toHaveTextContent("No valid plan yet");
    expect(screen.getByTestId("wait-monitoring-copy")).toHaveTextContent(/monitoring XAUUSD/i);
    expect(screen.getByTestId("no-valid-nearest-sr")).toBeInTheDocument();
    expect(screen.getByTestId("why-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-level-entry")).not.toBeInTheDocument();
  });

  it("shows Entry Stop and targets prominently for potential plans", () => {
    render(wrap(<DecisionDashboard plan={potentialBuy()} marketFeedHealth={greenFeed} livePrice={4039} />));

    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("PREPARE");
    expect(screen.getByTestId("decision-plan-state")).toHaveTextContent(/Watch for reclaim|confirmation/i);
    expect(screen.getByTestId("plan-level-entry")).toHaveTextContent(/4,040/);
    expect(screen.getByTestId("plan-level-stop")).toHaveTextContent(/4,036/);
    expect(screen.getByTestId("plan-level-tp1")).toHaveTextContent(/4,048/);
    expect(screen.getByTestId("potential-not-ready")).toHaveTextContent(/not ready/i);
  });

  it("does not present market bias as a valid entry", () => {
    const plan = basePlan();
    plan.planStatus = "NO_VALID_PLAN";
    plan.geometryValid = false;
    plan.directionBias = "BULLISH";

    render(wrap(<DecisionDashboard plan={plan} marketFeedHealth={greenFeed} />));

    expect(screen.getByTestId("no-valid-bias-note")).toHaveTextContent(/not an entry signal/i);
    expect(screen.queryByText(/enter on bias/i)).not.toBeInTheDocument();
  });

  it("describes the countdown as analysis timing only", () => {
    const plan = basePlan();
    plan.planStatus = "NO_VALID_PLAN";
    plan.geometryValid = false;

    render(wrap(<DecisionDashboard plan={plan} marketFeedHealth={greenFeed} />));

    expect(screen.getByTestId("analysis-timing-disclaimer")).toHaveTextContent(/not a guaranteed signal time/i);
    expect(screen.getByTestId("next-plan-update")).toHaveAttribute("title", expect.stringContaining("not guaranteed"));
  });

  it("keeps technical report below the quick dashboard and expandable", async () => {
    const user = userEvent.setup();
    const plan = potentialBuy();
    render(
      wrap(
        <>
          <DecisionDashboard plan={plan} marketFeedHealth={greenFeed} />
          <DetailedReportSections plan={plan} />
        </>
      )
    );

    const dashboard = screen.getByTestId("todays-intraday-plan");
    const details = screen.getByTestId("detailed-report-sections");
    expect(dashboard.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const raw = screen.getByTestId("detail-section-raw") as HTMLDetailsElement;
    expect(raw.open).toBe(false);
    await user.click(within(raw).getByText(/Raw technical diagnostics/i));
    expect(raw.open).toBe(true);
  });

  it("shows ready plan language only after confirmation passed", () => {
    const plan = potentialBuy();
    plan.action = "BUY_NOW";
    plan.confirmation5m = {
      state: "BREAKOUT_CONFIRMED",
      label: "BREAKOUT CONFIRMED",
      meaningful: true,
      detail: "5M close held"
    };

    render(wrap(<DecisionDashboard plan={plan} marketFeedHealth={greenFeed} />));

    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("BUY");
    expect(screen.getByTestId("decision-confirmation")).toHaveTextContent(/Passed/i);
    expect(screen.getByTestId("dashboard-autotrade-off")).toHaveTextContent(/AutoTrade OFF/i);
  });
});
