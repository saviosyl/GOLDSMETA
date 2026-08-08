/**
 * Demo / Live performance analytics from AutoTrade journal records.
 */

import { listAutoTradeJournal } from "./autoTradeJournal";

export type PerformancePeriod = "today" | "7d" | "30d" | "all";

export type PerformanceSummary = {
  environment: "DEMO" | "LIVE" | "ALL";
  period: PerformancePeriod;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  averageWin: number | null;
  averageLoss: number | null;
  averageRr: number | null;
  profitFactor: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  largestDrawdown: number | null;
  buyWinRate: number | null;
  sellWinRate: number | null;
  londonTrades: number;
  newYorkTrades: number;
  avgConfidenceWinners: number | null;
  avgConfidenceLosers: number | null;
  cumulativePnl: Array<{ at: string; pnl: number }>;
};

function inPeriod(iso: string | null | undefined, period: PerformancePeriod): boolean {
  if (!iso) return false;
  if (period === "all") return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  if (period === "today") {
    const day = new Date().toISOString().slice(0, 10);
    return iso.slice(0, 10) === day;
  }
  const days = period === "7d" ? 7 : 30;
  return t >= now - days * 86_400_000;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function buildPerformanceSummary(args: {
  uid: string;
  environment: "DEMO" | "LIVE" | "ALL";
  period: PerformancePeriod;
}): Promise<PerformanceSummary> {
  const envFilter = args.environment === "ALL" ? undefined : args.environment;
  const rows = await listAutoTradeJournal(args.uid, { environment: envFilter, limit: 500 });
  const closed = rows.filter(
    (r) =>
      r.closedAt &&
      typeof r.pnl === "number" &&
      inPeriod(String(r.closedAt), args.period)
  );

  const pnls = closed.map((r) => Number(r.pnl));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const buy = closed.filter((r) => r.side === "BUY");
  const sell = closed.filter((r) => r.side === "SELL");
  const buyWins = buy.filter((r) => Number(r.pnl) > 0).length;
  const sellWins = sell.filter((r) => Number(r.pnl) > 0).length;
  const rr = closed
    .map((r) => Number(r.riskReward))
    .filter((n) => Number.isFinite(n) && n > 0);
  const confW = closed
    .filter((r) => Number(r.pnl) > 0)
    .map((r) => Number(r.confidence))
    .filter((n) => Number.isFinite(n));
  const confL = closed
    .filter((r) => Number(r.pnl) < 0)
    .map((r) => Number(r.confidence))
    .filter((n) => Number.isFinite(n));

  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  const cumulative: Array<{ at: string; pnl: number }> = [];
  const sorted = [...closed].sort(
    (a, b) => Date.parse(String(a.closedAt)) - Date.parse(String(b.closedAt))
  );
  for (const r of sorted) {
    cum += Number(r.pnl);
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    cumulative.push({ at: String(r.closedAt), pnl: cum });
  }

  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  return {
    environment: args.environment,
    period: args.period,
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    netPnl: pnls.reduce((a, b) => a + b, 0),
    averageWin: avg(wins),
    averageLoss: avg(losses),
    averageRr: avg(rr),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    largestWin: wins.length ? Math.max(...wins) : null,
    largestLoss: losses.length ? Math.min(...losses) : null,
    largestDrawdown: closed.length ? maxDd : null,
    buyWinRate: buy.length ? buyWins / buy.length : null,
    sellWinRate: sell.length ? sellWins / sell.length : null,
    londonTrades: closed.filter((r) => /london/i.test(String(r.session ?? ""))).length,
    newYorkTrades: closed.filter((r) => /new/i.test(String(r.session ?? ""))).length,
    avgConfidenceWinners: avg(confW),
    avgConfidenceLosers: avg(confL),
    cumulativePnl: cumulative
  };
}
