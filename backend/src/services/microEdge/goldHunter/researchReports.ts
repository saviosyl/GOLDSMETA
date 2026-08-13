/**
 * Real-data research diagnostics: movement, spread, hold buckets, session/regime.
 */
import { classifySession } from "./sessionRegime";
import type { GhShadowTrade } from "./types";
import { computePolicyBacktest } from "./metrics";

export type QuantileReport = {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  n: number;
};

function quantiles(xs: number[]): QuantileReport {
  const a = xs.filter((x) => Number.isFinite(x)).sort((u, v) => u - v);
  if (!a.length) {
    return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, max: 0, n: 0 };
  }
  const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]!;
  return {
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    p95: q(0.95),
    p99: q(0.99),
    max: a[a.length - 1]!,
    n: a.length
  };
}

export function absoluteMidMoveDistribution(
  quotes: Array<{ timestampMs: number; bid: number; ask: number }>,
  horizonSec: number
): QuantileReport {
  const byTs = new Map(quotes.map((q) => [q.timestampMs, q]));
  const moves: number[] = [];
  for (const q of quotes) {
    const t = byTs.get(q.timestampMs + horizonSec * 1000);
    if (!t) continue;
    const m0 = (q.bid + q.ask) / 2;
    const m1 = (t.bid + t.ask) / 2;
    moves.push(Math.abs(m1 - m0));
  }
  return quantiles(moves);
}

export function spreadDistribution(
  quotes: Array<{ bid: number; ask: number; timestampMs: number }>
): {
  overall: QuantileReport;
  bySession: Record<string, QuantileReport>;
} {
  const overall = quantiles(quotes.map((q) => q.ask - q.bid));
  const bySession: Record<string, number[]> = {};
  for (const q of quotes) {
    const s = classifySession(q.timestampMs);
    (bySession[s] ??= []).push(q.ask - q.bid);
  }
  const mapped: Record<string, QuantileReport> = {};
  for (const [k, v] of Object.entries(bySession)) mapped[k] = quantiles(v);
  return { overall, bySession: mapped };
}

export function executableOpportunityDistribution(
  quotes: Array<{ timestampMs: number; bid: number; ask: number }>,
  horizonSec: number,
  friction: number
): { bestBuyNet: QuantileReport; bestSellNet: QuantileReport } {
  const byTs = new Map(quotes.map((q) => [q.timestampMs, q]));
  const buys: number[] = [];
  const sells: number[] = [];
  for (const q of quotes) {
    const t = byTs.get(q.timestampMs + horizonSec * 1000);
    if (!t) continue;
    buys.push(t.bid - q.ask - friction);
    sells.push(q.bid - t.ask - friction);
  }
  return { bestBuyNet: quantiles(buys), bestSellNet: quantiles(sells) };
}

export type HoldBucket = {
  label: string;
  lo: number;
  hi: number;
  tradeCount: number;
  netPnl: number;
  expectancy: number;
  winRate: number;
};

export function holdTimeBuckets(trades: GhShadowTrade[]): HoldBucket[] {
  const defs = [
    { label: "0-5s", lo: 0, hi: 5 },
    { label: "6-10s", lo: 6, hi: 10 },
    { label: "11-15s", lo: 11, hi: 15 },
    { label: "16-30s", lo: 16, hi: 30 },
    { label: "31-45s", lo: 31, hi: 45 },
    { label: "46-60s", lo: 46, hi: 60 }
  ];
  return defs.map((d) => {
    const ts = trades.filter(
      (t) => t.durationSeconds >= d.lo && t.durationSeconds <= d.hi
    );
    const st = computePolicyBacktest(ts);
    return {
      label: d.label,
      lo: d.lo,
      hi: d.hi,
      tradeCount: st.tradeCount,
      netPnl: st.netPnl,
      expectancy: st.expectancy,
      winRate: st.winRate
    };
  });
}

export function slicePerformance(
  trades: GhShadowTrade[],
  keyFn: (t: GhShadowTrade) => string
): Record<
  string,
  {
    tradeCount: number;
    netPnl: number;
    expectancy: number;
    profitFactor: number;
    winRate: number;
  }
> {
  const groups = new Map<string, GhShadowTrade[]>();
  for (const t of trades) {
    const k = keyFn(t);
    const g = groups.get(k) ?? [];
    g.push(t);
    groups.set(k, g);
  }
  const out: Record<
    string,
    {
      tradeCount: number;
      netPnl: number;
      expectancy: number;
      profitFactor: number;
      winRate: number;
    }
  > = {};
  for (const [k, g] of groups) {
    const st = computePolicyBacktest(g);
    out[k] = {
      tradeCount: st.tradeCount,
      netPnl: st.netPnl,
      expectancy: st.expectancy,
      profitFactor: st.profitFactor,
      winRate: st.winRate
    };
  }
  return out;
}

export function maxLosingStreak(trades: GhShadowTrade[]): number {
  let cur = 0;
  let max = 0;
  for (const t of trades) {
    if (t.result === "LOSS") {
      cur += 1;
      max = Math.max(max, cur);
    } else cur = 0;
  }
  return max;
}
