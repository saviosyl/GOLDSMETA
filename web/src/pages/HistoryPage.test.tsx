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
const listSetups = vi.fn();
const listSignalOutcomes = vi.fn();
const navigate = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      decisionHistory,
      listSetups,
      listSignalOutcomes
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
    listSetups.mockReset();
    listSignalOutcomes.mockReset();
    navigate.mockReset();
    decisionHistory.mockResolvedValue([
      { ...(buy as Decision), timeframe: "15" },
      sell as Decision,
      wait as Decision
    ]);
    listSetups.mockResolvedValue([]);
    listSignalOutcomes.mockResolvedValue([]);
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
    expect(screen.getAllByText(/XAUUSD · 15m/).length).toBeGreaterThanOrEqual(1);
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
    await user.click(screen.getByRole("tab", { name: "Waits" }));
    expect(screen.queryByTestId("history-item-gm-web-buy")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-item-gm-web-wait")).toBeInTheDocument();

    await user.click(screen.getByTestId("history-item-gm-web-wait"));
    expect(navigate).toHaveBeenCalledWith("/history/gm-web-wait");
  });

  it("TEST filter excludes LIVE decisions and LIVE filter excludes TEST", async () => {
    const user = userEvent.setup();
    decisionHistory.mockResolvedValue([
      { ...(buy as Decision), decisionId: "d-test", environment: "TEST", isTestDecision: true },
      {
        ...(buy as Decision),
        decisionId: "d-live",
        environment: "LIVE",
        isTestDecision: false,
        dataQuality: "GOOD",
        dataSourceLabel: "LIVE"
      },
      { ...(wait as Decision), decisionId: "w-live", environment: "LIVE", isTestDecision: false }
    ]);
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    );
    await screen.findByTestId("history-item-d-test");
    expect(screen.getByTestId("env-badge-d-test")).toHaveTextContent("TEST");
    expect(screen.getByTestId("env-badge-d-live")).toHaveTextContent("LIVE");

    await user.click(screen.getByTestId("history-more-filters"));
    await user.click(screen.getByRole("button", { name: "Signals" }));
    expect(screen.getByTestId("history-item-d-test")).toBeInTheDocument();
    expect(screen.queryByTestId("history-item-d-live")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-item-w-live")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("history-more-filters"));
    await user.click(screen.getByRole("button", { name: "Demo/Live" }));
    expect(screen.queryByTestId("history-item-d-test")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-item-d-live")).toBeInTheDocument();
    expect(screen.getByTestId("history-item-w-live")).toBeInTheDocument();
  });
});
