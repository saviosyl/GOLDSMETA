/**
 * Formal performance — QUOTE USD primary + R-multiple.
 * EUR is supplemental only; never mixed into primary aggregates.
 * formalDecisionReady requires LIVE_REPLAY_OK + integrity clean + replay complete.
 */
import type {
  GhShadowExitReason,
  GhShadowIntegrityCounters,
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "./types";
import {
  computeGhShadowActivityReport,
  type GhShadowActivityClassification,
  type GhShadowActivityReport
} from "./activity";

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

/** Primary formal unit: quote net USD. */
function quoteNet(t: GhShadowTrade): number | null {
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
  profitFactorQuote: number | null;
  expectancyQuote: number | null;
  netPnlQuoteUsd: number;
};

export type GhShadowExitReasonStats = {
  exitReason: string;
  n: number;
  wins: number;
  losses: number;
  netQuoteUsd: number;
  avgMfe: number | null;
  avgMae: number | null;
};

export type GhShadowPayoffDiagnostics = {
  avgWinQuote: number | null;
  avgLossQuote: number | null;
  avgWinOverAvgLoss: number | null;
  /** Same-unit: netQuote / (mfe * lots * oz). */
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
  latency: {
    avgSignalTickPnlQuote: number | null;
    avgNextEventPnlQuote: number | null;
    avgPnl100msQuote: number | null;
    avgPnl250msQuote: number | null;
    avgPnl500msQuote: number | null;
  };
};

export type GhShadowPerformanceReport = {
  qualificationId: string | null;
  formalUnit: "QUOTE_USD";
  completedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;

  netPnlQuoteUsd: number;
  profitFactorQuote: number | null;
  expectancyQuote: number | null;
  maxDrawdownQuote: number;
  averageWinnerQuote: number | null;
  averageLoserQuote: number | null;
  averageWinLossRatio: number | null;
  largestWinnerQuote: number | null;
  largestLoserQuote: number | null;
  grossPnlQuoteUsd: number;
  frictionQuoteUsd: number;

  netR: number | null;
  expectancyR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;

  netPnlEur: number | null;
  eurCoveragePct: number;
  eurAuthoritative: boolean;

  averageMfe: number | null;
  averageMae: number | null;
  medianDurationMs: number | null;
  bySetup: Record<"A" | "B" | "C", GhShadowSetupStats>;
  byExitReason: GhShadowExitReasonStats[];
  payoff: GhShadowPayoffDiagnostics;
  integrity: GhShadowIntegrityCounters | null;
  activity: GhShadowActivityReport;
  checkpoint: {
    at50: "DATA_QUALITY_ONLY" | "NOT_REACHED";
    at100: "EARLY_OBSERVATION" | "NOT_REACHED";
    at250:
      | "PROMISING — CONTINUE TO 500"
      | "NEGATIVE EDGE — STRATEGY REDESIGN REQUIRED"
      | "INSUFFICIENT / DATA QUALITY FAILURE"
      | "NOT_REACHED";
    edgeClassification:
      | "PROMISING"
      | "NEGATIVE"
      | "INSUFFICIENT"
      | "NOT_REACHED";
    activityClassification: GhShadowActivityClassification;
    /** @deprecated Prefer edgeDecisionReady. */
    formalDecisionReady: boolean;
    /**
     * Edge decision gate: 250+ clean + replay OK + integrity clean +
     * edge classification resolved (PROMISING or NEGATIVE).
     */
    edgeDecisionReady: boolean;
    /**
     * Product goal: edgeDecisionReady AND EDGE==PROMISING AND
     * activityClassification==MEETS_DESIRED_OPERATING_CHARACTER.
     */
    productGoalReady: boolean;
    productGoalDetail: string | null;
  };
};

function setupStats(trades: GhShadowTrade[]): GhShadowSetupStats {
  const nets = trades.map(quoteNet).filter((n): n is number => n != null);
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
    profitFactorQuote:
      grossLossAbs > 0 ? grossWin / grossLossAbs : wins.length ? Infinity : null,
    expectancyQuote: trades.length ? net / trades.length : null,
    netPnlQuoteUsd: net
  };
}

function integrityClean(epoch: GhShadowQualificationEpoch | null): boolean {
  if (!epoch) return false;
  if (epoch.status === "DATA_QUALITY_FAILED") return false;
  if (epoch.dataIntegrityFailure) return false;
  if (epoch.persistFailureReason) return false;
  if (epoch.integrity.eventsDropped > 0) return false;
  if (epoch.integrity.receiveSeqGaps > 0) return false;
  if (epoch.integrity.receiveSeqDuplicates > 0) return false;
  if (epoch.integrity.receiveSeqOutOfOrder > 0) return false;
  if (epoch.integrity.journalOverflowCount > 0) return false;
  return true;
}

