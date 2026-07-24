import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrokerControlCentrePage } from "./BrokerControlCentrePage";
import "../../styles/redesign.css";

const getBrokerControlCentre = vi.fn();
const getCTraderDemonstration = vi.fn();
const startCTraderOAuth = vi.fn();

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    api: {
      getBrokerControlCentre,
      getCTraderDemonstration,
      startCTraderOAuth
    }
  })
}));

const centreFixture = {
  defaultBroker: "manual",
  autoTrade: "OFF",
  orderSubmissionEnabled: false,
  brokers: [
    {
      id: "manual",
      name: "MANUAL",
      status: "Available",
      detail: "No broker execution",
      badge: "MANUAL"
    },
    {
      id: "trading212_invest",
      name: "TRADING 212 INVEST",
      status: "Practice Read Only",
      detail: "Long-only gold ETF proxy",
      badge: "READ_ONLY"
    },
    {
      id: "pepperstone_ctrader",
      name: "PEPPERSTONE cTRADER CFD",
      status: "Auth Setup Required",
      detail: "Demo Preview",
      badge: "DEMO_PREVIEW"
    },
    {
      id: "ig",
      name: "IG",
      status: "Parked",
      detail: "Not active",
      badge: "PARKED"
    }
  ],
  automationModes: [],
  readiness: {
    setupRequired: true,
    authSetupRequired: true,
    oauthConfigured: false,
    connected: false,
    demonstrationAvailable: true,
    automationMode: "OFF",
    autoTrade: "OFF",
    orderSubmissionEnabled: false,
    liveEnabled: false,
    wizardSteps: [
      {
        step: 1,
        title: "Create Pepperstone cTrader Demo account",
        status: "AVAILABLE",
        detail: "Explain"
      },
      {
        step: 3,
        title: "Connect cTrader ID (OAuth)",
        status: "BLOCKED",
        detail: "AUTH SETUP REQUIRED"
      }
    ],
    label: "CTRADER_SETUP_REQUIRED",
    auth: {
      status: "NOT_HEALTHY",
      brokerSetupEnabled: false,
      notes: ["AUTH SETUP REQUIRED"]
    },
    qualification: {
      unlocked: false,
      canActivate: false,
      failed: ["AUTH_HEALTHY", "OAUTH_HEALTHY"],
      progress: {
        completedPreviews: 0,
        requiredPreviews: 20,
        approvedControlledDemoTrades: 0,
        requiredTrades: 5,
        daysSinceFirstTrade: null,
        requiredDays: 7
      }
    }
  }
};

describe("BrokerControlCentrePage", () => {
  beforeEach(() => {
    getBrokerControlCentre.mockReset();
    getCTraderDemonstration.mockReset();
    startCTraderOAuth.mockReset();
    getBrokerControlCentre.mockResolvedValue(centreFixture);
  });

  it("renders broker options with AutoTrade OFF and no-order badges", async () => {
    render(
      <MemoryRouter>
        <BrokerControlCentrePage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId("broker-control-centre")).toBeInTheDocument();
    });
    expect(screen.getByTestId("autotrade-off-badge")).toHaveTextContent("AUTO TRADE OFF");
    expect(screen.getByTestId("no-order-badge")).toHaveTextContent("NO ORDER SUBMISSION");
    expect(screen.getByTestId("broker-card-pepperstone_ctrader")).toBeInTheDocument();
  });

  it("shows AUTH SETUP REQUIRED and disables connect for cTrader", async () => {
    render(
      <MemoryRouter>
        <BrokerControlCentrePage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByTestId("broker-card-pepperstone_ctrader"));
    fireEvent.click(screen.getByTestId("broker-card-pepperstone_ctrader"));
    expect(await screen.findByTestId("ctrader-setup-panel")).toBeInTheDocument();
    expect(await screen.findByTestId("auth-setup-required")).toBeInTheDocument();
    expect(screen.getByTestId("ctrader-connect-btn")).toBeDisabled();
  });

  it("loads labelled demonstration data", async () => {
    getCTraderDemonstration.mockResolvedValue({
      banner: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED",
      notice: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED",
      autoTrade: "OFF",
      orderSubmissionEnabled: false,
      account: {
        accountIdMasked: "DE…01",
        currency: "EUR",
        balance: 10000,
        equity: 10000,
        freeMargin: 9500,
        leverage: 100,
        brokerName: "Pepperstone",
        brokerNameSource: "USER_CONFIRMED"
      },
      symbol: {
        symbolName: "XAUUSD",
        baseAsset: "XAU",
        quoteAsset: "USD",
        minVolume: 0.01,
        volumeStep: 0.01,
        lotSize: 100,
        metadataComplete: true
      },
      quote: {
        bid: 2350,
        ask: 2350.3,
        spread: 0.3,
        marketStatus: "OPEN",
        source: "FIXTURE"
      },
      buyPreview: {
        state: "READY_FOR_CONFIRMATION",
        action: "BUY",
        proposedVolume: 0.02,
        riskAmount: 20,
        failedGates: [],
        passedGates: ["ACTION_BUY"],
        label: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED"
      },
      sellPreview: {
        state: "READY_FOR_CONFIRMATION",
        action: "SELL",
        proposedVolume: 0.02,
        label: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED"
      },
      blockedPreview: {
        state: "BLOCKED",
        failedGates: ["CONFIDENCE_TOO_LOW"],
        label: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED"
      }
    });
    render(
      <MemoryRouter>
        <BrokerControlCentrePage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByTestId("broker-card-pepperstone_ctrader"));
    fireEvent.click(screen.getByTestId("broker-card-pepperstone_ctrader"));
    fireEvent.click(screen.getByTestId("ctrader-demo-btn"));
    expect(await screen.findByTestId("ctrader-demonstration")).toHaveTextContent(
      "DEMONSTRATION DATA"
    );
  });
});
