import { createHash } from "crypto";
import { v4Config } from "./config";
import { evaluateV4 } from "./engine";
import type {
  V4BacktestReport,
  V4BacktestTrade,
  V4Bar,
  V4LockedPlan
} from "./types";

export interface BacktestSeries {
  bars15: V4Bar[];
  bars60: V4Bar[];
  /** Optional 1m/5m for lifecycle resolution */
  bars1?: V4Bar[];
  sessionByBarTime?: Record<string, string>;
  profileSeries: Array<{
    barTime: string;
    poc: number;
    vah: number;
    val: number;
    pocMigration?: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  }>;
}

export interface BacktestOptions {
  sample: V4BacktestReport["sample"];
  foldId?: string;
  spreadPoints?: number;
  /** Embargo bars between train and test — recorded for anti-overfit audit. */
  embargoBars?: number;
  economicEvents?: [];
  maxExperimentsNote?: string;
}

const worstCaseResolve = (
  plan: V4LockedPlan,
  path: V4Bar[],
  costPoints: number
): V4BacktestTrade => {
  let hitSl = false;
  let hitTp1 = false;
  let hitTp2 = false;
  let hitTp3 = false;
  let ambiguous = false;

  for (const bar of path) {
    if (!bar.confirmed) continue;
    const sl = plan.stopLoss;
    const { tp1, tp2, tp3, entry, direction } = plan;

    if (direction === "BUY") {
      const slHit = bar.low <= sl;
      const t1 = bar.high >= tp1;
      const t2 = bar.high >= tp2;
      const t3 = bar.high >= tp3;
      if (slHit && (t1 || t2 || t3)) {
        ambiguous = true;
        hitSl = true; // worst-case SL first
        break;
      }
      if (slHit) {
        hitSl = true;
        break;
      }
      if (t3) {
        hitTp3 = true;
        break;
      }
      if (t2) {
        hitTp2 = true;
        break;
      }
      if (t1) {
        hitTp1 = true;
        break;
      }
    } else {
      const slHit = bar.high >= sl;
      const t1 = bar.low <= tp1;
      const t2 = bar.low <= tp2;
      const t3 = bar.low <= tp3;
      if (slHit && (t1 || t2 || t3)) {
        ambiguous = true;
        hitSl = true;
        break;
      }
      if (slHit) {
        hitSl = true;
        break;
      }
      if (t3) {
        hitTp3 = true;
        break;
      }
      if (t2) {
        hitTp2 = true;
        break;
      }
      if (t1) {
        hitTp1 = true;
        break;
      }
    }
    void entry;
  }

  const risk = plan.riskDistance;
  const costR = risk > 0 ? costPoints / risk : 0;
  let outcome: V4BacktestTrade["outcome"] = "EXPIRED";
  let rawR = 0;
  if (ambiguous) {
    outcome = "AMBIGUOUS";
    rawR = -1;
  } else if (hitSl) {
    outcome = "SL";
    rawR = -1;
  } else if (hitTp3) {
    outcome = "TP3";
    rawR = 3;
  } else if (hitTp2) {
    outcome = "TP2";
    rawR = 2;
  } else if (hitTp1) {
    outcome = "TP1";
    rawR = 1;
  }

  return {
    planId: plan.planId,
    strategyFamily: plan.strategyFamily,
    direction: plan.direction,
    entry: plan.entry,
    stop: plan.stopLoss,
    tp1: plan.tp1,
    tp2: plan.tp2,
    tp3: plan.tp3,
    outcome,
    rawR,
    netR: Math.round((rawR - costR) * 100) / 100,
    session: plan.session,
    regime: plan.regime,
    quality: plan.quality.total,
    costsPoints: costPoints
  };
};

/**
 * Event-driven V4 backtester.
 * - chronological
 * - worst-case SL before TP on same bar
 * - costs applied
 * - never mutates production
 */
