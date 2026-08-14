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
  candidateA: 193,
  candidateB: 45,
  candidateC: 0,
  heartbeatsPersisted: 400,
  chunksWritten: 3,
  chunksUploaded: 3,
  persistenceDroppedRows: 0,
  persistenceDroppedChunks: 0,
  queueLatencyP50: 1,
  queueLatencyP95: 2,
  queueLatencyP99: 3,
  eventLoopLagP50: 1,
  eventLoopLagP95: 2,
  eventLoopLagP99: 2,
  feedGapCount: 0,
  reconnectCount: 0,
  resyncCount: 0,
  bookCrossedCount: 0,
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
    (import.meta.env as { VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL?: string }).VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL =
      "https://research.example/health";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/recent-candidates")) {
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
                  selectedCandidate: true,
                  tsIso: "2026-08-14T12:00:00.000Z",
                  bid: 2400.1,
                  ask: 2400.2,
                  spread: 0.1,
                  imbalance: 0.2,
                  velocity1s: 0.01,
                  acceleration: 0.001,
                  distHigh5s: 0.4,
                  distLow5s: 0.2,
                  upTouches5s: 1,
                  downTouches5s: 0
                }
              ]
            })
          };
        }
        return { ok: true, json: async () => health };
      })
    );
  });

  afterEach(() => {
    (import.meta.env as { VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL?: string }).VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL =
      original;
    vi.unstubAllGlobals();
  });

  it("renders live research monitor with safety + observation feed", async () => {
    render(
      <MemoryRouter>
        <GoldHunterFastResearchPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("gh-research-brand")).toHaveTextContent(
      "GOLD HUNTER FAST"
    );
    expect(screen.getByText("LIVE RESEARCH — OBSERVATION ONLY")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("gh-research-activity")).toHaveTextContent(
        "1,824"
      );
    });
    expect(screen.getByTestId("gh-research-activity")).toHaveTextContent("193");
    expect(screen.getByTestId("gh-research-activity")).toHaveTextContent("45");
    expect(screen.getByTestId("gh-research-safety")).toHaveTextContent(
      "SCOPE_VIEW"
    );
    expect(screen.getByTestId("gh-research-safety")).toHaveTextContent("NONE");
    expect(screen.getByTestId("gh-research-candidate-feed")).toHaveTextContent(
      "RESEARCH OBSERVATION — NOT A TRADE"
    );
    expect(screen.getByTestId("gh-research-candidate-feed")).toHaveTextContent(
      "A CANDIDATE"
    );
    expect(screen.queryByText(/\bWIN\b|\bLOSS\b/)).toBeNull();
    expect(screen.queryByTestId("gh-research-unsafe")).toBeNull();
  });
});
