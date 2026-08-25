import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "../components/layout/AppShell";
import { OverviewPage } from "./OverviewPage";
import {
  formatSession,
  formatUserTimestamp,
  plainLanguageReason
} from "../lib/plainLanguage";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import "../styles/tokens.css";
import "../styles/redesign.css";

const decisionFixture = {
  decisionId: "dec_hidden_id_abc123",
  decision: "WAIT",
  reasonCodes: ["ONE-ACTIVE-SETUP", "still open"],
  reasonSummary: "Blocked",
  currentSession: "NEWYORK",
  generatedAt: "2026-07-21T21:45:00.000Z",
  barTime: "2026-07-21T21:30:00.000Z",
  lastKnownPrice: 2385.4,
  ohlcv: { high: 2391, low: 2376, close: 2385.4 },
  marketStructure: { poc: 2380, vah: 2390, val: 2370, trend: "RANGE" },
  environment: "LIVE",
  marketRegime: "RANGE"
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
    }),
    getSystemHealth: vi.fn().mockResolvedValue(null)
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
  mockApi.listSetups.mockResolvedValue([]);
  mockApi.v5Briefing.mockResolvedValue({
    session: "NEWYORK",
    marketRegime: "RANGE",
    positionVsPoc: "ABOVE_POC",
    atrLabel: "NORMAL",
    atrValue: 12.4,
    levels: { poc: 2380, vah: 2390, val: 2370 },
    currentState: "WAIT",
    insufficientData: false,
    dataTimestamp: "2026-07-21T21:45:00.000Z"
  });
  mockApi.v5Score.mockResolvedValue({
    total: 42,
    components: [
      { label: "Market Structure", score: 8, max: 20, reason: "Incomplete" },
      { label: "Confirmation", score: 4, max: 12, reason: "Incomplete" },
      { label: "Trend", score: 10, max: 12, reason: "Aligned" },
      { label: "Volume Profile", score: 8, max: 12, reason: "Near POC" },
      { label: "ATR", score: 6, max: 10, reason: "Normal" },
      { label: "News", score: 0, max: 5, reason: "No verified calendar available." }
    ],
    disclaimer: "GoldMeta Score is a rules-based quality score, not the probability of profit."
  });
});

describe("plainLanguage helpers", () => {
  it("formats sessions and timestamps for users", () => {
    expect(formatSession("NEWYORK")).toBe("New York");
    expect(formatUserTimestamp("2026-07-21T21:45:00.000Z")).toMatch(/21 Jul 2026|22 Jul 2026/);
    expect(plainLanguageReason(["ONE-ACTIVE-SETUP"])).toMatch(/another plan is still being tracked/i);
  });
});

describe("AppShell navigation", () => {
  it("renders the approved desktop and mobile five-screen navigation", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );

    const sidebar = screen.getByLabelText("GoldMeta navigation");
    const desktopPrimary = sidebar.querySelector(".gm26-sidebar-nav") as HTMLElement;
    expect(desktopPrimary).toBeTruthy();
    expect(within(desktopPrimary).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Home",
      "Short-Term",
      "Day Trade",
      "Gold Hunter",
      "History"
    ]);

    const mobileNav = screen.getByLabelText("GoldMeta mobile navigation");
    expect(within(mobileNav).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Home",
      "Short",
      "Day",
      "Hunter",
      "History"
    ]);
    expect(mobileNav.querySelectorAll("a")).toHaveLength(5);
    expect(mobileNav.textContent).not.toMatch(/AutoTrade|Alerts|More/);
  });

  it("opens the profile menu with secondary destinations", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Open profile menu" }));
    const menu = screen.getByRole("dialog", { name: "Profile menu" });
    expect(within(menu).getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: /Help/i })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: /Connections/i })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: /Risk planner/i })).toBeInTheDocument();
    expect(within(menu).queryByRole("link", { name: /Insights/i })).not.toBeInTheDocument();
  });
});

describe("OverviewPage redesign", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("shows compact action-first home and hides technical IDs by default", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("overview-page")).toBeInTheDocument();
    expect(await screen.findByTestId("intraday-action-label")).toHaveTextContent(/PREPARE|WAIT|HOLD/i);
    expect(screen.getByTestId("todays-intraday-plan")).toBeInTheDocument();
    expect(screen.getByTestId("setup-status-card")).toBeInTheDocument();
    // Legacy floating action bar removed — primary nav is fixed bottom only.
    expect(screen.queryByTestId("mobile-action-bar")).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-fit-view")).toBeInTheDocument();
    expect(screen.getByTestId("chart-fullscreen")).toBeInTheDocument();
    expect(screen.queryByTestId("premium-insight-strip")).not.toBeInTheDocument();
    expect(screen.queryByText("dec_hidden_id_abc123")).not.toBeInTheDocument();
    const analysis = screen.getByTestId("advanced-analysis-section");
    expect(analysis).not.toHaveAttribute("open");
    await user.click(analysis.querySelector("summary")!);
    expect(screen.getAllByTestId("setup-checklist").length).toBeGreaterThan(0);
    expect(screen.getByTestId("research-tab-plan")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Structure" }));
    expect(await screen.findByTestId("market-level-ladder")).toBeInTheDocument();
    expect(screen.getByTestId("overview-page").textContent).not.toMatch(/tester@example.com/);
    expect(screen.getAllByTestId("dashboard-autotrade-off")[0]).toBeInTheDocument();
    expect(screen.getByTestId("advanced-diagnostics-section")).not.toHaveAttribute("open");
    expect(screen.queryByText("SHADOW")).not.toBeInTheDocument();
  });

  it("reveals system status / technical details on demand", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await screen.findByTestId("overview-page");
    // Wait for pack load — advanced diagnostics only mounts with an intraday plan.
    await screen.findByTestId("todays-intraday-plan");
    const analysis = await screen.findByTestId("advanced-analysis-section");
    await user.click(analysis.querySelector("summary")!);
    const advanced = await screen.findByTestId("advanced-diagnostics-section");
    await user.click(advanced.querySelector("summary")!);
    const system = within(advanced).getByTestId("system-status-collapse");
    await user.click(system.querySelector("summary")!);
    expect(within(advanced).getByText(/dec_hidden_id_abc123/)).toBeInTheDocument();
    expect(screen.getAllByTestId("dashboard-autotrade-off")[0]).toBeInTheDocument();
    expect(within(advanced).getByTestId("dashboard-emergency-stop")).toBeInTheDocument();
    expect(within(advanced).getByTestId("goldmeta-score")).toBeInTheDocument();
  });

  it("keeps Help available through the profile menu without adding a sixth mobile nav item", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(screen.getByLabelText("GoldMeta mobile navigation").querySelectorAll("a")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Open profile menu" }));
    const menu = screen.getByRole("dialog", { name: "Profile menu" });
    expect(within(menu).getByRole("link", { name: /Help/i })).toBeInTheDocument();
  });
});
