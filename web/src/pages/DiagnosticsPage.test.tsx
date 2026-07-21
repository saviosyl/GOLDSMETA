import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { DiagnosticsPage } from "./DiagnosticsPage";
import { ApiError } from "../types/models";

const adminDiagnostics = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: { adminDiagnostics }
  })
}));

describe("DiagnosticsPage", () => {
  beforeEach(() => {
    adminDiagnostics.mockReset();
  });

  it("renders server feature flags without hard-coding environments", async () => {
    adminDiagnostics.mockResolvedValue({
      apiHealth: "ok",
      backendVersion: "1.2.0-phase3",
      ruleConfigVersion: "rules-1.1.0",
      setupRuleConfigVersion: "setup-rules-1.0.0",
      pineVersionLastReceived: "2.0.4",
      flags: {
        setupTrackingEnabled: true,
        setupTrackingEnvironments: ["TEST"],
        brokerMode: "DISABLED",
        aiEnabled: false
      },
      webhookConnections: [],
      latestDecision: null,
      latestSetupTransition: null,
      recentRejects: [],
      igDemoPlan: {},
      mockBrokerReady: "mock-demo"
    });
    render(
      <MemoryRouter>
        <DiagnosticsPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("diagnostics-page")).toBeInTheDocument();
    expect(screen.getByText("1.2.0-phase3")).toBeInTheDocument();
    expect(screen.getByTestId("flag-setup-tracking-environments")).toHaveTextContent('["TEST"]');
    expect(screen.getByTestId("flag-broker-mode")).toHaveTextContent("DISABLED");
    expect(screen.getByTestId("flag-ai-enabled")).toHaveTextContent("disabled");
    expect(screen.getByTestId("flag-setup-tracking-enabled")).toHaveTextContent("enabled");
  });

  it("shows access-denied state on 403", async () => {
    adminDiagnostics.mockRejectedValue(new ApiError(403, "FORBIDDEN", "Admin access required"));
    render(
      <MemoryRouter>
        <DiagnosticsPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("diagnostics-forbidden")).toBeInTheDocument();
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
  });

  it("shows access error when API rejects unauthenticated", async () => {
    adminDiagnostics.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "Sign in required"));
    render(
      <MemoryRouter>
        <DiagnosticsPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("diagnostics-error")).toBeInTheDocument();
  });
});
