import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewPage } from "./OverviewPage";
import { ScoreBreakdown } from "../components/v5/ScoreBreakdown";
import { MarketLevelLadder } from "../components/v5/MarketLevelLadder";
import { PrimarySignalCard } from "../components/v5/PrimarySignalCard";
import { CurrentPlanCard } from "../components/v5/CurrentPlanCard";
import { MarketStoryCard } from "../components/v5/MarketStoryCard";
import { buildMarketStory } from "../lib/marketStory";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "tester@example.com" },
    signOut: vi.fn(),
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
        environment: "LIVE",
        marketRegime: "RANGE"
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
        marketRegime: "RANGE",
        positionVsPoc: "BELOW_POC",
        atrLabel: "NORMAL",
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
  it("colours WAIT amber and shows price/score/session inline", () => {
    render(
      <MemoryRouter>
        <PrimarySignalCard
          decisionCode="WAIT"
          sessionLabel="Asia"
          reason="Waiting for confirmation across additional candles."
          scoreTotal={61}
          compactTime="06:15"
          timeZone="Europe/Dublin"
          utcSecondary="05:15 UTC"
          livePrice={2385.4}
          setup={null}
        />
      </MemoryRouter>
    );
    const hero = screen.getByTestId("primary-decision");
    expect(hero).toHaveTextContent("WAIT");
    expect(hero.className).toMatch(/tone-wait/);
    expect(screen.getByTestId("primary-live-price")).toHaveTextContent("2385.40");
    expect(screen.getByTestId("primary-local-time")).toHaveTextContent(/Europe\/Dublin/);
    expect(screen.getByTestId("primary-local-time")).toHaveAttribute("title", "05:15 UTC");
  });

  it("uses green for BUY and red for SELL", () => {
    const { rerender } = render(
      <MemoryRouter>
        <PrimarySignalCard
          decisionCode="BUY"
          sessionLabel="London"
          reason="Bias"
          compactTime="x"
          timeZone="UTC"
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
          compactTime="x"
          timeZone="UTC"
          utcSecondary="00:00 UTC"
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("primary-decision").className).toMatch(/tone-sell/);
  });
});

describe("CurrentPlanCard", () => {
  it("shows calm empty state without NA rows", () => {
    render(
      <MemoryRouter>
        <CurrentPlanCard setup={null} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("no-shadow-plan")).toHaveTextContent(/No validated shadow plan yet/i);
    expect(screen.getByTestId("no-shadow-plan")).toHaveTextContent(/structure, confirmation/i);
  });
});

describe("Market Story", () => {
  it("builds deterministic story from verified fields only", () => {
    const result = buildMarketStory({
      decision: "WAIT",
      session: "ASIA",
      regime: "RANGE",
      positionVsPoc: "BELOW_POC",
      atrLabel: "NORMAL",
      poc: 2380,
      livePrice: 2375,
      components: [
        { label: "Trend", score: 12, max: 12, reason: "ok" },
        { label: "Confirmation", score: 2, max: 12, reason: "weak" }
      ]
    });
    expect(result.insufficient).toBe(false);
    expect(result.story).toMatch(/POC/i);
    expect(result.story).not.toMatch(/guaranteed|broker|probability of profit/i);
    expect(result.evidence.some((e) => e.startsWith("poc="))).toBe(true);
  });

  it("shows insufficient state", () => {
    render(<MarketStoryCard insufficientData />);
    expect(screen.getByTestId("market-story-insufficient")).toBeInTheDocument();
  });
});

describe("ScoreBreakdown", () => {
  it("stays collapsed until expand, then supports show all", async () => {
    const user = userEvent.setup();
    const components = [
      { label: "News", score: 1, max: 5, reason: "Reason" },
      { label: "Market Structure", score: 2, max: 12, reason: "Reason" },
      { label: "Confirmation", score: 3, max: 12, reason: "Reason" },
      { label: "Risk Geometry", score: 4, max: 14, reason: "Reason" },
      { label: "Trend", score: 10, max: 12, reason: "Reason" },
      { label: "Volume Profile", score: 8, max: 12, reason: "Reason" },
      { label: "ATR", score: 6, max: 10, reason: "Reason" },
      { label: "Momentum", score: 7, max: 7, reason: "Reason" }
    ];

    render(<ScoreBreakdown total={61} components={components} />);
    expect(screen.getByTestId("score-band")).toHaveTextContent(/incomplete/i);
    expect(screen.getByTestId("score-readiness")).toBeInTheDocument();
    expect(screen.queryByTestId("score-components")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("score-expand"));
    expect(screen.getByTestId("score-components").querySelectorAll("li")).toHaveLength(5);
    await user.click(screen.getByTestId("score-toggle"));
    expect(screen.getByTestId("score-components").querySelectorAll("li")).toHaveLength(8);
  });
});

