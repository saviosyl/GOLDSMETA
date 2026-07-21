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

  it("renders diagnostics when authenticated", async () => {
    adminDiagnostics.mockResolvedValue({
      apiHealth: "ok",
      backendVersion: "1.2.0-phase3",
      ruleConfigVersion: "rules-1.1.0",
      setupRuleConfigVersion: "setup-rules-1.0.0",
      pineVersionLastReceived: "2.0.4",
      flags: {},
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
    expect(screen.queryByText(/secret/i)).not.toHaveTextContent(/whsec|sk_/);
  });

  it("shows access error when API rejects", async () => {
    adminDiagnostics.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "Sign in required"));
    render(
      <MemoryRouter>
        <DiagnosticsPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("diagnostics-error")).toBeInTheDocument();
  });
});
