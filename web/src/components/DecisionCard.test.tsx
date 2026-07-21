import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { DecisionCard } from "../components/DecisionCard";
import type { Decision, SetupRecord } from "../types/models";
import buy from "../fixtures/buy.json";
import sell from "../fixtures/sell.json";
import wait from "../fixtures/wait.json";

const activeSetup: SetupRecord = {
  setupId: "setup-1",
  decisionId: "gm-web-buy",
  symbol: "XAUUSD",
  timeframe: "15",
  direction: "BUY",
  environment: "TEST",
  isTestSetup: true,
  createdAt: "2026-07-20T10:01:00.000Z",
  barTime: "2026-07-20T10:00:00.000Z",
  session: "LONDON",
  levels: {
    entryPrice: 2421,
    entryType: "MARKET",
    stopLoss: 2416.75,
    tp1: 2430,
    tp2: 2440,
    tp3: 2455
  },
  initialRisk: 4.25,
  expectedRR: { tp1: 2.12, tp2: 4.47, tp3: 8 },
  confidence: 80,
  status: "WAITING_FOR_ENTRY",
  statusHistory: [],
  entryTriggeredAt: null,
  resolvedAt: null,
  resolution: "OPEN",
  barsToEntry: null,
  barsToResolution: null,
  barsOpen: 2,
  excursion: { mfe: null, mae: null, highestPriceSeen: null, lowestPriceSeen: null },
  outcome: {
    rawResolution: "OPEN",
    rawRealisedR: null,
    modelledResolution: "OPEN",
    modelledRealisedR: null,
    managementNotes: []
  },
  ruleConfigVersion: "setup-rules-1.0.0",
  pineScriptVersion: "2.0.4",
  backendVersion: "1.2.0-phase3",
  updatedAt: "2026-07-20T10:01:00.000Z"
};

describe("DecisionCard", () => {
  it("renders BUY with a single TEST badge for genuine test decisions", () => {
    render(
      <MemoryRouter>
        <DecisionCard decision={buy as Decision} />
      </MemoryRouter>
    );
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getAllByTestId("test-badge")).toHaveLength(1);
    expect(screen.getByTestId("quality-badge")).toHaveTextContent("LIVE");
    expect(screen.getByTestId("quality-badge")).not.toHaveTextContent("TEST");
    expect(screen.getByText("2421.00")).toBeInTheDocument();
    expect(screen.getByText("Trend Meter bullish 80")).toBeInTheDocument();
  });

  it("does not show TEST for live production decisions", () => {
    const liveBuy = {
      ...(buy as Decision),
      isTestDecision: false,
      environment: "LIVE" as const,
      dataSourceLabel: "LIVE" as const
    };
    render(
      <MemoryRouter>
        <DecisionCard decision={liveBuy} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("test-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("live-badge")).toBeInTheDocument();
    expect(screen.getByTestId("quality-badge")).toHaveTextContent("LIVE");
  });

  it("renders active setup status and expiry countdown", () => {
    render(
      <MemoryRouter>
        <DecisionCard decision={buy as Decision} setup={activeSetup} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("setup-status")).toBeInTheDocument();
    expect(screen.getByText("WAITING FOR ENTRY")).toBeInTheDocument();
    expect(screen.getByText("6 bars left")).toBeInTheDocument();
  });

  it("renders result label when setup resolved", () => {
    const closed: SetupRecord = {
      ...activeSetup,
      status: "CLOSED",
      resolution: "WIN_TP2",
      outcome: {
        rawResolution: "WIN_TP2",
        rawRealisedR: 2.5,
        modelledResolution: "WIN_TP2",
        modelledRealisedR: 2.1,
        managementNotes: []
      }
    };
    render(
      <MemoryRouter>
        <DecisionCard decision={buy as Decision} setup={closed} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("setup-outcome")).toHaveTextContent("WIN_TP2");
    expect(screen.getByTestId("setup-outcome")).toHaveTextContent("2.5R");
  });

  it("renders SELL state", () => {
    render(
      <MemoryRouter>
        <DecisionCard decision={sell as Decision} />
      </MemoryRouter>
    );
    expect(screen.getByText("SELL")).toBeInTheDocument();
    expect(screen.getAllByText("Trend Meter bearish 86").length).toBeGreaterThan(0);
  });

  it("renders WAIT plan placeholders and stale action copy", () => {
    render(
      <MemoryRouter>
        <DecisionCard decision={wait as Decision} />
      </MemoryRouter>
    );
    expect(screen.getByText("WAIT")).toBeInTheDocument();
    expect(screen.getByTestId("stale-banner")).toBeInTheDocument();
    expect(screen.getByTestId("action-label")).toHaveTextContent("Wait for fresh market data");
    expect(screen.getByTestId("plan-entry")).toHaveTextContent("Wait");
    expect(screen.getByTestId("plan-stop")).toHaveTextContent("Not applicable");
    expect(screen.getByTestId("plan-tp1")).toHaveTextContent("Not applicable");
    expect(screen.getByTestId("plan-tp2")).toHaveTextContent("Not applicable");
    expect(screen.getByTestId("plan-tp3")).toHaveTextContent("Not applicable");
    expect(screen.getByTestId("plan-rr")).toHaveTextContent("Not applicable");
  });

  it("renders WAIT and offline warning", () => {
    render(
      <MemoryRouter>
        <DecisionCard
          decision={wait as Decision}
          source="offline"
          cachedAt="2026-07-20T09:00:00.000Z"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("WAIT")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
  });
});
