/**
 * Formal performance + payoff diagnostics for clean shadow trades only.
 * formalDecisionReady requires LIVE_REPLAY_OK + integrity clean.
 */
import type {
  GhShadowExitReason,
  GhShadowIntegrityCounters,
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "./types";

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

/** Prefer EUR net when available; else quote net (still formal for counts). */
function formalNet(t: GhShadowTrade): number | null {
  if (t.eurPnlAvailable && t.simulatedNetPnlEur != null) {
    return t.simulatedNetPnlEur;
  }
  if (t.simulatedNetPnlQuote != null && Number.isFinite(t.simulatedNetPnlQuote)) {
    return t.simulatedNetPnlQuote;
  }
  return null;
}

export type GhShadowSetupStats = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  netPnl: number;
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
  avgWin: number | null;
  avgLoss: number | null;
  avgWinOverAvgLoss: number | null;
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
  pnlUnitNote: string;
};

export type GhShadowPerformanceReport = {
  qualificationId: string | null;
  completedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossPnl: number;
  friction: number;
  netSimulatedPnl: number;
  eurPnlTrades: number;
  quoteOnlyPnlTrades: number;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
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
  integrity: GhShadowIntegrityCounters | null;
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
    .map(formalNet)
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
    netPnl: net
  };
}

function integrityClean(epoch: GhShadowQualificationEpoch | null): boolean {
  if (!epoch) return false;
  if (epoch.status === "DATA_QUALITY_FAILED") return false;
  if (epoch.dataIntegrityFailure) return false;
  if (epoch.integrity.eventsDropped > 0) return false;
  if (epoch.integrity.receiveSeqGaps > 0) return false;
  if (epoch.integrity.journalOverflowCount > 0) return false;
  return true;
}

export function computeGhShadowPerformanceReport(
  tradesIn: GhShadowTrade[],
  epoch: GhShadowQualificationEpoch | null
): GhShadowPerformanceReport {
  const qid = epoch?.qualificationId ?? null;
  const trades = tradesIn.filter(
    (t) =>
      (qid == null || t.qualificationId === qid) &&
      t.dataQuality === "FORMAL_ELIGIBLE" &&
      t.status === "CLOSED" &&
      t.entryPrice != null &&
      t.entryPrice > 0 &&
      formalNet(t) != null
  );

  const nets = trades.map((t) => formalNet(t)!);
  const wins = trades.filter((t) => (formalNet(t) ?? 0) > 0);
  const losses = trades.filter((t) => (formalNet(t) ?? 0) <= 0);
  const winNets = wins.map((t) => formalNet(t)!);
  const lossNets = losses.map((t) => formalNet(t)!);

  const eurTrades = trades.filter((t) => t.eurPnlAvailable);
  const quoteOnly = trades.filter((t) => !t.eurPnlAvailable);

  const grossPnl = trades.reduce(
    (s, t) =>
      s +
      (t.eurPnlAvailable
        ? t.simulatedGrossPnlEur ?? 0
        : t.simulatedGrossPnlQuote ?? 0),
    0
  );
  const friction = trades.reduce(
    (s, t) =>
      s +
      (t.eurPnlAvailable
        ? t.simulatedFrictionEur ?? 0
        : t.simulatedFrictionPnlQuote ?? 0),
    0
  );
  const netSimulatedPnl = nets.reduce((a, b) => a + b, 0);
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
      const w = list.filter((t) => (formalNet(t) ?? 0) > 0);
      const l = list.filter((t) => (formalNet(t) ?? 0) <= 0);
      return {
        exitReason,
        n: list.length,
        wins: w.length,
        losses: l.length,
        net: list.reduce((s, t) => s + (formalNet(t) ?? 0), 0),
        avgMfe: avg(list.map((t) => t.mfe)),
        avgMae: avg(list.map((t) => t.mae))
      };
    }
  );

  const mfeCapture: number[] = [];
  for (const t of wins) {
    if (t.mfe > 0 && t.economic) {
      const mfeCash = t.mfe * t.economic.displayedLots * t.economic.ozPerLot;
      const net = formalNet(t);
      if (mfeCash > 0 && net != null) mfeCapture.push(net / mfeCash);
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

  const profitFactor =
    grossLossAbs > 0 ? grossWin / grossLossAbs : wins.length ? Infinity : null;
  const expectancyPerTrade =
    trades.length > 0 ? netSimulatedPnl / trades.length : null;

  const clean = integrityClean(epoch);
  const replayOk = epoch?.lastReplayStatus === "LIVE_REPLAY_OK";
  const n = trades.length;

  let at250: GhShadowPerformanceReport["checkpoint"]["at250"] = "NOT_REACHED";
  let formalDecisionReady = false;
  if (n >= 250) {
    if (!clean || !replayOk) {
      at250 = "INSUFFICIENT / DATA QUALITY FAILURE";
      formalDecisionReady = false;
    } else if (
      profitFactor != null &&
      expectancyPerTrade != null &&
      netSimulatedPnl > 0 &&
      profitFactor >= 1.15 &&
      expectancyPerTrade > 0
    ) {
      at250 = "PROMISING — CONTINUE TO 500";
      formalDecisionReady = true;
    } else if (netSimulatedPnl < 0 || (profitFactor != null && profitFactor < 1)) {
      at250 = "NEGATIVE EDGE — STRATEGY REDESIGN REQUIRED";
      formalDecisionReady = true;
    } else {
      at250 = "INSUFFICIENT / DATA QUALITY FAILURE";
      formalDecisionReady = false;
    }
  }

  return {
    qualificationId: qid,
    completedTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    grossPnl,
    friction,
    netSimulatedPnl,
    eurPnlTrades: eurTrades.length,
    quoteOnlyPnlTrades: quoteOnly.length,
    profitFactor,
    expectancyPerTrade,
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
      avgWin: averageWinner,
      avgLoss: averageLoser,
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
      lossSourceHints,
      pnlUnitNote:
        eurTrades.length === trades.length
          ? "EUR (quoteToDeposit applied)"
          : quoteOnly.length === trades.length
            ? "QUOTE currency only (EUR unavailable)"
            : "MIXED EUR + quote"
    },
    integrity: epoch?.integrity ?? null,
    checkpoint: {
      at50: n >= 50 ? "DATA_QUALITY_ONLY" : "NOT_REACHED",
      at100: n >= 100 ? "EARLY_OBSERVATION" : "NOT_REACHED",
      at250,
      formalDecisionReady
    }
  };
}

export type { GhShadowExitReason };
