/**
 * Factual weekly review from closed AutoTrade journal records.
 * Persists one report per uid / week / environment. Never fabricates trades.
 */

import { buildPerformanceSummary } from "./performanceService";
import { notifyAutoTradeEvent } from "./autoTradeNotifications";
import {
  currentWeekBounds,
  getWeeklyReport,
  listWeeklyReports,
  previousWeekBounds,
  saveWeeklyReport,
  type StoredWeeklyReport
} from "./weeklyReportStore";
import { listOwnersNeedingQuoteRefresh } from "./quoteStore";

export type WeeklyReport = StoredWeeklyReport;

function insightsFromPerf(
  perf: Awaited<ReturnType<typeof buildPerformanceSummary>>
): { whatWorked: string[]; whatStruggled: string[] } {
  const whatWorked: string[] = [];
  const whatStruggled: string[] = [];

  if (perf.totalTrades < 3) {
    return {
      whatWorked: ["Not enough completed trades yet."],
      whatStruggled: ["Not enough completed trades yet."]
    };
  }

  if (perf.winRate != null && perf.winRate >= 0.55) {
    whatWorked.push(
      `Win rate ${Math.round(perf.winRate * 100)}% (n=${perf.totalTrades})`
    );
  }
  if (perf.averageRr != null && perf.averageRr >= 1.5) {
    whatWorked.push(`Average R:R ${perf.averageRr.toFixed(2)}`);
  }
  if (perf.netPnl > 0) {
    whatWorked.push(`Net P/L +${perf.netPnl.toFixed(2)}`);
  }
  if (
    perf.buyWinRate != null &&
    perf.sellWinRate != null &&
    perf.totalTrades >= 5
  ) {
    if (perf.buyWinRate > perf.sellWinRate + 0.1) {
      whatWorked.push("BUY setups outperformed SELL setups this week");
    } else if (perf.sellWinRate > perf.buyWinRate + 0.1) {
      whatWorked.push("SELL setups outperformed BUY setups this week");
    }
  }
  if (perf.winRate != null && perf.winRate < 0.45) {
    whatStruggled.push(
      `Win rate ${Math.round(perf.winRate * 100)}% — review rejected setups and session filters`
    );
  }
  if (perf.largestDrawdown != null && perf.largestDrawdown > 0) {
    whatStruggled.push(`Largest drawdown ${perf.largestDrawdown.toFixed(2)}`);
  }
  if (!whatWorked.length) {
    whatWorked.push("Not enough completed trades yet.");
  }
  if (!whatStruggled.length) {
    whatStruggled.push("No material weakness detected from available closed trades");
  }
  return { whatWorked, whatStruggled };
}

export async function buildAndPersistWeeklyReport(args: {
  uid: string;
  environment: "DEMO" | "LIVE";
  week?: "current" | "previous";
  notify?: boolean;
}): Promise<{ created: boolean; report: StoredWeeklyReport }> {
  const bounds =
    args.week === "previous" ? previousWeekBounds() : currentWeekBounds();
  const existing = await getWeeklyReport(args.uid, bounds.weekKey, args.environment);
  if (existing) {
    return { created: false, report: existing };
  }

  const perf = await buildPerformanceSummary({
    uid: args.uid,
    environment: args.environment,
    period: "7d"
  });

  const qualificationLabel = "Core / FAST AutoTrade retired — Gold Hunter only";
  const safetyEvents: string[] = [];

  const { whatWorked, whatStruggled } = insightsFromPerf(perf);
  const report: StoredWeeklyReport = {
    id: `${bounds.weekKey}_${args.environment}`,
    uid: args.uid,
    weekKey: bounds.weekKey,
    weekStart: bounds.weekStart,
    weekEnd: bounds.weekEnd,
    environment: args.environment,
    trades: perf.totalTrades,
    wins: perf.wins,
    losses: perf.losses,
    winRate: perf.winRate,
    netPnl: perf.netPnl,
    averageRr: perf.averageRr,
    largestDrawdown: perf.largestDrawdown,
    buyWinRate: perf.buyWinRate,
    sellWinRate: perf.sellWinRate,
    londonTrades: perf.londonTrades,
    newYorkTrades: perf.newYorkTrades,
    qualificationLabel,
    safetyEvents: [...new Set(safetyEvents)].slice(0, 20),
    whatWorked,
    whatStruggled,
    nextWeek: [
      "Continue with current risk settings",
      "Live execution remains locked until explicit activation",
      qualificationLabel
    ],
    generatedAt: new Date().toISOString(),
    notificationSent: false
  };

  const saved = await saveWeeklyReport(report);
  if (saved.created && args.notify !== false) {
    await notifyAutoTradeEvent({
      uid: args.uid,
      kind: "WEEKLY_REPORT_READY",
      title: "Your GoldMeta Weekly Review is ready.",
      body: `${args.environment} week ${bounds.weekStart} → ${bounds.weekEnd}: ${perf.totalTrades} trades · net ${perf.netPnl.toFixed(2)}`,
      dedupeKey: `weekly_${bounds.weekKey}_${args.environment}`
    });
    report.notificationSent = true;
  }
  return saved;
}

/** Compatibility HTTP helper — returns latest or builds current Demo week. */
export async function buildWeeklyReport(uid: string): Promise<StoredWeeklyReport> {
  const listed = await listWeeklyReports(uid, 1);
  if (listed[0]) return listed[0];
  const { report } = await buildAndPersistWeeklyReport({
    uid,
    environment: "DEMO",
    week: "current",
    notify: false
  });
  return report;
}

/**
 * Weekend scheduler — generate previous-week reports for connected owners.
 * Avoids duplicates via saveWeeklyReport idempotency.
 */
export async function runWeeklyReportPass(opts?: {
  limit?: number;
}): Promise<{ owners: number; created: number }> {
  const owners = await listOwnersNeedingQuoteRefresh(opts?.limit ?? 50);
  let created = 0;
  for (const uid of owners) {
    for (const environment of ["DEMO", "LIVE"] as const) {
      try {
        const r = await buildAndPersistWeeklyReport({
          uid,
          environment,
          week: "previous",
          notify: true
        });
        if (r.created) created += 1;
      } catch {
        /* continue */
      }
    }
  }
  return { owners: owners.length, created };
}
