import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AutoTradePage } from "./AutoTradePage";
import { buildReviewAutoTradeStatus } from "../lib/autoTradeTypes";
import "../styles/redesign.css";

const status = buildReviewAutoTradeStatus();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      autoTradeStatus: vi.fn(async () => status),
      autoTradeSetMode: vi.fn(async (mode: string) => ({
        ...status,
        mode,
        displayStatus: mode === "SHADOW" ? "SHADOW" : "OFF"
      })),
      autoTradeConnect: vi.fn(async () => ({
        ...status,
        connection: { ...status.connection, connected: true, accountIdMasked: "****1234" }
      })),
      autoTradeEmergencyStop: vi.fn(async () => ({
        ...status,
        displayStatus: "LOCKED",
        locked: true,
        mode: "OFF",
        emergencyStopActive: true,
        lockReason: "emergency_stop"
      })),
      autoTradeUnlock: vi.fn(async () => status),
      autoTradeUpdateLimits: vi.fn(async () => status)
    }
  })
}));

describe("AutoTradePage", () => {
  it("renders control centre with OFF status and emergency STOP", async () => {
    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("autotrade-page")).toBeInTheDocument());
    expect(screen.getByTestId("autotrade-mode-pill")).toHaveTextContent("OFF");
    expect(screen.getByTestId("autotrade-emergency-stop")).toBeInTheDocument();
    expect(screen.getByTestId("autotrade-live-activation")).toBeInTheDocument();
    expect(screen.getByText(/Remaining daily/i)).toBeInTheDocument();
  });

  it("keeps live enable disabled until confirmation phrase", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("autotrade-enable-live")).toBeDisabled());
    await user.type(screen.getByTestId("autotrade-live-phrase"), "ENABLE LIVE AUTOTRADE");
    await user.click(screen.getByTestId("autotrade-live-risk-ack"));
    await user.click(screen.getByTestId("autotrade-live-account-ack"));
    await user.click(screen.getByTestId("autotrade-live-second-confirm"));
    expect(screen.getByTestId("autotrade-enable-live")).not.toBeDisabled();
  });
});
