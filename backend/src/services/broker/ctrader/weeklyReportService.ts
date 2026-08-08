/**
 * Factual weekly review from closed AutoTrade journal records.
 */

import { buildPerformanceSummary } from "./performanceService";
import { getQualificationView } from "./qualificationService";

export type WeeklyReport = {
  weekOf: string;
  environment: "DEMO";
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  averageRr: number | null;
  largestDrawdown: number | null;
  qualificationLabel: string;
  whatWorked: string[];
  whatStruggled: string[];
  nextWeek: string[];
  generatedAt: string;
};

export async function buildWeeklyReport(uid: string): Promise<WeeklyReport> {
  const perf = await buildPerformanceSummary({
    uid,
    environment: "DEMO",
    period: "7d"
  });
  let qualificationLabel = "Not started";
  try {
    const q = await getQualificationView(uid);
    qualificationLabel = `${q.overallLabel} · Previews ${q.preview.completed}/${q.preview.required} · Controlled ${q.controlledDemo.completed}/${q.controlledDemo.required}`;
  } catch {
    /* ignore */
  }

  const whatWorked: string[] = [];
  const whatStruggled: string[] = [];
  if (perf.winRate != null && perf.winRate >= 0.55) {
    whatWorked.push(`Win rate ${Math.round(perf.winRate * 100)}% over the last 7 days`);
  }
  if (perf.averageRr != null && perf.averageRr >= 1.5) {
    whatWorked.push(`Average R:R ${perf.averageRr.toFixed(2)}`);
  }
  if (perf.netPnl > 0) {
    whatWorked.push(`Net Demo P/L +${perf.netPnl.toFixed(2)}`);
  }
  if (perf.buyWinRate != null && perf.sellWinRate != null) {
    if (perf.buyWinRate > perf.sellWinRate + 0.1) {
      whatWorked.push("BUY setups outperformed SELL setups this week");
    } else if (perf.sellWinRate > perf.buyWinRate + 0.1) {
      whatWorked.push("SELL setups outperformed BUY setups this week");
    }
  }
  if (perf.winRate != null && perf.winRate < 0.45 && perf.totalTrades >= 3) {
    whatStruggled.push(`Win rate ${Math.round(perf.winRate * 100)}% — review rejected setups and session filters`);
  }
  if (perf.largestDrawdown != null && perf.largestDrawdown > 0) {
    whatStruggled.push(`Largest Demo drawdown ${perf.largestDrawdown.toFixed(2)}`);
  }
  if (perf.totalTrades === 0) {
    whatStruggled.push("No closed Demo Auto / qualification trades in the last 7 days");
  }
  if (!whatWorked.length) whatWorked.push("Insufficient closed-trade sample for positive patterns");
  if (!whatStruggled.length) whatStruggled.push("No material weakness detected from available closed trades");

  const weekOf = new Date().toISOString().slice(0, 10);
  return {
    weekOf,
    environment: "DEMO",
    trades: perf.totalTrades,
    wins: perf.wins,
    losses: perf.losses,
    winRate: perf.winRate,
    netPnl: perf.netPnl,
    averageRr: perf.averageRr,
    largestDrawdown: perf.largestDrawdown,
    qualificationLabel,
    whatWorked,
    whatStruggled,
    nextWeek: [
      "Continue qualification / Demo Auto with current risk settings",
      "Live execution remains locked until explicit activation",
      qualificationLabel
    ],
    generatedAt: new Date().toISOString()
  };
}
