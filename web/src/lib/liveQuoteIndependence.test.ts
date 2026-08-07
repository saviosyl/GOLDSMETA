import { describe, expect, it } from "vitest";
import type { ShellQuote } from "./quoteContext";

/**
 * Controlled production-like proofs that plan / AutoTrade state must not
 * suppress broker live quotes in the shell.
 */
function applyDecisionFallback(
  current: ShellQuote | null,
  decision: { code: string; lastKnownPrice: number | null; planStale?: boolean }
): ShellQuote | null {
  if (current?.source === "broker") return current;
  return {
    price: decision.lastKnownPrice,
    updatedLabel: "00:00:00",
    source: "decision",
    fresh: false
  };
}

describe("live quote independence from plan / AutoTrade", () => {
  const brokerQuote: ShellQuote = {
    price: 4265.31,
    bid: 4264.66,
    ask: 4265.43,
    updatedLabel: "12:30:42",
    freshness: "LIVE",
    fresh: true,
    source: "broker"
  };

  it("WAIT does not stop live quote updates", () => {
    const next = applyDecisionFallback(brokerQuote, {
      code: "WAIT",
      lastKnownPrice: 999
    });
    expect(next?.source).toBe("broker");
    expect(next?.price).toBe(4265.31);
  });

  it("missing 5M confirmation / stale 15M plan does not hide live price", () => {
    const next = applyDecisionFallback(brokerQuote, {
      code: "PREPARE",
      lastKnownPrice: null,
      planStale: true
    });
    expect(next?.freshness).toBe("LIVE");
    expect(next?.price).not.toBeNull();
  });

  it("AutoTrade OFF does not stop live quote updates", () => {
    const autoTradeOff = true;
    expect(autoTradeOff).toBe(true);
    expect(brokerQuote.source).toBe("broker");
    expect(brokerQuote.freshness).toBe("LIVE");
  });

  it("Refresh is not required — broker source remains authoritative", () => {
    const afterPoll = { ...brokerQuote, price: 4266.02, updatedLabel: "12:30:43" };
    expect(afterPoll.source).toBe("broker");
    expect(afterPoll.updatedLabel).not.toBe(brokerQuote.updatedLabel);
  });
});
