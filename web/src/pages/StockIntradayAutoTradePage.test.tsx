import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StockIntradayAutoTradePage } from "./StockIntradayAutoTradePage";
import { buildReviewStockIntradayStatus } from "../lib/stockIntradayTypes";
import "../styles/redesign.css";

const status = buildReviewStockIntradayStatus();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      stockIntradayStatus: vi.fn(async () => status),
      stockIntradaySetMode: vi.fn(async (mode: string) => ({ ...status, mode })),
      stockIntradayConnectPaper: vi.fn(async () => status),
      stockIntradayDisconnect: vi.fn(async () => status),
      stockIntradayEmergencyStop: vi.fn(async () => ({
        ...status,
        displayStatus: "LOCKED",
        locked: true,
        killSwitchActive: true
      })),
      stockIntradayUnlock: vi.fn(async () => status),
      stockIntradayShadowScan: vi.fn(async () => status),
      stockIntradayUpdateWatchlist: vi.fn(async () => status)
    }
  })
}));

describe("StockIntradayAutoTradePage", () => {
  it("renders stocks intraday control centre with safety statement", async () => {
    render(
      <MemoryRouter>
        <StockIntradayAutoTradePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("stock-intraday-page")).toBeInTheDocument());
    expect(screen.getByTestId("stock-intraday-mode-pill")).toHaveTextContent("OFF");
    expect(screen.getByTestId("stock-intraday-safety")).toHaveTextContent(/qualifying opportunities/i);
    expect(screen.getByTestId("stock-intraday-emergency-stop")).toBeInTheDocument();
    expect(screen.getByTestId("stock-intraday-mode-T212_LIVE_AUTO")).toBeDisabled();
    expect(screen.getByTestId("stock-intraday-shadow-performance")).toBeInTheDocument();
    expect(screen.getByTestId("stock-intraday-shadow-performance")).toHaveTextContent(
      /do not guarantee future performance/i
    );
  });
});
