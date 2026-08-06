import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { chartExampleIntradayPlanFixture } from "../../fixtures/intradayPlanFixture";
import type { IntradayPlan } from "../../types/intradayPlan";
import { DecisionDashboard } from "../decision/DecisionDashboard";
import { PremiumMarketStrip } from "./PremiumMarketStrip";
import { PremiumInsightStrip } from "./PremiumInsightStrip";
import { PremiumPlanCard } from "./PremiumPlanCard";
import { deriveDecisionDashboardState } from "../../lib/decisionDashboardState";
import { KeyLevelsPage } from "../../pages/KeyLevelsPage";
import { AlertsSetupPage } from "../../pages/AlertsSetupPage";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    api: {
      latestDecisionPack: vi.fn(async () => ({
        decision: { lastKnownPrice: 4265.31, generatedAt: new Date().toISOString() },
        marketStructureMode: "LIVE_RANGE_ONLY",
        intradayPlan: (() => {
          const plan = structuredClone(chartExampleIntradayPlanFixture);
          plan.planStatus = "NO_VALID_PLAN";
          plan.geometryValid = false;
          return plan;
        })(),
        marketFeedHealth: {
          status: "amber",
          title: "Limited",
          subtitle: "Quotes limited",
          quoteStatus: "limited",
          lastVerifiedAt: null,
          lastVerifiedLabel: "30s ago"
        }
      })),
      marketFeedHealth: vi.fn(async () => ({
        status: "green",
        title: "Operational",
        subtitle: "Live",
        quoteStatus: "live",
        lastVerifiedAt: null,
        lastVerifiedLabel: "now"
      })),
      listNotifications: vi.fn(async () => []),
      notificationPreferences: vi.fn(async () => ({
        VALID_PLAN_CREATED: true,
        ENTRY_ZONE_APPROACHING: true,
        ENTRY_ZONE_REACHED: true,
        CONFIRM_5M: true,
        PLAN_INVALIDATED: true,
        TARGETS_REACHED: true
      })),
      updateNotificationPreferences: vi.fn(),
      adminMarketFeedStatus: vi.fn(async () => ({
        health: {
          status: "green",
          title: "Operational",
          subtitle: "Live",
          quoteStatus: "live",
          lastVerifiedAt: null,
          lastVerifiedLabel: "now"
        },
        checklist: [
          { id: "pine30", label: "Pine 3.0 installed", status: "pass" },
          { id: "plan15m", label: "PLAN_15M received", status: "pass" },
          { id: "confirm5m", label: "CONFIRM_5M received", status: "pass" },
          { id: "quote1m", label: "QUOTE_1M optional", status: "optional" },
          { id: "legacy", label: "Old Pine 2.1 alert disabled", status: "pass" }
        ],
        sharedWebhookUrl: "https://example.test/webhook"
      }))
    },
    account: { role: "OWNER" },
    user: { email: "owner@example.com" }
  })
}));

vi.mock("../../lib/push", () => ({
  getNotificationPermission: () => "default",
  isProbablyInstalledPwa: () => true,
  isWebPushSupported: () => true,
  subscribeWebPush: vi.fn()
}));

function wrap(ui: ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

function waitPlan(): IntradayPlan {
  const plan = structuredClone(chartExampleIntradayPlanFixture);
  plan.planStatus = "NO_VALID_PLAN";
  plan.geometryValid = false;
  return plan;
}

describe("Premium UI redesign", () => {
  it("renders premium WAIT hero with support/resistance and quick actions", () => {
    render(
      wrap(
        <DecisionDashboard
          plan={waitPlan()}
          marketStructureMode="LIVE_RANGE_ONLY"
          livePrice={4265.31}
        />
      )
    );
    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("WAIT");
    expect(screen.getByTestId("decision-plan-state")).toHaveTextContent(/No valid plan yet/i);
    expect(screen.getByTestId("nearest-support")).toBeInTheDocument();
    expect(screen.getByTestId("nearest-resistance")).toBeInTheDocument();
    expect(screen.getByTestId("premium-quick-actions")).toBeInTheDocument();
    expect(screen.getByTestId("premium-hero-status")).toHaveTextContent(/Monitoring/i);
  });

  it("renders market strip, insight strip, and plan card without overflow classes", () => {
    const plan = waitPlan();
    const state = deriveDecisionDashboardState({
      plan,
      marketStructureMode: "LIVE_RANGE_ONLY",
      livePrice: 4265.31
    });
    const { container } = render(
      wrap(
        <>
          <PremiumMarketStrip
            livePrice={4265.31}
            updatedLabel="07:52"
            sessionLabel="London"
            feedHealth={{
              status: "amber",
              title: "Limited",
              subtitle: "Quotes limited",
              quoteStatus: "limited",
              lastVerifiedAt: null,
              lastVerifiedLabel: "30s ago"
            }}
          />
          <PremiumInsightStrip trendBias="Neutral" volatility="Moderate" newsImpact="Low" />
          <PremiumPlanCard plan={plan} state={state} updatedLabel="30s ago" />
        </>
      )
    );
    expect(screen.getByTestId("premium-market-strip")).toBeInTheDocument();
    expect(screen.getByTestId("premium-insight-strip")).toBeInTheDocument();
    expect(screen.getByTestId("premium-plan-card")).toBeInTheDocument();
    expect(container.querySelector(".gm-premium-market-strip")).toBeTruthy();
  });

  it("renders levels and alerts setup pages", async () => {
    render(wrap(<KeyLevelsPage />));
    expect(await screen.findByTestId("key-levels-page")).toBeInTheDocument();
    expect(screen.getByText(/All Key Levels/i)).toBeInTheDocument();

    render(wrap(<AlertsSetupPage />));
    expect(await screen.findByTestId("alerts-setup-page")).toBeInTheDocument();
    expect(await screen.findByTestId("premium-setup-health")).toHaveTextContent(/Setup complete/i);
    expect(screen.getByText(/Pine 3\.0 detected/i)).toBeInTheDocument();
    expect(screen.getByText(/No recent legacy Bridge traffic/i)).toBeInTheDocument();
  });
});
