import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { SetupDetailPage } from "./SetupDetailPage";
import type { SetupRecord } from "../types/models";

const getSetup = vi.fn();
const getDecision = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: { getSetup, getDecision }
  })
}));

const setup: SetupRecord = {
  setupId: "setup-abc",
  decisionId: "dec-1",
  symbol: "XAUUSD",
  timeframe: "15",
  direction: "BUY",
  environment: "TEST",
  isTestSetup: true,
  createdAt: "2026-07-20T10:01:00.000Z",
  barTime: "2026-07-20T10:00:00.000Z",
  session: "LONDON",
  levels: {
    entryPrice: 2645,
    entryType: "LIMIT",
    stopLoss: 2640,
    tp1: 2652,
    tp2: 2658,
    tp3: 2665
  },
  initialRisk: 5,
  expectedRR: { tp1: 1.4, tp2: 2.6, tp3: 4 },
  confidence: 72,
  status: "CLOSED",
  statusHistory: [
    {
      at: "2026-07-20T10:01:00.000Z",
      from: "SIGNAL_CREATED",
      to: "WAITING_FOR_ENTRY",
      barTime: "2026-07-20T10:00:00.000Z",
      eventId: null,
      reason: "Awaiting entry"
    },
    {
      at: "2026-07-20T10:15:00.000Z",
      from: "WAITING_FOR_ENTRY",
      to: "ENTRY_TRIGGERED",
      barTime: "2026-07-20T10:15:00.000Z",
      eventId: "evt-1",
      reason: "Entry level reached"
    }
  ],
  entryTriggeredAt: "2026-07-20T10:15:00.000Z",
  resolvedAt: "2026-07-20T11:00:00.000Z",
  resolution: "WIN_TP3",
  barsToEntry: 1,
  barsToResolution: 4,
  barsOpen: 4,
  excursion: { mfe: 4, mae: 0.4, highestPriceSeen: 2665, lowestPriceSeen: 2643 },
  outcome: {
    rawResolution: "WIN_TP3",
    rawRealisedR: 4,
    modelledResolution: "WIN_TP3",
    modelledRealisedR: 2.7,
    managementNotes: ["Model: 50% at TP1"]
  },
  ruleConfigVersion: "setup-rules-1.0.0",
  pineScriptVersion: "2.0.4",
  backendVersion: "1.2.0-phase3",
  updatedAt: "2026-07-20T11:00:00.000Z"
};

describe("SetupDetailPage", () => {
  beforeEach(() => {
    getSetup.mockReset();
    getDecision.mockReset();
    getSetup.mockResolvedValue(setup);
    getDecision.mockResolvedValue(null);
  });

  it("renders lifecycle timeline and outcomes", async () => {
    render(
      <MemoryRouter initialEntries={["/setups/setup-abc"]}>
        <Routes>
          <Route path="/setups/:setupId" element={<SetupDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByTestId("setup-timeline")).toBeInTheDocument();
    expect(screen.getByText("ENTRY TRIGGERED")).toBeInTheDocument();
    expect(screen.getByTestId("setup-outcomes")).toHaveTextContent("WIN_TP3");
    expect(screen.getByTestId("setup-outcomes")).toHaveTextContent("4R");
    expect(screen.getByText(/Model: 50% at TP1/)).toBeInTheDocument();
  });
});
