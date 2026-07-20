import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../../src/models/types";
import { calculateJournalStatistics } from "../../src/services/journal/statistics";

const entry = (
  outcome: JournalEntry["outcome"],
  riskReward: number | null,
  pnl: number
): JournalEntry => ({
  journalId: `${outcome}-${pnl}`,
  userId: "user-1",
  symbol: "XAUUSD",
  direction: outcome === "LOSS" ? "SELL" : "BUY",
  outcome,
  riskReward,
  pnl,
  createdAt: "2026-07-20T08:00:00.000Z",
  updatedAt: "2026-07-20T08:00:00.000Z"
});

describe("journal statistics", () => {
  it("calculates win rate, average R, and PnL", () => {
    const stats = calculateJournalStatistics([
      entry("WIN", 2, 200),
      entry("LOSS", -1, -100),
      entry("BREAKEVEN", 0, 0),
      entry("OPEN", null, 0)
    ]);

    expect(stats.totalTrades).toBe(4);
    expect(stats.closedTrades).toBe(3);
    expect(stats.winRate).toBe(0.33);
    expect(stats.averageRiskReward).toBe(0.33);
    expect(stats.totalPnl).toBe(100);
  });
});
