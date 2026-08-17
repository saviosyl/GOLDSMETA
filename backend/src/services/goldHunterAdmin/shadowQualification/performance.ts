/**
 * Formal performance + payoff diagnostics for clean shadow trades only.
 */
import type { GhShadowExitReason, GhShadowTrade } from "./types";

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function maxDrawdown(pnls: number[]): number {
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return maxDd;
}

export type GhShadowSetupStats = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  netPnlEur: number;
};

export type GhShadowExitReasonStats = {
  exitReason: string;
  n: number;
  wins: number;
  losses: number;
  net: number;
  avgMfe: number | null;
  avgMae: number | null;
};

export type GhShadowPayoffDiagnostics = {
  avgWinEur: number | null;
  avgLossEur: number | null;
  avgWinOverAvgLoss: number | null;
  /** Average (netPnl / (mfe * scale)) for winners with mfe>0 — capture of favorable excursion in cash terms approximates net/maxFavorable cash. */
  mfeCaptureRatioWinners: number | null;
  losersWithPriorPositiveMfePct: number | null;
  harvestFadePaths: Array<{
    tradeId: string;
    entry: number;
    maxFavorable: number;
    exit: number;
  }>;
  trailHitPaths: Array<{
    tradeId: string;
    entry: number;
    trailActivatedAt: string | null;
    exit: number;
  }>;
  hardProtectionMae: Array<{ tradeId: string; mae: number }>;
  lossSourceHints: string[];
};

export type GhShadowPerformanceReport = {
  completedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossPnlEur: number;
  frictionEur: number;
  netSimulatedPnlEur: number;
  profitFactor: number | null;
  expectancyEurPerTrade: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  averageWinLossRatio: number | null;
  largestWinner: number | null;
  largestLoser: number | null;
  maxDrawdown: number;
  averageMfe: number | null;
  averageMae: number | null;
  medianDurationMs: number | null;
  bySetup: Record<"A" | "B" | "C", GhShadowSetupStats>;
  byExitReason: GhShadowExitReasonStats[];
  payoff: GhShadowPayoffDiagnostics;
  checkpoint: {
    at50: "DATA_QUALITY_ONLY" | "NOT_REACHED";
    at100: "EARLY_OBSERVATION" | "NOT_REACHED";
    at250:
      | "PROMISING — CONTINUE TO 500"
      | "NEGATIVE EDGE — STRATEGY REDESIGN REQUIRED"
      | "INSUFFICIENT / DATA QUALITY FAILURE"
      | "NOT_REACHED";
    formalDecisionReady: boolean;
  };
};

function setupStats(trades: GhShadowTrade[]): GhShadowSetupStats {
  const nets = trades
    .map((t) => t.simulatedNetPnlEur)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(losses.reduce((a, b) => a + b, 0));
  const net = nets.reduce((a, b) => a + b, 0);
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: grossLossAbs > 0 ? grossWin / grossLossAbs : wins.length ? Infinity : null,
    expectancy: trades.length ? net / trades.length : null,
    netPnlEur: net
  };
}

function classifyAt250(report: {
  completedTrades: number;
  profitFactor: number | null;
  expectancyEurPerTrade: number | null;
  netSimulatedPnlEur: number;
}): GhShadowPerformanceReport["checkpoint"]["at250"] {
  if (report.completedTrades < 250) return "NOT_REACHED";
  if (report.profitFactor == null || report.expectancyEurPerTrade == null) {
    return "INSUFFICIENT / DATA QUALITY FAILURE";
  }
  const promising =
    report.netSimulatedPnlEur > 0 &&
    report.profitFactor >= 1.15 &&
    report.expectancyEurPerTrade > 0;
  if (promising) return "PROMISING — CONTINUE TO 500";
  if (report.netSimulatedPnlEur < 0 || report.profitFactor < 1) {
    return "NEGATIVE EDGE — STRATEGY REDESIGN REQUIRED";
  }
  return "INSUFFICIENT / DATA QUALITY FAILURE";
}

