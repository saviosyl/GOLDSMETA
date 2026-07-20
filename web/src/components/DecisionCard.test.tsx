import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionCard } from "../components/DecisionCard";
import type { Decision } from "../types/models";
import buy from "../fixtures/buy.json";
import sell from "../fixtures/sell.json";
import wait from "../fixtures/wait.json";

describe("DecisionCard", () => {
  it("renders BUY with TEST badge", () => {
    render(<DecisionCard decision={buy as Decision} />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByLabelText("TEST decision")).toBeInTheDocument();
    expect(screen.getByText("2421.00")).toBeInTheDocument();
    expect(screen.getByText("Trend Meter bullish 80")).toBeInTheDocument();
  });

  it("renders SELL state", () => {
    render(<DecisionCard decision={sell as Decision} />);
    expect(screen.getByText("SELL")).toBeInTheDocument();
    expect(screen.getByText("Trend Meter bearish 86")).toBeInTheDocument();
  });

  it("renders WAIT and stale/offline warning", () => {
    render(
      <DecisionCard decision={wait as Decision} source="offline" cachedAt="2026-07-20T09:00:00.000Z" />
    );
    expect(screen.getByText("WAIT")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
  });
});
