import type { SetupRecord, SetupResolution } from "../../models/setup";

export interface SetupAnalyticsSummary {
  environment: "LIVE" | "TEST";
  sampleSize: number;
  sampleSizeWarning: string | null;
  sampleSizeBand: "extremely_small" | "small" | "preliminary" | "meaningful";
  totalSetups: number;
  activeSetups: number;
  completedSetups: number;
  entriesTriggered: number;
  expiredBeforeEntry: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  cancelled: number;
  ambiguous: number;
  tp1Hits: number;
  tp2Hits: number;
  tp3Hits: number;
  stopped: number;
  winRate: number | null;
  lossRate: number | null;
  averageR: number | null;
  medianR: number | null;
  cumulativeR: number;
  profitFactorR: number | null;
  averageBarsToEntry: number | null;
  averageBarsToResolution: number | null;
  tp1HitRate: number | null;
  tp2HitRate: number | null;
  tp3HitRate: number | null;
  slHitRate: number | null;
  averageMfe: number | null;
  averageMae: number | null;
  expectancyR: number | null;
  maxLosingStreak: number;
  maxDrawdownR: number;
  byDirection: { BUY: number; SELL: number };
  bySession: Record<string, number>;
  byDayOfWeek: Record<string, number>;
  byConfidenceBand: Record<string, number>;
  /** Manual journal summary — never mixed into system R metrics. */
  manual: {
    entered: number;
    skipped: number;
    withPnl: number;
    totalManualPnl: number | null;
  };
}

const WIN: SetupResolution[] = ["WIN_TP1", "WIN_TP2", "WIN_TP3"];
const LOSS: SetupResolution[] = ["LOSS_SL", "AMBIGUOUS_WORST_CASE_SL"];

const avg = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? Math.round((((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2) * 100) / 100
    : (s[mid] ?? null);
};

const rate = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 1000) / 10;

const sampleBand = (
  n: number
): { band: SetupAnalyticsSummary["sampleSizeBand"]; warning: string | null } => {
  if (n < 20) {
    return {
      band: "extremely_small",
      warning: `Extremely small sample (n=${n}). Do not treat rates as meaningful.`
    };
  }
  if (n < 50) {
    return {
      band: "small",
      warning: `Small sample (n=${n}). Results are preliminary — not proof of future performance.`
    };
  }
  if (n < 100) {
    return {
      band: "preliminary",
      warning: `Preliminary sample (n=${n}). Still not proof of future performance.`
    };
  }
  return {
    band: "meaningful",
    warning: `Sample n=${n} is more meaningful but still not proof of future performance.`
  };
};

const maxLosingStreak = (completed: SetupRecord[]): number => {
  let streak = 0;
  let max = 0;
  for (const s of [...completed].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (LOSS.includes(s.outcome.rawResolution)) {
      streak += 1;
      max = Math.max(max, streak);
    } else if (WIN.includes(s.outcome.rawResolution)) {
      streak = 0;
    }
  }
  return max;
};

const maxDrawdownR = (rValuesChrono: number[]): number => {
  let peak = 0;
  let equity = 0;
  let dd = 0;
  for (const r of rValuesChrono) {
    equity += r;
    peak = Math.max(peak, equity);
    dd = Math.min(dd, equity - peak);
  }
  return Math.round(Math.abs(dd) * 100) / 100;
};

const confidenceBand = (c: number): string => {
  if (c < 50) return "0-49";
  if (c < 70) return "50-69";
  if (c < 85) return "70-84";
  return "85-100";
};

const dayOfWeek = (iso: string): string => {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[new Date(iso).getUTCDay()] ?? "Unknown";
};

/**
 * LIVE and TEST must never be combined — call once per environment.
 * System R metrics ignore manualExecution journal fields.
 */
