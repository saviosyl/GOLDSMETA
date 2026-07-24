import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { T212InvestPanel } from "./T212InvestPanel";
import type { ApiClient } from "../../lib/api";

describe("T212InvestPanel", () => {
  it("hides owner broker data from non-owners", () => {
    const api = {
      t212InvestPortfolio: vi.fn(),
      t212InvestPaper: vi.fn(),
      t212InvestWatchlist: vi.fn()
    } as unknown as ApiClient;
    render(
      <MemoryRouter>
        <T212InvestPanel api={api} isOwner={false} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("t212-broker-panel")).toHaveTextContent(/Owner broker data is private/i);
    expect(vi.mocked(api.t212InvestPortfolio)).not.toHaveBeenCalled();
  });

  it("loads read-only portfolio for owner and shows paper disclaimer", async () => {
    const api = {
      t212InvestPortfolio: vi.fn().mockResolvedValue({
        portfolio: {
          connectionStatus: "CREDENTIALS_MISSING",
          accountType: "GENERAL_INVEST",
          accountIdMasked: null,
          positions: [],
          lastSyncAt: "2026-07-24T00:00:00.000Z",
          autoTrade: "OFF",
          ordersEnabled: false
        }
      }),
      t212InvestPaper: vi.fn().mockResolvedValue({
        paper: {
          cash: 10000,
          equity: 10000,
          positions: [],
          disclaimer: "Paper preview only — no Trading 212 order will be submitted.",
          autoTrade: "OFF"
        }
      }),
      t212InvestWatchlist: vi.fn().mockResolvedValue({ items: [] })
    } as unknown as ApiClient;
    render(
      <MemoryRouter>
        <T212InvestPanel api={api} isOwner={true} />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("t212-autotrade-off")).toBeInTheDocument();
    expect(screen.getByTestId("t212-paper-disclaimer")).toHaveTextContent(/Paper preview only/i);
    expect(screen.getByTestId("t212-no-orders")).toBeInTheDocument();
  });
});
