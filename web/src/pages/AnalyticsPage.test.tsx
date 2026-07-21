import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsPage } from "./AnalyticsPage";
import type { SetupAnalyticsSummary } from "../types/models";

const setupAnalytics = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: { setupAnalytics }
  })
}));

const empty: SetupAnalyticsSummary = {
  environment: "LIVE",
  sampleSize: 0,
  sampleSizeWarning: "Small sample (n=0). Do not treat rates as statistically significant.",
  totalSetups: 0,
  activeSetups: 0,
  completedSetups: 0,
  wins: 0,
  losses: 0,
  breakeven: 0,
  expired: 0,
  cancelled: 0,
  ambiguous: 0,
  winRate: null,
  lossRate: null,
  averageR: null,
  medianR: null,
  cumulativeR: 0,
  profitFactorR: null,
  averageBarsToEntry: null,
  averageBarsToResolution: null,
  tp1HitRate: null,
  tp2HitRate: null,
  tp3HitRate: null,
  slHitRate: null,
  averageMfe: null,
  averageMae: null,
  expectancyR: null,
  byDirection: { BUY: 0, SELL: 0 },
  bySession: {}
};

describe("AnalyticsPage", () => {
  beforeEach(() => {
    setupAnalytics.mockReset();
  });

  it("shows empty state and small-sample warning", async () => {
    setupAnalytics.mockResolvedValue(empty);
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("analytics-empty")).toBeInTheDocument();
    expect(screen.getByTestId("sample-warning")).toHaveTextContent(/Small sample/);
  });

  it("switches LIVE/TEST without mixing", async () => {
    const user = userEvent.setup();
    setupAnalytics.mockResolvedValue({
      ...empty,
      completedSetups: 2,
      wins: 1,
      losses: 1,
      sampleSize: 2,
      winRate: 50,
      averageR: 0.2,
      cumulativeR: 0.4,
      byDirection: { BUY: 1, SELL: 1 },
      bySession: { LONDON: 2 }
    });
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );
    await screen.findByText("LIVE summary");
    await user.click(screen.getByRole("tab", { name: "TEST" }));
    expect(setupAnalytics).toHaveBeenCalledWith("TEST");
  });
});
