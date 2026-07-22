import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplayPage } from "./ReplayPage";

const v5Replay = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: { v5Replay }
  })
}));

describe("ReplayPage", () => {
  beforeEach(() => {
    v5Replay.mockReset();
  });

  it("paginates the timeline window instead of rendering unlimited rows", async () => {
    const user = userEvent.setup();
    const frames = Array.from({ length: 40 }, (_, i) => ({
      barTime: `2026-07-21T${String(i % 24).padStart(2, "0")}:${String(i).padStart(2, "0")}:00.000Z`,
      analysisSummary: `a${i}`,
      candidateStatus: null,
      planStatus: null,
      lifecycleNote: null,
      result: null
    }));
    v5Replay.mockResolvedValue({ frames, disclaimer: "Educational only" });
    render(
      <MemoryRouter>
        <ReplayPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("replay-window-list")).toBeInTheDocument();
    const chips = screen.getByTestId("replay-window-list").querySelectorAll("button");
    expect(chips.length).toBeLessThanOrEqual(12);
    expect(screen.getByTestId("replay-window")).toHaveTextContent(/cap memory/i);
    expect(screen.getByTestId("replay-window")).toHaveTextContent(/page 1\/4/);
    await user.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => {
      expect(screen.getByTestId("replay-window")).toHaveTextContent(/page 2\/4/);
    });
  });

  it("handles missing history honestly", async () => {
    v5Replay.mockResolvedValue({ frames: [], disclaimer: "none" });
    render(
      <MemoryRouter>
        <ReplayPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("replay-empty")).toHaveTextContent(
      /Insufficient verified data/i
    );
  });
});
