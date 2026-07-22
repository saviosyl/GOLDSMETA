import type { V4LockedShadowPlan } from "../v4/shadowTypes";
import type { LearningBucketStat, LearningInsights } from "./types";

const sampleWarning = (n: number): string => {
  if (n < 20) return `Extremely small sample (n=${n}). Do not treat rates as meaningful.`;
  if (n < 50) return `Small sample (n=${n}). Preliminary only.`;
  if (n < 100) return `Preliminary sample (n=${n}). Still not proof.`;
  return `Sample n=${n} is more meaningful but still not proof of future performance.`;
};

function bucketStats(
  key: string,
  plans: V4LockedShadowPlan[]
): LearningBucketStat {
  const resolved = plans.filter((p) =>
    ["TP1_HIT", "TP2_HIT", "TP3_HIT", "LOSS_SL", "AMBIGUOUS_WORST_CASE_SL"].includes(p.status)
  );
  const nets = resolved.map((p) => p.netR).filter((n): n is number => n != null);
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n < 0);
  const winSum = wins.reduce((a, b) => a + b, 0);
  const lossAbs = Math.abs(losses.reduce((a, b) => a + b, 0));
  return {
    key,
    sampleSize: resolved.length,
    wins: wins.length,
    losses: losses.length,
    profitFactor: lossAbs > 0 ? Math.round((winSum / lossAbs) * 100) / 100 : null,
    netExpectancyR:
      nets.length > 0 ? Math.round((nets.reduce((a, b) => a + b, 0) / nets.length) * 100) / 100 : null,
    averageWinR:
      wins.length > 0 ? Math.round((wins.reduce((a, b) => a + b, 0) / wins.length) * 100) / 100 : null,
    averageLossR:
      losses.length > 0
        ? Math.round((losses.reduce((a, b) => a + b, 0) / losses.length) * 100) / 100
        : null,
    sampleWarning: sampleWarning(resolved.length)
  };
}

function groupBy(
  plans: V4LockedShadowPlan[],
  keyFn: (p: V4LockedShadowPlan) => string
): LearningBucketStat[] {
  const map = new Map<string, V4LockedShadowPlan[]>();
  for (const p of plans) {
    const k = keyFn(p);
    const list = map.get(k) ?? [];
    list.push(p);
    map.set(k, list);
  }
  return [...map.entries()]
    .map(([k, list]) => bucketStats(k, list))
    .sort((a, b) => b.sampleSize - a.sampleSize);
}

/**
 * Personal learning engine — statistics & insights only.
 * Does NOT self-modify trading rules.
 */
export function computeLearningInsights(input: {
  environment: "LIVE" | "TEST";
  plans: V4LockedShadowPlan[];
}): LearningInsights {
  const plans = input.plans.filter((p) => p.environment === input.environment);
  const resolved = plans.filter((p) =>
    ["TP1_HIT", "TP2_HIT", "TP3_HIT", "LOSS_SL", "AMBIGUOUS_WORST_CASE_SL"].includes(p.status)
  );

  const byStrategy = groupBy(plans, (p) => p.strategyFamily);
  const byDirection = groupBy(plans, (p) => p.direction);
  const bySession = groupBy(plans, (p) => p.session || "UNKNOWN");
  const byRegime = groupBy(plans, (p) => p.regime || "UNKNOWN");
  const byDayOfWeek = groupBy(plans, (p) => {
    const d = new Date(p.createdAt);
    return Number.isFinite(d.getTime())
      ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]!
      : "UNKNOWN";
  });
  const byHour = groupBy(plans, (p) => {
    const d = new Date(p.createdAt);
    return Number.isFinite(d.getTime()) ? `${String(d.getUTCHours()).padStart(2, "0")}:00Z` : "UNKNOWN";
  });

  const insights: string[] = [];
  if (resolved.length === 0) {
    insights.push("Insufficient verified resolved shadow plans for learning insights.");
  } else {
    const bestSession = [...bySession].sort(
      (a, b) => (b.profitFactor ?? 0) - (a.profitFactor ?? 0)
    )[0];
    const worstSession = [...bySession].sort(
      (a, b) => (a.profitFactor ?? 99) - (b.profitFactor ?? 99)
    )[0];
    if (bestSession && bestSession.sampleSize > 0) {
      insights.push(
        `Best session bucket by PF (verified): ${bestSession.key} PF=${bestSession.profitFactor ?? "n/a"} (n=${bestSession.sampleSize}). ${bestSession.sampleWarning}`
      );
    }
    if (worstSession && worstSession.key !== bestSession?.key) {
      insights.push(
        `Weakest session bucket by PF (verified): ${worstSession.key} PF=${worstSession.profitFactor ?? "n/a"} (n=${worstSession.sampleSize}).`
      );
    }
    insights.push("Learning engine stores statistics only — it does not modify V4 rules.");
  }

  return {
    strategyVersion: "4",
    mode: "SHADOW",
    environment: input.environment,
    resolvedSample: resolved.length,
    byStrategy,
    byDirection,
    bySession,
    byRegime,
    byDayOfWeek,
    byHour,
    insights,
    disclaimer:
      "Insights are descriptive statistics from shadow plans. Not advice. Rules are not auto-modified.",
    selfModifiesRules: false
  };
}
