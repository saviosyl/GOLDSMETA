import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MarketFeedHealth } from "../../types/models";
import { MarketFeedStatus } from "./MarketFeedStatus";

function health(status: MarketFeedHealth["status"], quoteStatus: MarketFeedHealth["quoteStatus"]): MarketFeedHealth {
  return {
    status,
    title: "GoldMeta Market Feed",
    subtitle: status === "green" ? "All systems operational" : "Partial",
    quoteStatus,
    lastVerifiedAt: "2026-08-06T06:00:00.000Z",
    lastVerifiedLabel: "30 seconds ago"
  };
}

describe("MarketFeedStatus", () => {
  it("shows green feed with live quote text", () => {
    render(<MarketFeedStatus health={health("green", "live")} />);
    expect(screen.getByTestId("market-feed-status")).toHaveAttribute("data-status", "green");
    expect(screen.getByText(/GoldMeta Market Feed/i)).toBeInTheDocument();
    expect(screen.getByText(/Live price updates active/i)).toBeInTheDocument();
  });

  it("shows amber feed with partial availability text", () => {
    render(<MarketFeedStatus health={health("amber", "limited")} />);
    expect(screen.getByTestId("market-feed-status")).toHaveAttribute("data-status", "amber");
    expect(screen.getByText(/Market feed partially available/i)).toBeInTheDocument();
    expect(screen.getByText(/Live quote updates limited/i)).toBeInTheDocument();
  });

  it("shows red feed with unavailable text", () => {
    render(<MarketFeedStatus health={health("red", "unknown")} />);
    expect(screen.getByTestId("market-feed-status")).toHaveAttribute("data-status", "red");
    expect(screen.getByText(/Market feed unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Quote status unknown/i)).toBeInTheDocument();
  });
});
