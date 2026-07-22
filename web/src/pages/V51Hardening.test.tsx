import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import { GoldMetaScoreCard } from "../components/v5/GoldMetaScoreCard";
import { VerifiedDataMeta } from "../components/v5/VerifiedDataMeta";
import { UpdateBanner } from "../components/UpdateBanner";
import cssText from "../styles/global.css?raw";

function Boom(): never {
  throw new Error("boom");
}

describe("V5.1 UI hardening", () => {
  it("route error boundary shows retry", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <RouteErrorBoundary label="Intelligence">
        <Boom />
      </RouteErrorBoundary>
    );
    expect(await screen.findByTestId("route-error-boundary")).toHaveTextContent(
      /Something went wrong/i
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("GoldMeta Score disclaimer is not win probability", () => {
    render(
      <GoldMetaScoreCard
        total={72}
        components={[
          {
            label: "Trend",
            score: 8,
            max: 12,
            reason: "Trend alignment not fully verified — partial credit only."
          }
        ]}
        disclaimer="GoldMeta Score is a rules-based setup-quality measurement. It is not the probability of a profitable trade."
      />
    );
    expect(screen.getByTestId("score-disclaimer")).toHaveTextContent(
      /not the probability of a profitable trade/i
    );
    expect(screen.getByTestId("score-disclaimer")).not.toHaveTextContent(/win probability/i);
    expect(screen.getByTestId("verified-data-meta")).toBeInTheDocument();
  });

  it("missing score components are visible and insufficient data is honest", () => {
    render(<GoldMetaScoreCard insufficientData total={null} />);
    expect(screen.getByTestId("goldmeta-score")).toHaveTextContent(/Insufficient verified data/i);
  });

  it("verified data meta exposes freshness states", () => {
    render(
      <VerifiedDataMeta
        symbol="XAUUSD"
        timeframe="15"
        dataTimestamp="2026-07-21T10:00:00.000Z"
        environment="LIVE"
        mode="SHADOW"
        freshness="STALE"
        sources={["V4 shadow"]}
      />
    );
    expect(screen.getByTestId("freshness-state")).toHaveTextContent("STALE");
    expect(screen.getByTestId("data-timestamp")).toHaveTextContent("2026-07-21T10:00:00.000Z");
  });

  it("update banner copy matches production wording", async () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    render(<UpdateBanner onUpdate={onUpdate} onDismiss={onDismiss} />);
    expect(screen.getByTestId("update-banner")).toHaveTextContent(
      /A new version of GoldMeta is available — Update now/
    );
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("reduced-motion CSS rule exists", () => {
    expect(cssText).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
