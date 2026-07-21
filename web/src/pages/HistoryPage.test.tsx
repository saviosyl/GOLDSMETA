import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryPage } from "./HistoryPage";
import type { Decision } from "../types/models";
import buy from "../fixtures/buy.json";
import sell from "../fixtures/sell.json";
import wait from "../fixtures/wait.json";

const decisionHistory = vi.fn();
const navigate = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      decisionHistory
    }
  })
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate
  };
});

describe("HistoryPage", () => {
  beforeEach(() => {
    decisionHistory.mockReset();
    navigate.mockReset();
    decisionHistory.mockResolvedValue([
      { ...(buy as Decision), timeframe: "15" },
      sell as Decision,
      wait as Decision
    ]);
  });

  it("formats history rows without raw decision IDs", async () => {
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    );

    expect(await screen.findByTestId("history-item-gm-web-buy")).toBeInTheDocument();
    expect(screen.getByTestId("history-item-gm-web-sell")).toBeInTheDocument();
    expect(screen.getByTestId("history-item-gm-web-wait")).toBeInTheDocument();
    expect(screen.getByText(/XAUUSD · 15m/)).toBeInTheDocument();
    expect(screen.queryByText("gm-web-buy")).not.toBeInTheDocument();
    expect(screen.getByText("Wait for fresh market data")).toBeInTheDocument();
  });

  it("filters by WAIT and opens detail on tap", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    );

    await screen.findByTestId("history-item-gm-web-buy");
    await user.click(screen.getByRole("tab", { name: "WAIT" }));
    expect(screen.queryByTestId("history-item-gm-web-buy")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-item-gm-web-wait")).toBeInTheDocument();

    await user.click(screen.getByTestId("history-item-gm-web-wait"));
    expect(navigate).toHaveBeenCalledWith("/history/gm-web-wait");
  });
});
