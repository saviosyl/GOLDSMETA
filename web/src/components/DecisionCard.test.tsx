import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionCard } from "../components/DecisionCard";
import type { Decision } from "../types/models";
import buy from "../fixtures/buy.json";
import sell from "../fixtures/sell.json";
import wait from "../fixtures/wait.json";

describe("DecisionCard", () => {
  it("renders BUY with a single TEST badge for genuine test decisions", () => {
    render(<DecisionCard decision={buy as Decision} />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getAllByTestId("test-badge")).toHaveLength(1);
    expect(screen.getByTestId("quality-badge")).toHaveTextContent("LIVE");
    expect(screen.getByTestId("quality-badge")).not.toHaveTextContent("TEST");
    expect(screen.getByText("2421.00")).toBeInTheDocument();
    expect(screen.getByText("Trend Meter bullish 80")).toBeInTheDocument();
  });

  it("does not show TEST for live production decisions", () => {
    const liveBuy = {
      ...(buy as Decision),
      isTestDecision: false,
      environment: "LIVE" as const,
      dataSourceLabel: "LIVE" as const
    };
    render(<DecisionCard decision={liveBuy} />);
    expect(screen.queryByTestId("test-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("quality-badge")).toHaveTextContent("LIVE");
  });

  it("renders SELL state", () => {
    render(<DecisionCard decision={sell as Decision} />);
    expect(screen.getByText("SELL")).toBeInTheDocument();
    expect(screen.getAllByText("Trend Meter bearish 86").length).toBeGreaterThan(0);
  });

  it("renders WAIT plan placeholders and stale action copy", () => {
    render(<DecisionCard decision={wait as Decision} />);
    expect(screen.getByText("WAIT")).toBeInTheDocument();
    expect(screen.getByTestId("stale-banner")).toBeInTheDocument();
    expect(screen.getByTestId("action-label")).toHaveTextContent("Wait for fresh market data");
    expect(screen.getByTestId("plan-entry")).toHaveTextContent("Wait");
    expect(screen.getByTestId("plan-stop")).toHaveTextContent("Not applicable");
    expect(screen.getByTestId("plan-tp1")).toHaveTextContent("Not applicable");
    expect(screen.getByTestId("plan-tp2")).toHaveTextContent("Not applicable");
    expect(screen.getByTestId("plan-tp3")).toHaveTextContent("Not applicable");
    expect(screen.getByTestId("plan-rr")).toHaveTextContent("Not applicable");
  });

  it("renders WAIT and offline warning", () => {
    render(
      <DecisionCard decision={wait as Decision} source="offline" cachedAt="2026-07-20T09:00:00.000Z" />
    );
    expect(screen.getByText("WAIT")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
  });
});
