import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import { ApiError } from "../types/models";
import { clearUserCaches } from "../lib/offlineCache";
import buy from "../fixtures/buy.json";
import type { Decision } from "../types/models";

const latestDecision = vi.fn();
const systemStatus = vi.fn();
const listActiveSetups = vi.fn();
const listSetups = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      latestDecision,
      systemStatus,
      listActiveSetups,
      listSetups
    }
  })
}));

describe("DashboardPage empty decision state", () => {
  beforeEach(() => {
    clearUserCaches();
    latestDecision.mockReset();
    systemStatus.mockReset();
    listActiveSetups.mockReset();
    listSetups.mockReset();
    systemStatus.mockResolvedValue({
      backendVersion: "1.2.0-phase3",
      decisionBackendVersion: "1.2.0-phase3",
      ruleConfigVersion: "rules-1.1.0",
      setupRuleConfigVersion: "setup-rules-1.0.0",
      flags: { brokerLiveExecutionEnabled: false },
      tradingView: { connectionStatus: "ACTIVE", webhookId: "wh1", lastAlertAt: null },
      latestDecision: null,
      activeSetups: [],
      brokerLiveExecutionEnabled: false
    });
    listActiveSetups.mockResolvedValue([]);
    listSetups.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows No decision yet without an error banner when latest returns null (404 NOT_FOUND)", async () => {
    latestDecision.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "No decision yet" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Unable to load decision/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT_FOUND/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("system-status")).toBeInTheDocument();
  });

  it("keeps the error banner for real load failures", async () => {
    latestDecision.mockRejectedValue(new ApiError(500, "INTERNAL", "Server error"));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("INTERNAL: Server error");
    expect(screen.getByRole("heading", { name: "No decision yet" })).toBeInTheDocument();
  });

  it("renders a live decision card when a decision exists", async () => {
    latestDecision.mockResolvedValue(buy as Decision);

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("BUY")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "No decision yet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
