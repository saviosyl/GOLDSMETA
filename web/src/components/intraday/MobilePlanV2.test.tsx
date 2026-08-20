import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { chartExampleIntradayPlanFixture } from "../../fixtures/intradayPlanFixture";
import type { IntradayPlan } from "../../types/intradayPlan";
import { PrimaryPlanCard } from "./PrimaryPlanCard";
import { PlanStageStepper } from "./PlanStageStepper";
import { IntradayHeaderCard } from "./IntradayHeaderCard";

function wrap(ui: ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

function basePlan(): IntradayPlan {
  const plan = structuredClone(chartExampleIntradayPlanFixture);
  plan.planSourceKey = "XAUUSD|LONDON|1|PLAN_15M";
  plan.freshness = {
    ...plan.freshness,
    marketStructureMode: "COMPLETE",
    sourceLabel: "GoldMeta Bridge 3.0.0"
  };
  plan.geometryValid = true;
  return plan;
}

describe("Mobile Plan V2 states", () => {
  it("labels market bias as context, not a signal", () => {
    render(
      <IntradayHeaderCard
        plan={basePlan()}
        livePrice={4100.11}
        sessionLabel="New York"
        freshness="Updated 1m ago"
        source="live"
        compactTime="1m ago"
      />
    );
    expect(screen.getByTestId("cockpit-bias")).toHaveTextContent(/Market bias:/i);
    expect(screen.getByTestId("bias-context-hint")).toHaveTextContent(/not an entry signal/i);
    expect(screen.getByTestId("intraday-autotrade-off")).toHaveTextContent(/Live trading locked/i);
  });

  it("valid BUY shows levels and a single instruction", () => {
    const plan = basePlan();
    plan.action = "BUY_NOW";
    plan.actionLabel = "BUY NOW — PULLBACK";
    plan.oneSentence = "Manual long plan ready. Review risk before entering.";
    plan.setupProgress.items = plan.setupProgress.items.map((i) => ({
      ...i,
      complete: true,
      mark: "pass" as const
    }));
    plan.setupProgress.complete = 6;
    plan.tradePlan = {
      ...plan.tradePlan,
      actionable: true,
      orderingValid: true,
      direction: "BUY",
      entryZone: "4098 – 4100",
      stopLoss: 4095,
      tp1: 4108,
      tp2: 4114,
      riskReward: "1 : 1.8",
      cardKind: "ACTIVE_PLAN"
    };
    plan.confirmation5m = {
      state: "BREAKOUT_CONFIRMED",
      label: "BREAKOUT CONFIRMED",
      meaningful: true,
      detail: "Confirmed"
    };
    render(wrap(<PrimaryPlanCard plan={plan} marketStructureMode="COMPLETE" />));
    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent(/BUY/i);
    expect(screen.getByTestId("plan-level-entry")).toBeInTheDocument();
    expect(screen.getByTestId("plan-level-rr")).toHaveTextContent(/1\s*:\s*1\.8/);
    expect(screen.getByTestId("intraday-one-sentence")).toHaveTextContent(/Review risk/i);
  });

  it("valid SELL shows rejection headline without NO VALID copy", () => {
    const plan = basePlan();
    plan.action = "SELL_NOW";
    plan.actionLabel = "SELL NOW — REJECTION";
    plan.oneSentence = "Wait for a bearish 5M close inside the entry zone.";
    plan.setupProgress.items = plan.setupProgress.items.map((i) => ({
      ...i,
      complete: true,
      mark: "pass" as const
    }));
    plan.tradePlan = {
      ...plan.tradePlan,
      actionable: true,
      orderingValid: true,
      direction: "SELL",
      entryZone: "4102 – 4104",
      stopLoss: 4108,
      tp1: 4096,
      tp2: 4090,
      cardKind: "ACTIVE_PLAN"
    };
    plan.confirmation5m = {
      state: "REJECTION_CONFIRMED",
      label: "REJECTION CONFIRMED",
      meaningful: true,
      detail: "Confirmed"
    };
    render(wrap(<PrimaryPlanCard plan={plan} marketStructureMode="COMPLETE" />));
    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent(/SELL/i);
    expect(screen.queryByText(/NO VALID PLAN/i)).not.toBeInTheDocument();
  });

  it("NO TRADE uses dark-red card and hides entry/stop/targets", () => {
    const plan = basePlan();
    plan.action = "NO_TRADE";
    plan.actionLabel = "NO TRADE";
    plan.planStatus = "NO_TRADE";
    plan.freshness.marketStructureMode = "MISMATCH";
    render(wrap(<PrimaryPlanCard plan={plan} marketStructureMode="MISMATCH" />));
    expect(screen.getByTestId("todays-intraday-plan")).toHaveAttribute("data-state", "NO_TRADE");
    expect(screen.getByTestId("no-trade-reason")).toHaveTextContent(/Price sources disagree/i);
    expect(screen.queryByTestId("plan-level-entry")).not.toBeInTheDocument();
  });

  it("stage stepper never uses red failure marks for ordinary waiting", () => {
    const plan = basePlan();
    plan.planStatus = "NO_VALID_PLAN";
    plan.geometryValid = false;
    render(<PlanStageStepper plan={plan} marketStructureMode="LIVE_RANGE_ONLY" />);
    expect(screen.getByTestId("plan-stage-context")).toHaveAttribute("data-status", "current");
    expect(screen.getByTestId("plan-stage-zone")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("plan-stage-confirm")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("plan-stage-context").querySelector(".gm-stage-mark")).toHaveTextContent(
      "○"
    );
    expect(screen.getByTestId("plan-stage-context").querySelector(".gm-stage-mark")).not.toHaveTextContent(
      "✕"
    );
  });

  it("tapping a stage shows a short explanation", async () => {
    const user = userEvent.setup();
    render(<PlanStageStepper plan={basePlan()} marketStructureMode="COMPLETE" />);
    await user.click(screen.getByTestId("plan-stage-context").querySelector("button")!);
    expect(screen.getByTestId("plan-stage-tip-context")).toBeInTheDocument();
  });
});