describe("MarketLevelLadder", () => {
  it("renders live price and nearest labels", () => {
    render(
      <MarketLevelLadder
        input={{ livePrice: 100, poc: 98, vah: 105, val: 90 }}
        dataTimestamp="2026-07-21T21:45:00.000Z"
      />
    );
    expect(screen.getByTestId("ladder-live-price")).toBeInTheDocument();
    expect(screen.getByTestId("nearest-resistance")).toHaveTextContent("105.00");
    expect(screen.getByTestId("nearest-support")).toHaveTextContent("98.00");
  });
});

describe("OvernightReviewCard relevance", () => {
  it("hides when no overnight candidates", async () => {
    const { OvernightReviewCard } = await import("../components/v5/OvernightReviewCard");
    const { render: r, screen: s } = await import("@testing-library/react");
    r(
      <OvernightReviewCard
        review={{
          analysesHint: "",
          candidatesCreated: 0,
          validatedPlans: 0,
          best: null,
          items: [],
          disclaimer: "x"
        }}
      />
    );
    expect(s.queryByTestId("overnight-review")).not.toBeInTheDocument();
  });

  it("shows collapsed summary when relevant", async () => {
    const { OvernightReviewCard } = await import("../components/v5/OvernightReviewCard");
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OvernightReviewCard
          review={{
            analysesHint: "hint",
            candidatesCreated: 1,
            validatedPlans: 0,
            best: {
              setupId: "s1",
              direction: "BUY",
              status: "REJECTED",
              createdAt: "2026-07-21T22:00:00.000Z",
              resultLabel: "REJECTED"
            },
            items: [],
            disclaimer: "SHADOW RESULT — NOT AN EXECUTED TRADE."
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("overnight-summary")).toHaveTextContent(/1 candidate/i);
    expect(screen.getByTestId("overnight-summary")).toHaveTextContent(/0 validated/i);
    expect(screen.queryByTestId("overnight-expanded")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("overnight-summary"));
    expect(screen.getByTestId("overnight-expanded")).toBeInTheDocument();
  });
});

describe("CSS reduced-motion and density contracts", () => {
  it("disables live pulse under prefers-reduced-motion", async () => {
    const css = (await import("../styles/redesign.css?raw")).default as string;
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/gm-live-pulse/);
    expect(css).toMatch(/\.gm-dash-grid/);
    expect(css).toMatch(/gm-dashboard--v542/);
  });
});

describe("local-time formatting", () => {
  it("exposes UTC as secondary technical detail", async () => {
    const { formatLocalTimestamp } = await import("../lib/timezone");
    const ts = formatLocalTimestamp("2026-07-21T05:15:00.000Z", {
      mode: "iana",
      iana: "Europe/Dublin"
    });
    expect(ts.timeZone).toBe("Europe/Dublin");
    expect(ts.secondaryUtc).toMatch(/UTC/);
    expect(ts.primary).not.toMatch(/UTC/);
  });
});

describe("OverviewPage V5.4.2", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("shows primary signal first without email or summary grid", async () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("primary-signal-card")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("overview-page").textContent).not.toMatch(/tester@example.com/);
    expect(await screen.findByTestId("market-story")).toBeInTheDocument();
    expect(await screen.findByTestId("market-level-ladder")).toBeInTheDocument();
    expect(await screen.findByTestId("current-plan")).toBeInTheDocument();
    expect(await screen.findByTestId("overnight-review")).toBeInTheDocument();
    expect(await screen.findByTestId("goldmeta-score")).toBeInTheDocument();
    const tech = screen.getByText("Technical details").closest("details");
    expect(tech).not.toHaveAttribute("open");
  });
});
