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
      v5GlossaryTerm
    }
  })
}));

describe("IntelligencePage", () => {
  beforeEach(() => {
    v5Ask.mockReset();
    v5WeeklyCoach.mockReset();
    v5Personal.mockReset();
    v5ScreenshotAnalyse.mockReset();
    v5GlossaryTerm.mockReset();
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
      disclaimer: "Verified vs Explanation"
    });
    render(
      <MemoryRouter>
        <IntelligencePage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("intelligence-page")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByTestId("intelligence-answer")).toHaveTextContent("Verified data");
    expect(screen.getByText(/confirmation incomplete/)).toBeInTheDocument();
  });
});
