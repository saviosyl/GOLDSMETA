import type { JournalEntry } from "../../models/types";
import { roundRatio } from "../../utils/money";

export interface JournalStatistics {
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  averageRiskReward: number | null;
  totalPnl: number;
}

export const calculateJournalStatistics = (entries: JournalEntry[]): JournalStatistics => {
  const closed = entries.filter((entry) => entry.outcome !== "OPEN");
  const wins = closed.filter((entry) => entry.outcome === "WIN").length;
  const losses = closed.filter((entry) => entry.outcome === "LOSS").length;
  const breakeven = closed.filter((entry) => entry.outcome === "BREAKEVEN").length;
  const rrValues = closed
    .map((entry) => entry.riskReward)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const averageRiskReward =
    rrValues.length === 0
      ? null
      : roundRatio(rrValues.reduce((sum, value) => sum + value, 0) / rrValues.length);

  return {
    totalTrades: entries.length,
    closedTrades: closed.length,
    wins,
    losses,
    breakeven,
    winRate: closed.length === 0 ? 0 : roundRatio(wins / closed.length),
    averageRiskReward,
    totalPnl: closed.reduce((sum, entry) => sum + (entry.pnl ?? 0), 0)
  };
};
