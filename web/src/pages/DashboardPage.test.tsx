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
const getSettings = vi.fn();
const updateSettings = vi.fn();
const saveManualExecution = vi.fn();
const v5Briefing = vi.fn();
const v5Score = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      latestDecision,
      systemStatus,
      listActiveSetups,
      listSetups,
      getSettings,
      updateSettings,
      saveManualExecution,
      v5Briefing,
      v5Score
    }
  })
}));

const defaultStatus = {
  backendVersion: "1.4.0-v5-intelligence",
  decisionBackendVersion: "1.4.0-v5-intelligence",
  ruleConfigVersion: "rules-1.1.0",
  setupRuleConfigVersion: "setup-rules-1.0.0",
  flags: {
    brokerLiveExecutionEnabled: false,
    setupTrackingEnvironments: ["TEST", "LIVE"],
    brokerMode: "DISABLED"
  },
  tradingView: { connectionStatus: "ACTIVE", webhookId: "wh1", lastAlertAt: null },
  latestDecision: null,
  activeSetups: [],
  brokerLiveExecutionEnabled: false,
  brokerMode: "DISABLED",
  liveForwardAckAt: "2026-07-21T12:00:00.000Z",
  manualRisk: {
    currency: "EUR",
    maxCashRiskPerTrade: 20,
    maxSimultaneousManualTrades: 1,
    maxDailyRealisedLoss: 40,
    stopAfterConsecutiveLosses: 2,
    valuePerPoint: null,
    estimatedSpreadPoints: null,
    noAveragingDown: true,
    noMartingale: true,
    noAutomaticRecovery: true
  },
  latestSetupSkip: null
};

describe("DashboardPage Stage 3", () => {
  beforeEach(() => {
    clearUserCaches();
    latestDecision.mockReset();
    systemStatus.mockReset();
    listActiveSetups.mockReset();
    listSetups.mockReset();
    getSettings.mockReset();
    updateSettings.mockReset();
    saveManualExecution.mockReset();
    v5Briefing.mockReset();
    v5Score.mockReset();
    systemStatus.mockResolvedValue(defaultStatus);
    listActiveSetups.mockResolvedValue([]);
    listSetups.mockResolvedValue([]);
    v5Briefing.mockResolvedValue({
      session: "LONDON",
      marketRegime: "UPTREND",
      currentState: "WAIT",
      levels: { poc: 2650, vah: 2658, val: 2642 },
      actionable: false,
      insufficientData: false,
      disclaimer: "Briefing only"
    });
    v5Score.mockResolvedValue({
      total: 72,
      components: [{ label: "Trend", score: 10, max: 12, reason: "ok" }],
      disclaimer: "Not probability"
    });
    getSettings.mockResolvedValue({
      aiEnabled: false,
      notificationsEnabled: true,
      provisionalSignalsEnabled: false,
      riskProfile: "BALANCED",
      liveForwardAckAt: "2026-07-21T12:00:00.000Z",
      manualRisk: defaultStatus.manualRisk,
      manualRiskLimitChangeLog: []
    });
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
    expect(screen.getByTestId("manual-risk-planner")).toBeInTheDocument();
    expect(screen.getByTestId("broker-confirm-banner")).toHaveTextContent(
      /GoldMeta does not place this trade/
    );
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
    expect(screen.getByTestId("brand-header")).toBeInTheDocument();
    expect(screen.getByTestId("daily-risk-status")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-last-refresh")).toBeInTheDocument();
  });
});
