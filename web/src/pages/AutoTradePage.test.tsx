import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AutoTradePage } from "./AutoTradePage";
import {
  buildReviewAutoTradeStatus,
  type AutoTradeStatus
} from "../lib/autoTradeTypes";
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

  it("keeps Select local until Confirm and shows Practice read-only summary", async () => {
    const user = userEvent.setup();
    const t212Status: AutoTradeStatus = {
      ...baseStatus,
      selectedBroker: "T212_INVEST",
      brokerBadge: "T212 PRACTICE — READ ONLY",
      displayStatus: "OFF",
      mode: "OFF",
      t212: {
        connected: true,
        environment: "PRACTICE",
        mode: "TRADING_212_PRACTICE_READ_ONLY",
        currency: "EUR",
        freeCash: 5000,
        investedValue: 0,
        totalValue: 5000,
        selectedInstrument: null,
        holdingQuantity: null,
        lastHeartbeatAt: null,
        connectionState: "Connected",
        ordersEnabled: false,
        paperOrderSubmissionEnabled: false,
        liveExecutionFeatureEnabled: false
      },
      t212GoldCandidates: [
        {
          instrumentId: "EGLNl_EQ",
          ticker: "EGLNl_EQ",
          name: "iShares Physical Gold",
          currency: "EUR",
          isin: "IE00B4ND3602",
          exchange: null,
          type: "ETF",
          fractionalSupported: null,
          minOrderQuantity: null,
          minOrderValue: null,
          marketOpen: null,
          goldMatchReason: "Physical gold product candidate"
        }
      ]
    };
    api.autoTradeStatus.mockResolvedValue(t212Status);
    api.autoTradeSelectBroker.mockResolvedValue(t212Status);

    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("autotrade-broker-badge")).toHaveTextContent(/T212 PRACTICE/i)
    );
    expect(screen.getByTestId("autotrade-mode-pill")).toHaveTextContent("OFF");
    expect(screen.getByTestId("autotrade-emergency-stop")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-t212-candidates")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-t212-confirm-warning")).toHaveTextContent(
      /does not|No broker orders|long-only/i
    );
    expect(screen.getByTestId("autotrade-t212-confirm-instrument")).toBeDisabled();

    await user.click(screen.getByTestId("autotrade-t212-select-EGLNl_EQ"));
    expect(api.autoTradeT212ConfirmInstrument).not.toHaveBeenCalled();
    expect(screen.getByTestId("autotrade-t212-confirm-summary")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-t212-confirm-ticker")).toHaveTextContent("EGLNl_EQ");
    expect(screen.getByTestId("autotrade-t212-confirm-name")).toHaveTextContent(
      "iShares Physical Gold"
    );
    expect(screen.getByTestId("autotrade-t212-confirm-currency")).toHaveTextContent("EUR");
    expect(screen.getByTestId("autotrade-t212-confirm-isin")).toHaveTextContent("IE00B4ND3602");
    expect(screen.getByTestId("autotrade-t212-confirm-summary")).toHaveTextContent(
      /Trading 212 Practice — Read Only/i
    );
    expect(screen.getByTestId("autotrade-t212-confirm-summary")).toHaveTextContent(
      /No orders will be submitted/i
    );
    expect(screen.getByTestId("autotrade-t212-confirm-instrument")).not.toBeDisabled();
  });

  it("shows confirmed instrument identity and €50 eligibility limitation", async () => {
    const t212Status: AutoTradeStatus = {
      ...baseStatus,
      selectedBroker: "T212_INVEST",
      brokerBadge: "T212 PRACTICE — READ ONLY",
      displayStatus: "OFF",
      mode: "OFF",
      t212: {
        connected: true,
        environment: "PRACTICE",
        mode: "TRADING_212_PRACTICE_READ_ONLY",
        currency: "EUR",
        freeCash: 5000,
        investedValue: 0,
        totalValue: 5000,
        selectedInstrument: {
          instrumentId: "EGLNl_EQ",
          ticker: "EGLNl_EQ",
          name: "iShares Physical Gold",
          currency: "EUR",
          isin: "IE00B4ND3602",
          exchange: null,
          type: "ETF",
          fractionalSupported: null,
          minOrderQuantity: null,
          minOrderValue: null,
          confirmedAt: "2026-07-23T20:00:00.000Z",
          confirmedBy: "owner",
          environment: "PRACTICE"
        },
        holdingQuantity: null,
        lastHeartbeatAt: null,
        connectionState: "Connected",
        ordersEnabled: false,
        paperOrderSubmissionEnabled: false,
        liveExecutionFeatureEnabled: false
      },
      t212RiskLimits: {
        ...baseStatus.t212RiskLimits,
        maxOrderValue: 50,
        currency: "EUR"
      }
    };
    api.autoTradeStatus.mockResolvedValue(t212Status);

    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("autotrade-t212-instrument")).toHaveTextContent(/EGLNl_EQ/)
    );
    expect(screen.getByTestId("autotrade-t212-instrument")).toHaveTextContent(
      /iShares Physical Gold/
    );
    expect(screen.getByTestId("autotrade-t212-instrument-currency")).toHaveTextContent("EUR");
    expect(screen.getByTestId("autotrade-t212-instrument-isin")).toHaveTextContent("IE00B4ND3602");
    expect(screen.getByTestId("autotrade-t212-instrument-type")).toHaveTextContent("ETF");
    expect(screen.getByTestId("autotrade-broker-badge")).toHaveTextContent(/T212 PRACTICE/i);
    expect(screen.getByTestId("autotrade-mode-pill")).toHaveTextContent("OFF");
    expect(screen.getByTestId("autotrade-t212-min-size-warning")).toHaveTextContent(
      /Minimum\/fractional eligibility not yet verified/i
    );
    expect(screen.getByTestId("autotrade-t212-min-size-warning")).toHaveTextContent(
      /No orders will be submitted/i
    );
    expect(screen.getByTestId("autotrade-t212-min-size-warning")).toHaveTextContent(
      /economic USD gold exposure/i
    );
    expect(screen.getByTestId("autotrade-t212-practice-limitations")).toHaveTextContent(
      /Practice — Read Only/i
    );
    expect(screen.getByTestId("autotrade-t212-practice-limitations")).toHaveTextContent(
      /Long-only/i
    );
    expect(screen.getByTestId("autotrade-t212-disclaimer")).toHaveTextContent(
      /not direct XAUUSD trading/i
    );
    expect(screen.getByTestId("autotrade-emergency-stop")).toBeInTheDocument();
  });
});