export function runV4Backtest(series: BacktestSeries, options: BacktestOptions): V4BacktestReport {
  const notes: string[] = [
    "Event-driven backtest with worst-case same-bar SL-before-TP policy.",
    "Costs are estimates (spread + slippage).",
    "Parameter values must not be chosen using the final test period.",
    options.maxExperimentsNote ?? "Experiment registry: limit strategy variations."
  ];
  if (options.embargoBars) {
    notes.push(`Embargo bars between folds: ${options.embargoBars}`);
  }

  const trades: V4BacktestTrade[] = [];
  let rejectedCandidates = 0;
  let unsafePlanCount = 0;
  const planMutationCount = 0; // locked plans never mutate by construction
  const seenPlanKeys = new Set<string>();

  const bars15 = series.bars15.filter((b) => b.confirmed);
  for (let i = 40; i < bars15.length - 8; i += 1) {
    const window15 = bars15.slice(0, i + 1);
    const t = window15[window15.length - 1]!.time;
    const window60 = series.bars60.filter((b) => b.confirmed && b.time <= t).slice(-80);
    const prof =
      series.profileSeries.find((p) => p.barTime <= t) ??
      series.profileSeries[series.profileSeries.length - 1];
    if (!prof) continue;

    const session = series.sessionByBarTime?.[t] ?? "LONDON";
    const result = evaluateV4({
      bars15: window15.slice(-60),
      bars60: window60.length ? window60 : window15.slice(-40).map((b) => ({ ...b, timeframe: "60" })),
      session,
      environment: "RESEARCH",
      xauProfile: {
        source: "XAUUSD_TV",
        poc: prof.poc,
        vah: prof.vah,
        val: prof.val,
        pocMigration: prof.pocMigration,
        asOf: t,
        barCount: 40,
        volumeObservations: 40
      },
      manualSpreadPoints: options.spreadPoints ?? 0.35,
      atrPercentile: 50,
      nowIso: t
    });

    if (!result.lockedPlan) {
      if (result.candidate || result.gateFailures.length) rejectedCandidates += 1;
      continue;
    }

    const plan = result.lockedPlan;
    if (plan.riskDistance < v4Config.stop.absoluteMinPoints) {
      unsafePlanCount += 1;
      continue;
    }
    const key = `${plan.direction}|${plan.entry}|${plan.stopLoss}|${plan.barTime}`;
    if (seenPlanKeys.has(key)) continue;
    seenPlanKeys.add(key);

    const path = bars15.slice(i + 1, i + 1 + 16);
    const pathStart = path[0]?.time;
    const pathEnd = path[path.length - 1]?.time;
    const resolveBars =
      series.bars1 && series.bars1.length && pathStart && pathEnd
        ? series.bars1.filter((b) => b.time >= pathStart && b.time <= pathEnd)
        : path;

    trades.push(
      worstCaseResolve(plan, resolveBars.length ? resolveBars : path, plan.costs.totalCostPoints)
    );
  }

  const nets = trades.map((t) => t.netR);
  const wins = nets.filter((r) => r > 0);
  const losses = nets.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null;
  const netExpectancyR =
    nets.length > 0 ? Math.round((nets.reduce((a, b) => a + b, 0) / nets.length) * 100) / 100 : null;

  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  let streak = 0;
  let maxStreak = 0;
  for (const r of nets) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
    if (r < 0) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else streak = 0;
  }

  const byStrategy: Record<string, number> = {};
  const bySession: Record<string, number> = {};
  const byRegime: Record<string, number> = {};
  const byDirection = { BUY: 0, SELL: 0 };
  for (const t of trades) {
    byStrategy[t.strategyFamily] = (byStrategy[t.strategyFamily] ?? 0) + 1;
    bySession[t.session] = (bySession[t.session] ?? 0) + 1;
    byRegime[t.regime] = (byRegime[t.regime] ?? 0) + 1;
    byDirection[t.direction] += 1;
  }

  const acceptanceFailures: string[] = [];
  if (trades.length < v4Config.acceptance.minHistoricalResolved) {
    acceptanceFailures.push(
      `Resolved trades ${trades.length} < ${v4Config.acceptance.minHistoricalResolved}`
    );
  }
  if (netExpectancyR == null || netExpectancyR <= v4Config.acceptance.minNetExpectancyR) {
    acceptanceFailures.push(`Net expectancy after costs ${netExpectancyR} not positive`);
  }
  if (profitFactor == null || profitFactor < v4Config.acceptance.minProfitFactor) {
    acceptanceFailures.push(`Profit factor ${profitFactor} < ${v4Config.acceptance.minProfitFactor}`);
  }
  if (unsafePlanCount > 0) {
    acceptanceFailures.push(`Unsafe plan count ${unsafePlanCount}`);
  }

  return {
    strategyVersion: "4",
    configVersion: v4Config.configVersion,
    sample: options.sample,
    foldId: options.foldId,
    resolvedTrades: trades.length,
    rejectedCandidates,
    unsafePlanCount,
    planMutationCount,
    netExpectancyR,
    profitFactor,
    maxDrawdownR: Math.round(maxDd * 100) / 100,
    maxLosingStreak: maxStreak,
    winRate: nets.length ? Math.round((wins.length / nets.length) * 1000) / 10 : null,
    byStrategy,
    bySession,
    byRegime,
    byDirection,
    trades,
    notes,
    meetsAcceptanceGates: acceptanceFailures.length === 0,
    acceptanceFailures
  };
}

/** Deterministic synthetic series for unit tests / smoke research. */
export function buildSyntheticSeries(seed = 42, bars = 120): BacktestSeries {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const bars15: V4Bar[] = [];
  let price = 2650;
  const start = Date.parse("2025-01-02T08:00:00.000Z");
  for (let i = 0; i < bars; i += 1) {
    const drift = (rand() - 0.48) * 2.2;
    const open = price;
    const close = Math.round((price + drift) * 100) / 100;
    const high = Math.max(open, close) + rand() * 1.2;
    const low = Math.min(open, close) - rand() * 1.2;
    price = close;
    const time = new Date(start + i * 15 * 60_000).toISOString();
    bars15.push({
      time,
      open,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close,
      volume: 100 + Math.floor(rand() * 50),
      confirmed: true,
      timeframe: "15"
    });
  }
  const mid = bars15[Math.floor(bars15.length / 2)]!.close;
  const profileSeries = bars15.map((b) => ({
    barTime: b.time,
    poc: mid,
    vah: mid + 8,
    val: mid - 8,
    pocMigration: "FLAT" as const
  }));
  return {
    bars15,
    bars60: bars15.filter((_, i) => i % 4 === 0).map((b) => ({ ...b, timeframe: "60" as const })),
    profileSeries,
    sessionByBarTime: Object.fromEntries(bars15.map((b) => [b.time, "LONDON"]))
  };
}

export function experimentId(label: string, configVersion: string): string {
  return createHash("sha256").update(`${label}|${configVersion}`).digest("hex").slice(0, 12);
}
