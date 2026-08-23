import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Decision } from "../types/models";
import { useGoldMetaMarketView } from "./useGoldMetaMarketView";

const { latestDecisionPack } = vi.hoisted(() => ({
  latestDecisionPack: vi.fn()
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: { latestDecisionPack }
  })
}));

vi.mock("../lib/quoteContext", () => ({
  useShellQuote: () => ({
    quote: {
      price: 4608.07,
      fresh: true,
      freshness: "FRESH",
      marketStatus: "CLOSED",
      sessionLabel: "MARKET CLOSED"
    }
  })
}));

function decision(
  id: string,
  price: number,
  levels: { poc: number; vah: number; val: number },
  timeframe: string
): Decision {
  return {
    decisionId: id,
    decision: "WAIT",
    confidence: 50,
    lastKnownPrice: price,
    timeframe,
    currentSession: "NEWYORK",
    marketStructure: {
      poc: levels.poc,
      vah: levels.vah,
      val: levels.val,
      trend: "BULLISH",
      trendStrength: 30
    }
  } as unknown as Decision;
}

describe("useGoldMetaMarketView structure source", () => {
  beforeEach(() => {
    latestDecisionPack.mockReset();
  });

  it("keeps the live quote but takes POC/VAH/VAL from the latest complete strategy signal", async () => {
    const quoteDecision = decision(
      "quote-1m",
      4605.23,
      { poc: 4621.63, vah: 4625.85, val: 4616.85 },
      "1"
    );
    const structureDecision = decision(
      "plan-15m",
      4608.07,
      { poc: 4582.47, vah: 4632.07, val: 4563.66 },
      "15"
    );

    latestDecisionPack.mockResolvedValue({
      decision: quoteDecision,
      latestQuote: quoteDecision,
      latestCompleteStrategySignal: structureDecision,
      marketStructureMode: "COMPLETE",
      structureDecisionId: structureDecision.decisionId,
      intradayPlan: null,
      stablePlan: null
    });

    const { result } = renderHook(() => useGoldMetaMarketView());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.livePrice).toBe(4608.07);
    expect(result.current.structureDecision?.decisionId).toBe("plan-15m");
    expect(result.current.poc).toBe(4582.47);
    expect(result.current.vah).toBe(4632.07);
    expect(result.current.val).toBe(4563.66);
  });

  it("does not combine structure levels when the backend marks the sources as mismatched", async () => {
    const quoteDecision = decision(
      "quote-1m",
      4605.23,
      { poc: 4621.63, vah: 4625.85, val: 4616.85 },
      "1"
    );
    const structureDecision = decision(
      "plan-15m",
      4200,
      { poc: 4180, vah: 4210, val: 4160 },
      "15"
    );

    latestDecisionPack.mockResolvedValue({
      decision: quoteDecision,
      latestQuote: quoteDecision,
      latestCompleteStrategySignal: structureDecision,
      marketStructureMode: "MISMATCH",
      structureDecisionId: null,
      intradayPlan: null,
      stablePlan: null
    });

    const { result } = renderHook(() => useGoldMetaMarketView());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.livePrice).toBe(4608.07);
    expect(result.current.structureDecision).toBeNull();
    expect(result.current.poc).toBeNull();
    expect(result.current.vah).toBeNull();
    expect(result.current.val).toBeNull();
  });
});
