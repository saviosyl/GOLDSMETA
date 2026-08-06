import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuoteHeader } from "./QuoteHeader";

describe("QuoteHeader", () => {
  it("shows mid price, freshness, and bid/ask without redesigning layout", () => {
    render(
      <QuoteHeader
        price={4265.31}
        updatedLabel="12:30:42"
        sessionLabel="London"
        freshness="LIVE"
        fresh
        bid={4264.66}
        ask={4265.43}
      />
    );
    expect(screen.getByTestId("shell-live-price").textContent).toMatch(/4,?265/);
    expect(screen.getByTestId("shell-quote-freshness").textContent).toBe("Live");
    expect(screen.getByTestId("shell-quote-updated").textContent).toContain("12:30:42");
    expect(screen.getByTestId("shell-bid-ask").textContent).toMatch(/Bid/);
    expect(screen.getByTestId("shell-bid-ask").textContent).toMatch(/Ask/);
  });

  it("shows Price unavailable when no verified quote exists", () => {
    render(
      <QuoteHeader
        price={null}
        updatedLabel="—"
        freshness="UNAVAILABLE"
        unavailable
      />
    );
    expect(screen.getByTestId("shell-live-price").textContent).toBe("Price unavailable");
  });

  it("labels delayed and stale states", () => {
    const { rerender } = render(
      <QuoteHeader price={4265} updatedLabel="12:31:00" freshness="DELAYED" />
    );
    expect(screen.getByTestId("shell-quote-freshness").textContent).toBe("Delayed");
    rerender(<QuoteHeader price={4265} updatedLabel="12:32:00" freshness="STALE" />);
    expect(screen.getByTestId("shell-quote-freshness").textContent).toBe("Stale");
    rerender(
      <QuoteHeader price={4265} updatedLabel="12:33:00" freshness="MARKET_CLOSED" />
    );
    expect(screen.getByTestId("shell-quote-freshness").textContent).toBe("Market closed");
  });
});
