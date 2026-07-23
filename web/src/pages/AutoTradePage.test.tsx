import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AutoTradePage } from "./AutoTradePage";
import { buildReviewAutoTradeStatus } from "../lib/autoTradeTypes";
import "../styles/redesign.css";

const baseStatus = buildReviewAutoTradeStatus();

const api = {
  autoTradeStatus: vi.fn(async () => baseStatus),
  autoTradeSetMode: vi.fn(async (mode: string) => ({
    ...baseStatus,
    mode,
    displayStatus: mode === "SHADOW" ? "SHADOW" : "OFF"
  })),
  autoTradeConnect: vi.fn(async () => ({
    ...baseStatus,
    connection: {
      ...baseStatus.connection,
      connected: true,
      connectionState: "Connected" as const,
      accountIdMasked: "****1234"
    }
  })),
  autoTradeDisconnect: vi.fn(async () => baseStatus),
  autoTradeDemoDiagnostics: vi.fn(async () => baseStatus),
  autoTradeEmergencyStop: vi.fn(async () => ({
    ...baseStatus,
    displayStatus: "LOCKED" as const,
    locked: true,
    mode: "OFF" as const,
    emergencyStopActive: true,
    lockReason: "emergency_stop"
  })),
  autoTradeUnlock: vi.fn(async () => baseStatus),
  autoTradeUpdateLimits: vi.fn(async () => baseStatus),
  autoTradeSelectBroker: vi.fn(async (broker: string) => ({
    ...baseStatus,
    selectedBroker: broker as "MANUAL" | "T212_INVEST" | "IG_DEMO",
    brokerBadge:
      broker === "T212_INVEST"
        ? "T212 PRACTICE — READ ONLY"
        : broker === "IG_DEMO"
          ? "IG DEMO — PARKED"
          : "MANUAL",
    igParked: broker !== "IG_DEMO"
  })),
  autoTradeT212Connect: vi.fn(async () => baseStatus),
  autoTradeT212Disconnect: vi.fn(async () => baseStatus),
  autoTradeT212Diagnostics: vi.fn(async () => baseStatus),
  autoTradeT212SearchInstruments: vi.fn(async () => ({
    candidates: [],
    status: baseStatus
  })),
  autoTradeT212ConfirmInstrument: vi.fn(async () => baseStatus),
  autoTradeT212CreateProposal: vi.fn(async () => ({
    proposal: null,
    status: baseStatus
  })),
  autoTradeT212ApproveDryRun: vi.fn(async () => ({
    proposal: null,
    status: baseStatus
  }))
};

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ api })
}));

describe("AutoTradePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.autoTradeStatus.mockResolvedValue(baseStatus);
  });

  it("renders control centre with MANUAL broker badge and emergency STOP", async () => {
    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("autotrade-page")).toBeInTheDocument());
    expect(screen.getByTestId("autotrade-mode-pill")).toHaveTextContent("OFF");
    expect(screen.getByTestId("autotrade-broker-badge")).toHaveTextContent("MANUAL");
    expect(screen.getByTestId("autotrade-readonly-banner")).toHaveTextContent(
      /Broker order submission is disabled/i
    );
    expect(screen.getByTestId("autotrade-emergency-stop")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-broker-selection")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-manual-note")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-t212-disclaimer")).toHaveTextContent(
      /not direct XAUUSD trading/i
    );
    expect(screen.getByText(/Remaining daily/i)).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-mode-IG_DEMO_AUTO")).toBeDisabled();
    expect(screen.queryByTestId("autotrade-live-activation")).not.toBeInTheDocument();
  });

  it("switches broker selection via API and updates badge", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByTestId("autotrade-broker-badge")).toHaveTextContent("MANUAL")
    );
    const t212Btn = screen.getByTestId("autotrade-broker-T212_INVEST");
    expect(t212Btn).not.toBeDisabled();
    await user.click(t212Btn);
    await waitFor(() => {
      expect(api.autoTradeSelectBroker).toHaveBeenCalledWith("T212_INVEST");
    });
    await waitFor(() => {
      expect(screen.getByTestId("autotrade-broker-badge").textContent).toMatch(/T212/);
    });
    expect(screen.getByTestId("autotrade-t212-connection")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-t212-connect")).toBeInTheDocument();
  });
});
