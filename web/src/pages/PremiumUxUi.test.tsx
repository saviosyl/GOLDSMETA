import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewPage } from "./OverviewPage";
import { ScoreBreakdown } from "../components/v5/ScoreBreakdown";
import { MarketLevelLadder } from "../components/v5/MarketLevelLadder";
import { PrimarySignalCard } from "../components/v5/PrimarySignalCard";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "tester@example.com" },
    api: {
      latestDecision: vi.fn().mockResolvedValue({
        decisionId: "dec_hidden",
        decision: "WAIT",
        reasonCodes: ["CONFIRMATION"],
        currentSession: "ASIA",
        generatedAt: "2026-07-21T21:45:00.000Z",
        lastKnownPrice: 2385.4,
        ohlcv: { high: 2391, low: 2376, close: 2385.4 },
        marketStructure: { poc: 2380, vah: 2390, val: 2370, trend: "RANGE" },
        environment: "LIVE"
      }),
      listActiveSetups: vi.fn().mockResolvedValue([]),
      listSetups: vi.fn().mockResolvedValue([
        {
          setupId: "s1",
          direction: "BUY",
          status: "ACTIVE_SHADOW",
          createdAt: new Date().toISOString(),
          levels: { entryPrice: 2384 }
        }
      ]),
      v5Briefing: vi.fn().mockResolvedValue({
        session: "ASIA",
        levels: { poc: 2380, vah: 2390, val: 2370 },
        dataTimestamp: "2026-07-21T21:45:00.000Z",
        insufficientData: false
      }),
      v5Score: vi.fn().mockResolvedValue({
        total: 61,
        components: [
          { label: "Trend", score: 12, max: 12, reason: "Strong bias" },
          { label: "Market Structure", score: 2, max: 12, reason: "Weak structure" },
          { label: "Confirmation", score: 3.6, max: 12, reason: "Incomplete" },
          { label: "Risk Geometry", score: 0, max: 14, reason: "Not evaluated" },
          { label: "Volume Profile", score: 12, max: 12, reason: "Near POC" },
          { label: "ATR", score: 10, max: 10, reason: "Normal" },
          { label: "Session", score: 5.6, max: 8, reason: "Acceptable" },
          { label: "Liquidity", score: 3.2, max: 8, reason: "Partial" },
          { label: "Momentum", score: 7, max: 7, reason: "Aligned" },
          { label: "News", score: 0, max: 5, reason: "No verified calendar available." }
        ],
        disclaimer: "GoldMeta Score is a rules-based quality score, not the probability of profit."
      })
    }
  })
}));

describe("PrimarySignalCard semantics", () => {
  it("colours WAIT amber and shows no fabricated plan levels", () => {
    render(
      <MemoryRouter>
        <PrimarySignalCard
          decisionCode="WAIT"
          sessionLabel="Asia"
          reason="Waiting for confirmation"
          scoreTotal={61}
          localPrimary="22 Jul 2026 at 06:15"
          localZone="Europe/Dublin"
          utcSecondary="05:15 UTC"
          poc={2380}
          vah={2390}
          val={2370}
          setup={null}
        />
      </MemoryRouter>
    );
    const hero = screen.getByTestId("primary-decision");
    expect(hero).toHaveTextContent("WAIT");
    expect(hero.className).toMatch(/tone-wait/);
    expect(screen.getByTestId("no-shadow-plan")).toHaveTextContent(/No validated shadow plan yet/i);
    expect(screen.getByTestId("primary-local-time")).toHaveTextContent(/Europe\/Dublin/);
    expect(screen.getByTestId("primary-local-time")).toHaveTextContent(/05:15 UTC/);
  });

  it("uses green for BUY and red for SELL", () => {
    const { rerender } = render(
      <MemoryRouter>
        <PrimarySignalCard
          decisionCode="BUY"
          sessionLabel="London"
          reason="Bias"
          localPrimary="x"
          localZone="UTC"
          utcSecondary="00:00 UTC"
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("primary-decision").className).toMatch(/tone-buy/);
    rerender(
      <MemoryRouter>
        <PrimarySignalCard
          decisionCode="SELL"
          sessionLabel="London"
          reason="Bias"
          localPrimary="x"
          localZone="UTC"
          utcSecondary="00:00 UTC"
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("primary-decision").className).toMatch(/tone-sell/);
  });
});

describe("ScoreBreakdown", () => {
  it("collapses components and expands on demand", async () => {
    const user = userEvent.setup();
    const components = Array.from({ length: 8 }, (_, i) => ({
      label: `Component ${i}`,
      score: i,
      max: 10,
      reason: "Reason"
    }));
    // Use priority labels so Market Structure ranks first
    components[0]!.label = "News";
    components[1]!.label = "Market Structure";
    components[2]!.label = "Confirmation";
    components[3]!.label = "Risk Geometry";
    components[4]!.label = "Trend";
    components[5]!.label = "Volume Profile";
    components[6]!.label = "ATR";
    components[7]!.label = "Momentum";

    render(<ScoreBreakdown total={61} components={components} compact />);
    expect(screen.getByTestId("score-band")).toHaveTextContent(/SETUP INCOMPLETE/i);
    expect(screen.getByTestId("score-components").querySelectorAll("li")).toHaveLength(5);
    await user.click(screen.getByTestId("score-toggle"));
    expect(screen.getByTestId("score-components").querySelectorAll("li")).toHaveLength(8);
    await user.click(screen.getByTestId("score-toggle"));
    expect(screen.getByTestId("score-components").querySelectorAll("li")).toHaveLength(5);
  });
});

describe("MarketLevelLadder", () => {
  it("renders live price marker", () => {
    render(
      <MarketLevelLadder
        input={{ livePrice: 100, poc: 98, vah: 105, val: 90 }}
        dataTimestamp="2026-07-21T21:45:00.000Z"
      />
    );
    expect(screen.getByTestId("ladder-live-price")).toBeInTheDocument();
    expect(screen.getByTestId("market-level-ladder")).toHaveTextContent(/verified stored market data/i);
  });
});

describe("OverviewPage compact dashboard", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("renders compact summary without email and shows primary signal + ladder", async () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("dashboard-summary")).toBeInTheDocument();
    expect(screen.getByTestId("overview-page").textContent).not.toMatch(/tester@example.com/);
    expect(await screen.findByTestId("primary-signal-card")).toBeInTheDocument();
    expect(screen.getByTestId("share-market-snapshot")).toBeInTheDocument();
    expect(screen.queryByTestId("promo-snapshot-modal")).not.toBeInTheDocument();
    expect(await screen.findByTestId("market-level-ladder")).toBeInTheDocument();
    expect(await screen.findByTestId("overnight-review")).toBeInTheDocument();
    expect(await screen.findByTestId("goldmeta-score")).toBeInTheDocument();
    // technical id stays inside collapsed disclosure
    const tech = screen.getByText("Technical details").closest("details");
    expect(tech).not.toHaveAttribute("open");
  });
});