export function computeGhShadowPerformanceReport(
  tradesIn: GhShadowTrade[],
  epoch: GhShadowQualificationEpoch | null
): GhShadowPerformanceReport {
  const qid = epoch?.qualificationId ?? null;
  const activity = computeGhShadowActivityReport(epoch);
  const trades = tradesIn.filter(
    (t) =>
      (qid == null || t.qualificationId === qid) &&
      t.dataQuality === "FORMAL_ELIGIBLE" &&
      t.status === "CLOSED" &&
      t.entryPrice != null &&
      t.entryPrice > 0 &&
      quoteNet(t) != null
  );

  const nets = trades.map((t) => quoteNet(t)!);
  const wins = trades.filter((t) => (quoteNet(t) ?? 0) > 0);
  const losses = trades.filter((t) => (quoteNet(t) ?? 0) <= 0);
  const winNets = wins.map((t) => quoteNet(t)!);
  const lossNets = losses.map((t) => quoteNet(t)!);
  const rVals = trades
    .map((t) => t.netR)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const winR = wins
    .map((t) => t.netR)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const lossR = losses
    .map((t) => t.netR)
    .filter((n): n is number => n != null && Number.isFinite(n));

  const eurTrades = trades.filter(
    (t) => t.eurPnlAvailable && t.simulatedNetPnlEur != null
  );
  const eurCoveragePct = trades.length
    ? (eurTrades.length / trades.length) * 100
    : 0;
  const eurAuthoritative = trades.length > 0 && eurCoveragePct >= 100;
  const netPnlEur = eurAuthoritative
    ? eurTrades.reduce((s, t) => s + (t.simulatedNetPnlEur ?? 0), 0)
    : null;

  const grossPnlQuoteUsd = trades.reduce(
    (s, t) => s + (t.simulatedGrossPnlQuote ?? 0),
    0
  );
  const frictionQuoteUsd = trades.reduce(
    (s, t) => s + (t.simulatedFrictionPnlQuote ?? 0),
    0
  );
  const netPnlQuoteUsd = nets.reduce((a, b) => a + b, 0);
  const grossWin = winNets.reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(lossNets.reduce((a, b) => a + b, 0));
  const averageWinnerQuote = avg(winNets);
  const averageLoserQuote = avg(lossNets);
  const averageWinLossRatio =
    averageWinnerQuote != null &&
    averageLoserQuote != null &&
    averageLoserQuote !== 0
      ? Math.abs(averageWinnerQuote / averageLoserQuote)
      : null;

  const profitFactorQuote =
    grossLossAbs > 0 ? grossWin / grossLossAbs : wins.length ? Infinity : null;
  const expectancyQuote =
    trades.length > 0 ? netPnlQuoteUsd / trades.length : null;
  const netR = rVals.length ? rVals.reduce((a, b) => a + b, 0) : null;
  const expectancyR = rVals.length ? netR! / rVals.length : null;

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
    ([exitReason, list]) => ({
      exitReason,
      n: list.length,
      wins: list.filter((t) => (quoteNet(t) ?? 0) > 0).length,
      losses: list.filter((t) => (quoteNet(t) ?? 0) <= 0).length,
      netQuoteUsd: list.reduce((s, t) => s + (quoteNet(t) ?? 0), 0),
      avgMfe: avg(list.map((t) => t.mfe)),
      avgMae: avg(list.map((t) => t.mae))
    })
  );

  const mfeCapture: number[] = [];
  for (const t of wins) {
    if (t.mfe > 0 && t.economic && t.simulatedNetPnlQuote != null) {
      const mfeQuote = t.mfe * t.economic.displayedLots * t.economic.ozPerLot;
      if (mfeQuote > 0) mfeCapture.push(t.simulatedNetPnlQuote / mfeQuote);
    }
  }

  const clean = integrityClean(epoch);
  const replayOk = epoch?.lastReplayStatus === "LIVE_REPLAY_OK";
  const n = trades.length;

  let at250: GhShadowPerformanceReport["checkpoint"]["at250"] = "NOT_REACHED";
  let edgeClassification: GhShadowPerformanceReport["checkpoint"]["edgeClassification"] =
    "NOT_REACHED";
  let edgeDecisionReady = false;
  if (n >= 250) {
    if (!clean || !replayOk) {
      at250 = "INSUFFICIENT / DATA QUALITY FAILURE";
      edgeClassification = "INSUFFICIENT";
      edgeDecisionReady = false;
    } else if (
      profitFactorQuote != null &&
      expectancyQuote != null &&
      netPnlQuoteUsd > 0 &&
      profitFactorQuote >= 1.15 &&
      expectancyQuote > 0
    ) {
      at250 = "PROMISING — CONTINUE TO 500";
      edgeClassification = "PROMISING";
      edgeDecisionReady = true;
    } else if (
      netPnlQuoteUsd < 0 ||
      (profitFactorQuote != null && profitFactorQuote < 1)
    ) {
      at250 = "NEGATIVE EDGE — STRATEGY REDESIGN REQUIRED";
      edgeClassification = "NEGATIVE";
      edgeDecisionReady = true;
    } else {
      at250 = "INSUFFICIENT / DATA QUALITY FAILURE";
      edgeClassification = "INSUFFICIENT";
      edgeDecisionReady = false;
    }
  }

  const productGoalReady =
    edgeDecisionReady &&
    edgeClassification === "PROMISING" &&
    activity.activityClassification === "MEETS_DESIRED_OPERATING_CHARACTER";

  let productGoalDetail: string | null = null;
  if (edgeDecisionReady && edgeClassification === "PROMISING" && !productGoalReady) {
    if (activity.activityClassification === "LOW_ACTIVITY") {
      productGoalDetail = "PRODUCT GOAL NOT MET — LOW ACTIVITY";
    } else if (activity.activityClassification === "INSUFFICIENT_ACTIVE_TIME") {
      productGoalDetail = "PRODUCT GOAL NOT MET — INSUFFICIENT ACTIVE TIME";
    } else {
      productGoalDetail = "PRODUCT GOAL NOT MET";
    }
  } else if (productGoalReady) {
    productGoalDetail = "PRODUCT GOAL MET";
  }

  return {
    qualificationId: qid,
    formalUnit: "QUOTE_USD",
    completedTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    netPnlQuoteUsd,
    profitFactorQuote,
    expectancyQuote,
    maxDrawdownQuote: maxDrawdown(nets),
    averageWinnerQuote,
    averageLoserQuote,
    averageWinLossRatio,
    largestWinnerQuote: winNets.length ? Math.max(...winNets) : null,
    largestLoserQuote: lossNets.length ? Math.min(...lossNets) : null,
    grossPnlQuoteUsd,
    frictionQuoteUsd,
    netR,
    expectancyR,
    avgWinR: avg(winR),
    avgLossR: avg(lossR),
    netPnlEur,
    eurCoveragePct,
    eurAuthoritative,
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
      avgWinQuote: averageWinnerQuote,
      avgLossQuote: averageLoserQuote,
      avgWinOverAvgLoss: averageWinLossRatio,
      mfeCaptureRatioWinners: avg(mfeCapture),
      losersWithPriorPositiveMfePct: losses.length
        ? losses.filter((t) => t.mfe > 0).length / losses.length
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
      lossSourceHints: [],
      latency: {
        avgSignalTickPnlQuote: avg(
          trades
            .map((t) => t.latency?.signalTickPnlQuote)
            .filter((n): n is number => n != null)
        ),
        avgNextEventPnlQuote: avg(
          trades
            .map((t) => t.latency?.nextEventPnlQuote)
            .filter((n): n is number => n != null)
        ),
        avgPnl100msQuote: avg(
          trades
            .map((t) => t.latency?.pnl100msQuote)
            .filter((n): n is number => n != null)
        ),
        avgPnl250msQuote: avg(
          trades
            .map((t) => t.latency?.pnl250msQuote)
            .filter((n): n is number => n != null)
        ),
        avgPnl500msQuote: avg(
          trades
            .map((t) => t.latency?.pnl500msQuote)
            .filter((n): n is number => n != null)
        )
      }
    },
    integrity: epoch?.integrity ?? null,
    activity,
    checkpoint: {
      at50: n >= 50 ? "DATA_QUALITY_ONLY" : "NOT_REACHED",
      at100: n >= 100 ? "EARLY_OBSERVATION" : "NOT_REACHED",
      at250,
      edgeClassification,
      activityClassification: activity.activityClassification,
      formalDecisionReady: edgeDecisionReady,
      edgeDecisionReady,
      productGoalReady,
      productGoalDetail
    }
  };
}

export type { GhShadowExitReason };
