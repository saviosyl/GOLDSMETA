import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
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
    v5Score: vi.fn()
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
  it("renders desktop sidebar links and mobile bottom nav", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );
    expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-bottom-nav")).toBeInTheDocument();
    expect(screen.getAllByText("Plan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Markets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Journal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("More").length).toBeGreaterThan(0);
  });

  it("opens More sheet with secondary destinations", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByTestId("mobile-more-sheet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toBeInTheDocument();
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
    expect(await screen.findByTestId("intraday-action-label")).toHaveTextContent(/WAIT/i);
    expect(screen.getByTestId("todays-intraday-plan")).toBeInTheDocument();
    expect(screen.getByTestId("setup-checklist")).toBeInTheDocument();
    expect(screen.getByTestId("research-tab-plan")).toBeInTheDocument();
    expect(screen.getByTestId("plan-stage-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-action-bar")).toBeInTheDocument();
    expect(screen.getByTestId("cockpit-bias")).toHaveTextContent(/Market bias:/i);
    expect(screen.queryByText("dec_hidden_id_abc123")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("view-research-btn"));
    await user.click(screen.getByRole("tab", { name: "Structure" }));
    expect(await screen.findByTestId("market-level-ladder")).toBeInTheDocument();
    expect(screen.getByTestId("overview-page").textContent).not.toMatch(/tester@example.com/);
    expect(screen.getByTestId("intraday-autotrade-off")).toHaveTextContent(/AutoTrade OFF/i);
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
    await user.click(screen.getByText(/ADVANCED DIAGNOSTICS/i));
    await user.click(screen.getByText(/System status/i));
    expect(screen.getByText(/dec_hidden_id_abc123/)).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-autotrade-off")).toHaveTextContent(/AutoTrade OFF/i);
    expect(screen.getByTestId("dashboard-emergency-stop")).toBeInTheDocument();
    expect(screen.getByTestId("goldmeta-score")).toBeInTheDocument();
  });

  it("includes Help in mobile navigation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("link", { name: "Help" })).toBeInTheDocument();
  });
});