export function computeGhShadowPerformanceReport(
  tradesIn: GhShadowTrade[]
): GhShadowPerformanceReport {
  const trades = tradesIn.filter(
    (t) =>
      t.dataQuality === "FORMAL_ELIGIBLE" &&
      t.status === "CLOSED" &&
      t.entryPrice != null &&
      t.entryPrice > 0 &&
      t.simulatedNetPnlEur != null &&
      Number.isFinite(t.simulatedNetPnlEur)
  );

  const nets = trades.map((t) => t.simulatedNetPnlEur!);
  const wins = trades.filter((t) => (t.simulatedNetPnlEur ?? 0) > 0);
  const losses = trades.filter((t) => (t.simulatedNetPnlEur ?? 0) <= 0);
  const winNets = wins.map((t) => t.simulatedNetPnlEur!);
  const lossNets = losses.map((t) => t.simulatedNetPnlEur!);
  const grossPnlEur = trades.reduce(
    (s, t) => s + (t.simulatedGrossPnlEur ?? 0),
    0
  );
  const frictionEur = trades.reduce(
    (s, t) => s + (t.simulatedFrictionEur ?? 0),
    0
  );
  const netSimulatedPnlEur = nets.reduce((a, b) => a + b, 0);
  const grossWin = winNets.reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(lossNets.reduce((a, b) => a + b, 0));
  const averageWinner = avg(winNets);
  const averageLoser = avg(lossNets);
  const averageWinLossRatio =
    averageWinner != null && averageLoser != null && averageLoser !== 0
      ? Math.abs(averageWinner / averageLoser)
      : null;

  const bySetup = {
    A: setupStats(trades.filter((t) => t.setup === "A")),
    B: setupStats(trades.filter((t) => t.setup === "B")),
    C: setupStats(trades.filter((t) => t.setup === "C"))
  };

  const reasonMap = new Map<string, GhShadowTrade[]>();
  for (const t of trades) {
    const r = String(t.exitReason ?? "other");
    const list = reasonMap.get(r) ?? [];
    list.push(t);
    reasonMap.set(r, list);
  }
  const byExitReason: GhShadowExitReasonStats[] = [...reasonMap.entries()].map(
    ([exitReason, list]) => {
      const w = list.filter((t) => (t.simulatedNetPnlEur ?? 0) > 0);
      const l = list.filter((t) => (t.simulatedNetPnlEur ?? 0) <= 0);
      return {
        exitReason,
        n: list.length,
        wins: w.length,
        losses: l.length,
        net: list.reduce((s, t) => s + (t.simulatedNetPnlEur ?? 0), 0),
        avgMfe: avg(list.map((t) => t.mfe)),
        avgMae: avg(list.map((t) => t.mae))
      };
    }
  );

  // Payoff diagnostics
  const mfeCapture: number[] = [];
  for (const t of wins) {
    if (t.mfe > 0 && t.economic && t.simulatedGrossPnlEur != null) {
      const mfeCash =
        t.mfe * t.economic.economicXauOz * t.economic.valuePerPointPerOzEur;
      if (mfeCash > 0) mfeCapture.push(t.simulatedNetPnlEur! / mfeCash);
    }
  }
  const losersWithMfe = losses.filter((t) => t.mfe > 0);
  const lossSourceHints: string[] = [];
  if (
    averageWinner != null &&
    averageLoser != null &&
    Math.abs(averageLoser) > averageWinner * 3
  ) {
    lossSourceHints.push("asymmetric_payoff_avg_loss_dominates_avg_win");
  }
  const hardN = trades.filter((t) => t.exitReason === "HARD_PROTECTION").length;
  const harvestN = trades.filter((t) => t.exitReason === "HARVEST_FADE").length;
  const trailN = trades.filter((t) => t.exitReason === "TRAIL_HIT").length;
  if (hardN > trades.length * 0.4) {
    lossSourceHints.push("hard_stop_distance_frequent");
  }
  if (harvestN + trailN > 0 && losersWithMfe.length > losses.length * 0.5) {
    lossSourceHints.push("profit_give_back_after_positive_mfe");
  }

  const profitFactor =
    grossLossAbs > 0 ? grossWin / grossLossAbs : wins.length ? Infinity : null;
  const expectancyEurPerTrade =
    trades.length > 0 ? netSimulatedPnlEur / trades.length : null;

  const base = {
    completedTrades: trades.length,
    profitFactor,
    expectancyEurPerTrade,
    netSimulatedPnlEur
  };

  return {
    completedTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    grossPnlEur,
    frictionEur,
    netSimulatedPnlEur,
    profitFactor,
    expectancyEurPerTrade,
    averageWinner,
    averageLoser,
    averageWinLossRatio,
    largestWinner: winNets.length ? Math.max(...winNets) : null,
    largestLoser: lossNets.length ? Math.min(...lossNets) : null,
    maxDrawdown: maxDrawdown(nets),
    averageMfe: avg(trades.map((t) => t.mfe)),
    averageMae: avg(trades.map((t) => t.mae)),
    medianDurationMs: median(
      trades
        .map((t) => t.durationMs)
        .filter((d): d is number => d != null && Number.isFinite(d))
    ),
    bySetup,
    byExitReason,
    payoff: {
      avgWinEur: averageWinner,
      avgLossEur: averageLoser,
      avgWinOverAvgLoss: averageWinLossRatio,
      mfeCaptureRatioWinners: avg(mfeCapture),
      losersWithPriorPositiveMfePct: losses.length
        ? losersWithMfe.length / losses.length
        : null,
      harvestFadePaths: trades
        .filter((t) => t.exitReason === "HARVEST_FADE")
        .map((t) => ({
          tradeId: t.tradeId,
          entry: t.entryPrice!,
          maxFavorable: t.maxFavorableBeforeExit ?? t.mfe,
          exit: t.exitPrice!
        })),
      trailHitPaths: trades
        .filter((t) => t.exitReason === "TRAIL_HIT")
        .map((t) => ({
          tradeId: t.tradeId,
          entry: t.entryPrice!,
          trailActivatedAt: t.trailActivatedAt ?? t.profitLockActivatedAt,
          exit: t.exitPrice!
        })),
      hardProtectionMae: trades
        .filter((t) => t.exitReason === "HARD_PROTECTION")
        .map((t) => ({ tradeId: t.tradeId, mae: t.mae })),
      lossSourceHints
    },
    checkpoint: {
      at50: trades.length >= 50 ? "DATA_QUALITY_ONLY" : "NOT_REACHED",
      at100: trades.length >= 100 ? "EARLY_OBSERVATION" : "NOT_REACHED",
      at250: classifyAt250(base),
      formalDecisionReady: trades.length >= 250
    }
  };
}

export type { GhShadowExitReason };
