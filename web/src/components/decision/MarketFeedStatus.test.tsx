import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MarketFeedHealth } from "../../types/models";
import { MarketFeedStatus } from "./MarketFeedStatus";

function health(
  status: MarketFeedHealth["status"],
  quoteStatus: MarketFeedHealth["quoteStatus"]
): MarketFeedHealth {
  return {
    status,
    title: "ignored-api-title",
    subtitle: "ignored-api-subtitle",
    quoteStatus,
    lastVerifiedAt: new Date(Date.now() - 30_000).toISOString(),
    lastVerifiedLabel: "Plan + 5M confirmation"
  };
}

describe("MarketFeedStatus", () => {
  it("shows compact green feed status", async () => {
    const user = userEvent.setup();
    render(<MarketFeedStatus health={health("green", "live")} />);
    expect(screen.getByTestId("market-feed-status")).toHaveAttribute("data-status", "green");
    expect(screen.getByText(/Market feed: Operational/i)).toBeInTheDocument();
    expect(screen.getByText(/Live quotes/i)).toBeInTheDocument();
    await user.click(screen.getByText(/Details/i));
    expect(screen.getByTestId("market-feed-last-verified")).toHaveTextContent(/Last verified:/i);
  });

  it("shows amber feed as Limited", () => {
    render(<MarketFeedStatus health={health("amber", "limited")} />);
    expect(screen.getByTestId("market-feed-status")).toHaveAttribute("data-status", "amber");
    expect(screen.getByText(/Market feed: Limited/i)).toBeInTheDocument();
    expect(screen.getByText(/Quotes limited/i)).toBeInTheDocument();
  });

  it("shows red feed as Unavailable", () => {
    render(<MarketFeedStatus health={health("red", "unknown")} />);
    expect(screen.getByTestId("market-feed-status")).toHaveAttribute("data-status", "red");
    expect(screen.getByText(/Market feed: Unavailable/i)).toBeInTheDocument();
  });
});
