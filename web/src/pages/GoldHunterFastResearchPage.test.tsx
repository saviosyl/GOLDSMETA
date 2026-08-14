/**
 * GOLD HUNTER FAST research monitor — smoke + safety labels.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GoldHunterFastResearchPage } from "./GoldHunterFastResearchPage";

const health = {
  captureHealthy: true,
  campaignValid: true,
  dataIntegrityStatus: "CLEAN",
  connectionState: "CONNECTED",
  spotSubscribed: true,
  depthSubscribed: true,
  spotAgeMs: 120,
  depthAgeMs: 118,
  eventsReceived: 1824,
  eventsDropped: 0,
  observationA: 400,
  observationB: 120,
  observationC: 10,
  eligibleA: 193,
  eligibleB: 45,
  eligibleC: 0,
  selectedA: 12,
  selectedB: 3,
  selectedC: 0,
  lastBid: 4373.88,
  lastAsk: 4373.97,
  lastSpread: 0.09,
  marketDataNormalizationVersion: "CTRADER_NORMALIZED_V1",
  inputNormalizationVerified: true,
  heartbeatsPersisted: 400,
  chunksWritten: 3,
  chunksUploaded: 3,
  persistenceDroppedRows: 0,
  persistenceDroppedChunks: 0,
  captureDayIndex: 1,
  validatedIndependentDays: 0,
  captureDurationMs: 120000,
  permissionScope: "SCOPE_VIEW",
  executionAdapter: "NONE",
  mutationSurface: "NONE",
  brokerRequests: 0,
  brokerOrders: 0,
  shadowOrders: 0,
  durableMode: "GCS",
  scopeVerified: true
};

describe("GoldHunterFastResearchPage", () => {
  const original = import.meta.env.VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL;

  beforeEach(() => {
    (
      import.meta.env as { VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL?: string }
    ).VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL =
      "https://research.example/health";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/recent-candidates")) {
          return {
            ok: true,
            json: async () => ({
              observations: [
                {
                  observationId: 1,
                  label: "RESEARCH OBSERVATION — NOT A TRADE",
                  kind: "A_CANDIDATE",
                  setup: "A_MOMENTUM_IGNITION",
                  setupName: "A MOMENTUM IGNITION",
                  side: "BUY",
                  eligible: true,
                  rawQuality: 0.82,
                  selectedCandidate: false,
                  tsIso: "2026-08-14T12:00:00.000Z",
                  bid: 4373.88,
                  ask: 4373.97,
                  spread: 0.09,
                  imbalance: 0.2,
                  velocity1s: 0.01,
                  acceleration: 0.001
                }
              ]
            })
          };
        }
        if (u.includes("/reference-paper")) {
          return {
            ok: true,
            json: async () => ({
              mode: "REFERENCE_PAPER_ONLY",
              label: "REFERENCE PAPER P/L — HYPOTHETICAL, NOT A BROKER TRADE",
              summary: {
                paperTrades: 0,
                open: 0,
                wins: 0,
                losses: 0,
                breakeven: 0,
                winRate: null,
                profitFactor: null,
                grossMoveSum: 0,
                frictionSum: 0,
                netMoveSum: 0,
                currentStreak: 0,
                streakKind: "NONE",
                tradesPerHour: null,
                brokerRequests: 0,
                brokerOrders: 0,
                executionAdapter: "NONE"
              },
              openTrade: null,
              history: []
            })
          };
        }
        return { ok: true, json: async () => health };
      })
    );
  });

  afterEach(() => {
    (
      import.meta.env as { VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL?: string }
    ).VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL = original;
    vi.unstubAllGlobals();
  });

  it("renders compact research monitor with normalized market + eligible counters", async () => {
    render(
      <MemoryRouter>
        <GoldHunterFastResearchPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("gh-research-brand")).toHaveTextContent(
      "GOLD HUNTER FAST"
    );
    await waitFor(() => {
      expect(screen.getByTestId("gh-research-market")).toHaveTextContent(
        "4373.88"
      );
    });
    expect(screen.getByTestId("gh-research-market")).toHaveTextContent("0.09");
    expect(screen.getByTestId("gh-research-market")).toHaveTextContent("SPOT");
    expect(screen.getByTestId("gh-research-activity")).toHaveTextContent(
      "1,824"
    );
    expect(screen.getByTestId("gh-research-activity")).toHaveTextContent("193");
    expect(screen.getByTestId("gh-research-activity")).toHaveTextContent(
      "A ELIGIBLE"
    );
    expect(screen.getByTestId("gh-research-activity")).toHaveTextContent(
      "SELECTED SIGNAL EVENTS"
    );
    expect(screen.queryByText("SELECTED OPPORTUNITIES")).toBeNull();
    expect(screen.getByTestId("gh-research-paper")).toHaveTextContent(
      "REFERENCE PAPER TRADES"
    );
    expect(screen.getByTestId("gh-research-paper-eur-label")).toHaveTextContent(
      "HYPOTHETICAL PAPER ACCOUNT"
    );
    expect(screen.getByTestId("gh-research-paper-eur-label")).toHaveTextContent(
      "NOT A BROKER ACCOUNT P/L"
    );
    expect(screen.getByTestId("gh-research-paper-account")).toHaveTextContent(
      "PAPER ACCOUNT"
    );
    expect(screen.getByTestId("gh-research-paper-account")).toHaveTextContent(
      "CURRENT BALANCE"
    );
    expect(screen.getByTestId("gh-research-paper-summary")).toHaveTextContent(
      "Paper trades"
    );
    expect(screen.getByTestId("gh-research-candidate-feed")).toHaveTextContent(
      "RESEARCH OBSERVATION — NOT A TRADE"
    );
    expect(screen.getByTestId("gh-research-safety")).toHaveTextContent(
      "SCOPE_VIEW"
    );
    expect(screen.queryByText(/\bWIN\b|\bLOSS\b/)).toBeNull();
  });
});
