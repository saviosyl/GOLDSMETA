import type { SetupRecord, SetupResolution } from "../../models/setup";

export interface SetupAnalyticsSummary {
  environment: "LIVE" | "TEST";
  sampleSize: number;
  sampleSizeWarning: string | null;
  totalSetups: number;
  activeSetups: number;
  completedSetups: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  cancelled: number;
  ambiguous: number;
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
  byDirection: { BUY: number; SELL: number };
  bySession: Record<string, number>;
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

/**
 * LIVE and TEST must never be combined — call once per environment.
 */
export const computeSetupAnalytics = (
  setups: SetupRecord[],
  environment: "LIVE" | "TEST"
): SetupAnalyticsSummary => {
  const scoped = setups.filter(
    (s) => s.environment === environment || (environment === "TEST" && s.isTestSetup)
  );
  const completed = scoped.filter((s) => s.resolution !== "OPEN");
  const wins = completed.filter((s) => WIN.includes(s.outcome.rawResolution));
  const losses = completed.filter((s) => LOSS.includes(s.outcome.rawResolution));
  const be = completed.filter((s) => s.outcome.rawResolution === "BREAKEVEN");
  const expired = completed.filter((s) => s.outcome.rawResolution === "EXPIRED");
  const cancelled = completed.filter((s) =>
    s.outcome.rawResolution === "CANCELLED" || s.outcome.rawResolution === "INVALIDATED"
  );
  const ambiguous = completed.filter((s) => s.outcome.rawResolution === "AMBIGUOUS_WORST_CASE_SL");
  const rValues = completed
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
  const sampleSizeWarning =
    sampleSize < 30
      ? `Small sample (n=${sampleSize}). Do not treat rates as statistically significant.`
      : null;

  const bySession: Record<string, number> = {};
  for (const s of scoped) {
    const key = s.session ?? "UNKNOWN";
    bySession[key] = (bySession[key] ?? 0) + 1;
  }

  return {
    environment,
    sampleSize,
    sampleSizeWarning,
    totalSetups: scoped.length,
    activeSetups: scoped.filter((s) => s.resolution === "OPEN").length,
    completedSetups: completed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: be.length,
    expired: expired.length,
    cancelled: cancelled.length,
    ambiguous: ambiguous.length,
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
      scoped.filter((s) => s.entryTriggeredAt).length
    ),
    tp2HitRate: rate(
      scoped.filter((s) => s.statusHistory.some((t) => t.to === "TP2_HIT")).length,
      scoped.filter((s) => s.entryTriggeredAt).length
    ),
    tp3HitRate: rate(
      scoped.filter((s) => s.statusHistory.some((t) => t.to === "TP3_HIT")).length,
      scoped.filter((s) => s.entryTriggeredAt).length
    ),
    slHitRate: rate(
      scoped.filter((s) => s.outcome.rawResolution === "LOSS_SL" || s.outcome.rawResolution === "AMBIGUOUS_WORST_CASE_SL")
        .length,
      scoped.filter((s) => s.entryTriggeredAt).length
    ),
    averageMfe: avg(
      scoped.map((s) => s.excursion.mfe).filter((v): v is number => typeof v === "number")
    ),
    averageMae: avg(
      scoped.map((s) => s.excursion.mae).filter((v): v is number => typeof v === "number")
    ),
    expectancyR: avg(rValues),
    byDirection: {
      BUY: scoped.filter((s) => s.direction === "BUY").length,
      SELL: scoped.filter((s) => s.direction === "SELL").length
    },
    bySession
  };
};