export const computeSetupAnalytics = (
  setups: SetupRecord[],
  environment: "LIVE" | "TEST"
): SetupAnalyticsSummary => {
  const scoped = setups.filter(
    (s) => s.environment === environment || (environment === "TEST" && s.isTestSetup)
  );
  const completed = scoped.filter((s) => s.resolution !== "OPEN");
  const entriesTriggered = scoped.filter((s) => s.entryTriggeredAt != null);
  const expiredBeforeEntry = completed.filter(
    (s) => s.outcome.rawResolution === "EXPIRED" && !s.entryTriggeredAt
  );
  const wins = completed.filter((s) => WIN.includes(s.outcome.rawResolution));
  const losses = completed.filter((s) => LOSS.includes(s.outcome.rawResolution));
  const be = completed.filter((s) => s.outcome.rawResolution === "BREAKEVEN");
  const expired = completed.filter((s) => s.outcome.rawResolution === "EXPIRED");
  const cancelled = completed.filter(
    (s) => s.outcome.rawResolution === "CANCELLED" || s.outcome.rawResolution === "INVALIDATED"
  );
  const ambiguous = completed.filter((s) => s.outcome.rawResolution === "AMBIGUOUS_WORST_CASE_SL");
  const rValues = completed
    .map((s) => s.outcome.rawRealisedR)
    .filter((v): v is number => typeof v === "number");
  const chronoR = [...completed]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((s) => s.outcome.rawRealisedR)
    .filter((v): v is number => typeof v === "number");
  const winRs = wins.map((s) => s.outcome.rawRealisedR).filter((v): v is number => typeof v === "number");
  const lossRs = losses
    .map((s) => Math.abs(s.outcome.rawRealisedR ?? 0))
    .filter((v) => v > 0);
  const grossWin = winRs.reduce((a, b) => a + b, 0);
  const grossLoss = lossRs.reduce((a, b) => a + b, 0);
  const cumulativeR = Math.round(rValues.reduce((a, b) => a + b, 0) * 100) / 100;

  const sampleSize = completed.length;
  const { band, warning } = sampleBand(sampleSize);

  const bySession: Record<string, number> = {};
  const byDayOfWeek: Record<string, number> = {};
  const byConfidenceBand: Record<string, number> = {};
  for (const s of scoped) {
    const key = s.session ?? "UNKNOWN";
    bySession[key] = (bySession[key] ?? 0) + 1;
    const dow = dayOfWeek(s.createdAt);
    byDayOfWeek[dow] = (byDayOfWeek[dow] ?? 0) + 1;
    const bandKey = confidenceBand(s.confidence ?? 0);
    byConfidenceBand[bandKey] = (byConfidenceBand[bandKey] ?? 0) + 1;
  }

  const manualEntered = scoped.filter((s) => s.manualExecution?.action === "ENTERED" || s.manualExecution?.action === "ENTERED_LATE");
  const manualSkipped = scoped.filter(
    (s) =>
      s.manualExecution &&
      s.manualExecution.action !== "ENTERED" &&
      s.manualExecution.action !== "ENTERED_LATE"
  );
  const manualPnls = scoped
    .map((s) => s.manualExecution?.actualPnl)
    .filter((v): v is number => typeof v === "number");

  const enteredCount = entriesTriggered.length;

  return {
    environment,
    sampleSize,
    sampleSizeWarning: warning,
    sampleSizeBand: band,
    totalSetups: scoped.length,
    activeSetups: scoped.filter((s) => s.resolution === "OPEN").length,
    completedSetups: completed.length,
    entriesTriggered: enteredCount,
    expiredBeforeEntry: expiredBeforeEntry.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: be.length,
    expired: expired.length,
    cancelled: cancelled.length,
    ambiguous: ambiguous.length,
    tp1Hits: scoped.filter((s) => s.statusHistory.some((t) => t.to === "TP1_HIT")).length,
    tp2Hits: scoped.filter((s) => s.statusHistory.some((t) => t.to === "TP2_HIT")).length,
    tp3Hits: scoped.filter((s) => s.statusHistory.some((t) => t.to === "TP3_HIT")).length,
    stopped: losses.length,
    winRate: rate(wins.length, completed.length),
    lossRate: rate(losses.length, completed.length),
    averageR: avg(rValues),
    medianR: median(rValues),
    cumulativeR,
    profitFactorR: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    averageBarsToEntry: avg(
      scoped.map((s) => s.barsToEntry).filter((v): v is number => typeof v === "number")
    ),
    averageBarsToResolution: avg(
      completed.map((s) => s.barsToResolution).filter((v): v is number => typeof v === "number")
    ),
    tp1HitRate: rate(
      scoped.filter((s) => s.statusHistory.some((t) => t.to === "TP1_HIT")).length,
      enteredCount
    ),
    tp2HitRate: rate(
      scoped.filter((s) => s.statusHistory.some((t) => t.to === "TP2_HIT")).length,
      enteredCount
    ),
    tp3HitRate: rate(
      scoped.filter((s) => s.statusHistory.some((t) => t.to === "TP3_HIT")).length,
      enteredCount
    ),
    slHitRate: rate(
      scoped.filter(
        (s) =>
          s.outcome.rawResolution === "LOSS_SL" || s.outcome.rawResolution === "AMBIGUOUS_WORST_CASE_SL"
      ).length,
      enteredCount
    ),
    averageMfe: avg(
      scoped.map((s) => s.excursion.mfe).filter((v): v is number => typeof v === "number")
    ),
    averageMae: avg(
      scoped.map((s) => s.excursion.mae).filter((v): v is number => typeof v === "number")
    ),
    expectancyR: avg(rValues),
    maxLosingStreak: maxLosingStreak(completed),
    maxDrawdownR: maxDrawdownR(chronoR),
    byDirection: {
      BUY: scoped.filter((s) => s.direction === "BUY").length,
      SELL: scoped.filter((s) => s.direction === "SELL").length
    },
    bySession,
    byDayOfWeek,
    byConfidenceBand,
    manual: {
      entered: manualEntered.length,
      skipped: manualSkipped.length,
      withPnl: manualPnls.length,
      totalManualPnl:
        manualPnls.length === 0
          ? null
          : Math.round(manualPnls.reduce((a, b) => a + b, 0) * 100) / 100
    }
  };
};
