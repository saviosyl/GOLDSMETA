import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntelligencePage } from "./IntelligencePage";

const v5Ask = vi.fn();
const v5WeeklyCoach = vi.fn();
const v5Personal = vi.fn();
const v5ScreenshotAnalyse = vi.fn();
const v5GlossaryTerm = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      v5Ask,
      v5WeeklyCoach,
      v5Personal,
      v5ScreenshotAnalyse,
      v5GlossaryTerm,
      latestDecisionPack: vi.fn(async () => ({
        decision: {
          lastKnownPrice: 4265.31,
          currentSession: "LONDON",
          ohlcv: { open: 4250.1, close: 4265.31 }
        }
      }))
    }
  })
}));

describe("IntelligencePage honesty", () => {
  beforeEach(() => {
    v5Ask.mockReset();
    v5WeeklyCoach.mockReset();
    v5Personal.mockReset();
    v5ScreenshotAnalyse.mockReset();
    v5GlossaryTerm.mockReset();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    v5WeeklyCoach.mockResolvedValue({
      summary: "Week summary",
      insufficientData: true,
      disclaimer: "Coach disclaimer"
    });
    v5Personal.mockResolvedValue({
      ignoredWait: 0,
      averageR: null,
      largestWinningStreak: 0,
      largestLosingStreak: 0,
      sampleWarning: "small"
    });
  });

  it("asks intelligence and shows verified vs explanation", async () => {
    v5Ask.mockResolvedValue({
      answer: "Waiting because gates failed.",
      verifiedFacts: ["Verified rejection: confirmation incomplete"],
      explanations: ["WAIT means gates did not pass"],
      insufficientData: false,
      disclaimer: "Verified vs Explanation",
      implementationType: "deterministic_rules_templated"
    });
    render(
      <MemoryRouter>
        <IntelligencePage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("intelligence-page")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByTestId("intelligence-answer")).toHaveTextContent(
      /Waiting because gates failed/i
    );
    expect(screen.getByText(/confirmation incomplete/)).toBeInTheDocument();
    expect(screen.getByText("Verified data")).toBeInTheDocument();
  });

  it("labels Ask GoldMeta as deterministic, not AI", async () => {
    render(
      <MemoryRouter>
        <IntelligencePage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("intelligence-impl-type")).toHaveTextContent(
      /deterministic|rules-based|templated/i
    );
    expect(screen.getByTestId("intelligence-page")).toHaveTextContent(/not an AI chatbot/i);
    expect(screen.getByTestId("screenshot-beta-copy")).toHaveTextContent(/remains future work/i);
    expect(screen.getByTestId("screenshot-beta-copy")).toHaveTextContent(
      /does not automatically read exact prices/i
    );
  });

  it("labels screenshot comparison as beta without vision claims", async () => {
    render(
      <MemoryRouter>
        <IntelligencePage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("screenshot-section")).toHaveTextContent(
      /Screenshot Comparison — Beta/i
    );
    expect(screen.getByTestId("screenshot-beta-copy")).toHaveTextContent(
      /does not automatically read exact prices/i
    );
    expect(screen.getByTestId("screenshot-beta-copy")).toHaveTextContent(
      /cannot create or modify a setup/i
    );
  });

  it("shows offline stale status when navigator is offline", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(
      <MemoryRouter>
        <IntelligencePage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("offline-status")).toHaveTextContent(/stale/i);
    expect(screen.getByTestId("offline-status")).toHaveTextContent(/LIVE verification unavailable/i);
  });
});
