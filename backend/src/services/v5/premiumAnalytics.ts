import type {
  V4LockedShadowPlan,
  V4ShadowAnalysisRecord,
  V4ShadowCandidateRecord
} from "../v4/shadowTypes";
import { computeV4ShadowAnalytics } from "../v4/shadowAnalytics";
import { computeLearningInsights } from "./learningEngine";
import type { PremiumAnalytics, PremiumAnalyticsFilters } from "./types";

const sampleWarning = (n: number): string => {
  if (n < 20) return `Extremely small sample (n=${n}). Do not treat rates as meaningful.`;
  if (n < 50) return `Small sample (n=${n}). Preliminary only.`;
  if (n < 100) return `Preliminary sample (n=${n}). Still not proof.`;
  return `Sample n=${n} is more meaningful but still not proof of future performance.`;
};

export function computePremiumAnalytics(input: {
  filters: PremiumAnalyticsFilters;
  analyses: V4ShadowAnalysisRecord[];
  candidates: V4ShadowCandidateRecord[];
  plans: V4LockedShadowPlan[];
}): PremiumAnalytics {
  let plans = input.plans.filter((p) => p.environment === input.filters.environment);
  let analyses = input.analyses.filter((a) => a.environment === input.filters.environment);
  let candidates = input.candidates.filter((c) => c.environment === input.filters.environment);

  if (input.filters.strategy) {
    plans = plans.filter((p) => p.strategyFamily === input.filters.strategy);
  }
  if (input.filters.direction) {
    plans = plans.filter((p) => p.direction === input.filters.direction);
  }
  if (input.filters.session) {
    plans = plans.filter((p) => p.session === input.filters.session);
  }
  if (input.filters.regime) {
    plans = plans.filter((p) => p.regime === input.filters.regime);
  }

  const base = computeV4ShadowAnalytics({
    environment: input.filters.environment,
    analyses,
    candidates,
    plans
  });
  const learning = computeLearningInsights({
    environment: input.filters.environment,
    plans
  });

  const resolved = plans.filter((p) =>
    ["TP1_HIT", "TP2_HIT", "TP3_HIT", "LOSS_SL", "AMBIGUOUS_WORST_CASE_SL"].includes(p.status)
  );
  const wins = resolved.filter((p) => (p.netR ?? 0) > 0);
  const losses = resolved.filter((p) => (p.netR ?? 0) < 0);
  const hold = resolved
    .map((p) => p.barsInTrade)
    .filter((n): n is number => typeof n === "number");

  const riskBuckets = [
    { bucket: "<1.5 (unsafe)", count: 0 },
    { bucket: "1.5–3", count: 0 },
    { bucket: "3–6", count: 0 },
    { bucket: "6+", count: 0 }
  ];
  for (const p of plans) {
    const r = p.riskDistance;
    if (r < 1.5) riskBuckets[0]!.count += 1;
    else if (r < 3) riskBuckets[1]!.count += 1;
    else if (r < 6) riskBuckets[2]!.count += 1;
    else riskBuckets[3]!.count += 1;
  }

  return {
    filters: input.filters,
    totalAnalyses: base.totalAnalyses,
    candidates: base.candidates,
    rejected: base.rejectedCandidates,
    rejectionReasons: base.rejectionReasons,
    shadowPlans: base.validatedShadowPlans,
    wins: wins.length,
    losses: losses.length,
    expectancyR: base.netExpectancyR,
    profitFactor: base.profitFactor,
    averageWinR:
      wins.length > 0
        ? Math.round(
            (wins.reduce((a, p) => a + (p.netR ?? 0), 0) / wins.length) * 100
          ) / 100
        : null,
    averageLossR:
      losses.length > 0
        ? Math.round(
            (losses.reduce((a, p) => a + (p.netR ?? 0), 0) / losses.length) * 100
          ) / 100
        : null,
    maxDrawdownR: base.maxDrawdownR,
    averageHoldBars:
      hold.length > 0
        ? Math.round((hold.reduce((a, b) => a + b, 0) / hold.length) * 100) / 100
        : null,
    averageMfe: base.averageMfe,
    averageMae: base.averageMae,
    riskDistanceDistribution: riskBuckets,
    strategyComparison: learning.byStrategy,
    sessionComparison: learning.bySession,
    directionComparison: learning.byDirection,
    regimeComparison: learning.byRegime,
    sampleSize: base.sampleSize,
    sampleSizeWarning: sampleWarning(base.sampleSize),
    unsafePlanCount: base.unsafePlanCount,
    planMutationCount: base.planMutationCount,
    actionable: false
  };
}
