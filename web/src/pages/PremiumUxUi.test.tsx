import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewPage } from "./OverviewPage";
import { ScoreBreakdown } from "../components/v5/ScoreBreakdown";
import { MarketLevelLadder } from "../components/v5/MarketLevelLadder";
import { PrimarySignalCard } from "../components/v5/PrimarySignalCard";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";

const decisionFixture = {
  decisionId: "dec_hidden",
  decision: "WAIT",
  reasonCodes: ["CONFIRMATION"],
  currentSession: "ASIA",
  generatedAt: "2026-07-21T21:45:00.000Z",
  lastKnownPrice: 2385.4,
  ohlcv: { high: 2391, low: 2376, close: 2385.4 },
  marketStructure: { poc: 2380, vah: 2390, val: 2370, trend: "RANGE" },
  environment: "LIVE"
};

const { mockApi } = vi.hoisted(() => {
  const mockApi = {
    latestDecision: vi.fn(),
    latestDecisionPack: vi.fn(),
    listActiveSetups: vi.fn(),
    listSetups: vi.fn(),
    v5Briefing: vi.fn(),
    v5Score: vi.fn(),
    getMarketXauusdCandles: vi.fn().mockResolvedValue({
      symbol: "XAUUSD",
      timeframe: "M15",
      bars: [
        { time: 1_720_000_000, open: 2380, high: 2385, low: 2378, close: 2383 }
      ],
      source: "SHARED_CTRADER_TRENDBARS"
    })
  };
  return { mockApi };
});

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "tester@example.com" },
    api: mockApi
  })
}));

beforeEach(() => {
  mockApi.latestDecision.mockResolvedValue(decisionFixture);
  mockApi.latestDecisionPack.mockResolvedValue({
    decision: decisionFixture,
    latestQuote: decisionFixture,
    latestCompleteStrategySignal: decisionFixture,
    marketStructureMode: "COMPLETE",
    marketStructureDiagnostics: null,
    structureDecisionId: decisionFixture.decisionId,
    intradayPlan: chartExampleIntradayPlanFixture
  });
  mockApi.listActiveSetups.mockResolvedValue([]);
  mockApi.listSetups.mockResolvedValue([
    {
      setupId: "s1",
      direction: "BUY",
      status: "ACTIVE_SHADOW",
      createdAt: new Date().toISOString(),
      levels: { entryPrice: 2384 }
    }
  ]);
  mockApi.v5Briefing.mockResolvedValue({
    session: "ASIA",
    levels: { poc: 2380, vah: 2390, val: 2370 },
    dataTimestamp: "2026-07-21T21:45:00.000Z",
    insufficientData: false
  });
  mockApi.v5Score.mockResolvedValue({
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
  });
});

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
    expect(screen.getByTestId("no-shadow-plan")).toHaveTextContent(/No validated plan yet/i);
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
        input={{
          livePrice: 100,
          poc: 99,
          vah: 101.5,
          val: 98.5,
          dataSourceLabel: "LIVE",
          marketDataTime: "2026-07-21T21:45:00.000Z",
          brokerQuoteVerified: true
        }}
        dataTimestamp="2026-07-21T21:45:00.000Z"
      />
    );
    expect(screen.getByTestId("ladder-live-price")).toBeInTheDocument();
    expect(screen.getByTestId("market-level-ladder")).toHaveTextContent(/verified stored market data/i);
  });

  it("renders market data mismatch when price regimes disagree", () => {
    render(
      <MarketLevelLadder
        input={{
          livePrice: 2408,
          alertClose: 4045.165,
          poc: 4050.951,
          vah: 4052.975,
          val: 4047.193,
          barHigh: 2412,
          barLow: 2396
        }}
      />
    );
    expect(screen.getByTestId("market-data-mismatch-title")).toHaveTextContent(
      "Market data mismatch"
    );
    expect(screen.getByTestId("market-data-mismatch-alert")).toHaveTextContent(/4045\.1[67]/);
    expect(screen.getByTestId("market-data-mismatch-broker")).toHaveTextContent("2408.00");
  });
});

describe("OverviewPage compact dashboard", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("renders action-first intraday dashboard without email and collapses system status", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("intraday-action-card")).toBeInTheDocument();
    expect(screen.getByTestId("overview-page").textContent).not.toMatch(/tester@example.com/);
    expect(screen.getByTestId("intraday-action-label")).toHaveTextContent(/PREPARE|WAIT|HOLD/);
    expect(screen.getByTestId("setup-status-card")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-action-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("promo-snapshot-modal")).not.toBeInTheDocument();
    const analysis = screen.getByTestId("advanced-analysis-section");
    expect(analysis).not.toHaveAttribute("open");
    await user.click(analysis.querySelector("summary")!);
    expect(screen.getByTestId("todays-intraday-plan")).toBeInTheDocument();
    expect(screen.getAllByTestId("setup-checklist").length).toBeGreaterThan(0);
    expect(screen.getByTestId("share-market-snapshot")).toBeInTheDocument();
    const marketContext = screen.getByTestId("market-context-section");
    await user.click(marketContext.querySelector("summary")!);
    expect(within(marketContext).getByTestId("expected-range-card")).toBeInTheDocument();
    // Collapse market context so research level panels are unique in the DOM.
    await user.click(marketContext.querySelector("summary")!);
    await user.click(screen.getByRole("tab", { name: "Structure" }));
    expect(await screen.findByTestId("market-level-ladder")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Levels" }));
    expect(screen.getAllByTestId("important-levels-panel").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("overnight-review").length).toBeGreaterThan(0);
    expect(screen.getByTestId("advanced-diagnostics-section")).not.toHaveAttribute("open");
    const advanced = screen.getByTestId("advanced-diagnostics-section");
    await user.click(advanced.querySelector("summary")!);
    const system = within(advanced).getByTestId("system-status-collapse");
    expect(system).not.toHaveAttribute("open");
    expect(system).toHaveTextContent(/System status/i);
  });
});
