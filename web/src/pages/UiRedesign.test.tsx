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
import "../styles/tokens.css";
import "../styles/redesign.css";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "tester@example.com" },
    api: {
      latestDecision: vi.fn().mockResolvedValue({
        decisionId: "dec_hidden_id_abc123",
        decision: "WAIT",
        reasonCodes: ["ONE-ACTIVE-SETUP", "still open"],
        reasonSummary: "Blocked",
        currentSession: "NEWYORK",
        generatedAt: "2026-07-21T21:45:00.000Z",
        barTime: "2026-07-21T21:30:00.000Z",
        lastKnownPrice: 2385.4,
        environment: "LIVE",
        marketRegime: "RANGE"
      }),
      listActiveSetups: vi.fn().mockResolvedValue([]),
      listSetups: vi.fn().mockResolvedValue([]),
      v5Briefing: vi.fn().mockResolvedValue({
        session: "NEWYORK",
        marketRegime: "RANGE",
        positionVsPoc: "ABOVE_POC",
        atrLabel: "NORMAL",
        atrValue: 12.4,
        levels: { poc: 2380, vah: 2390, val: 2370 },
        currentState: "WAIT",
        insufficientData: false,
        dataTimestamp: "2026-07-21T21:45:00.000Z"
      }),
      v5Score: vi.fn().mockResolvedValue({
        total: 42,
        components: [{ label: "Structure", score: 8, max: 20, reason: "Incomplete" }],
        disclaimer: "GoldMeta Score is a rules-based setup-quality measurement."
      })
    }
  })
}));

describe("plainLanguage helpers", () => {
  it("formats sessions and timestamps for users", () => {
    expect(formatSession("NEWYORK")).toBe("New York");
    expect(formatUserTimestamp("2026-07-21T21:45:00.000Z")).toMatch(/21 Jul 2026/);
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
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
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
  });
});

describe("OverviewPage redesign", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("shows simplified home content and hides technical IDs by default", async () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("overview-page")).toBeInTheDocument();
    expect(screen.getByTestId("primary-decision")).toHaveTextContent(/Waiting/i);
    expect(screen.getByText(/another plan is still being tracked/i)).toBeInTheDocument();
    expect(screen.getAllByText(/New York/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("dec_hidden_id_abc123")).not.toBeInTheDocument();
    expect(screen.getByText("No validated shadow plan yet.")).toBeInTheDocument();
    expect(screen.getByText("View full score breakdown")).toBeInTheDocument();
  });

  it("reveals technical details on demand and keeps score collapsed", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await screen.findByTestId("overview-page");
    const scoreDetails = screen.getByText("View full score breakdown").closest("details");
    expect(scoreDetails).not.toHaveAttribute("open");
    await user.click(screen.getByText("Technical details"));
    expect(screen.getByText(/dec_hidden_id_abc123/)).toBeInTheDocument();
    await user.click(screen.getByText("View full score breakdown"));
    expect(scoreDetails).toHaveAttribute("open");
    expect(await screen.findByText(/42 \/ 100/)).toBeInTheDocument();
  });
});
