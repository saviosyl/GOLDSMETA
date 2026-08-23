import type { V4ShadowAnalytics, V4LockedShadowPlan, V4ShadowAnalysisRecord, V4ShadowCandidateRecord } from "./shadowTypes";

const sampleBand = (
  n: number
): Pick<V4ShadowAnalytics, "sampleSizeBand" | "sampleSizeWarning"> => {
  if (n < 20) {
    return {
      sampleSizeBand: "extremely_small",
      sampleSizeWarning: `Extremely small sample (n=${n}). Do not treat rates as meaningful.`
    };
  }
  if (n < 50) {
    return {
      sampleSizeBand: "small",
      sampleSizeWarning: `Small sample (n=${n}). Results are preliminary — not proof of future performance.`
    };
  }
  if (n < 100) {
    return {
      sampleSizeBand: "preliminary",
      sampleSizeWarning: `Preliminary sample (n=${n}). Still not proof of future performance.`
    };
  }
  return {
    sampleSizeBand: "meaningful",
    sampleSizeWarning: `Sample n=${n} is more meaningful but still not proof of future performance.`
  };
};

const resolvedStatuses = new Set([
  "TP1_HIT",
  "TP2_HIT",
  "TP3_HIT",
  "LOSS_SL",
  "AMBIGUOUS_WORST_CASE_SL"
]);

export function computeV4ShadowAnalytics(input: {
  environment: "LIVE" | "TEST";
  analyses: V4ShadowAnalysisRecord[];
  candidates: V4ShadowCandidateRecord[];
  plans: V4LockedShadowPlan[];
}): V4ShadowAnalytics {
  const analyses = input.analyses.filter((a) => a.environment === input.environment);
  const candidates = input.candidates.filter((c) => c.environment === input.environment);
  const plans = input.plans.filter((p) => p.environment === input.environment);

  const resolved = plans.filter((p) => resolvedStatuses.has(p.status));
  const nets = resolved.map((p) => p.netR).filter((n): n is number => n != null);
  const gross = resolved.map((p) => p.grossR).filter((n): n is number => n != null);
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(losses.reduce((a, b) => a + b, 0));

  let peak = 0;
  let eq = 0;
  let maxDd = 0;
  let streak = 0;
  let maxStreak = 0;
  for (const r of nets) {
    eq += r;
    peak = Math.max(peak, eq);
    maxDd = Math.min(maxDd, eq - peak);
    if (r < 0) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else streak = 0;
  }

  const rejectionReasons: Record<string, number> = {};
  for (const a of analyses) {
    for (const r of a.rejectionReasons) {
      rejectionReasons[r] = (rejectionReasons[r] ?? 0) + 1;
    }
  }
  for (const c of candidates) {
    if (c.cancelReason) {
      rejectionReasons[c.cancelReason] = (rejectionReasons[c.cancelReason] ?? 0) + 1;
    }
  }

  const byStrategy: Record<string, number> = {};
  const bySession: Record<string, number> = {};
  const byRegime: Record<string, number> = {};
  const byDirection = { BUY: 0, SELL: 0 };
  for (const p of plans) {
    byStrategy[p.strategyFamily] = (byStrategy[p.strategyFamily] ?? 0) + 1;
    bySession[p.session] = (bySession[p.session] ?? 0) + 1;
    byRegime[p.regime] = (byRegime[p.regime] ?? 0) + 1;
    byDirection[p.direction] += 1;
  }

  const mfes = resolved.map((p) => p.mfe).filter((n): n is number => n != null);
  const maes = resolved.map((p) => p.mae).filter((n): n is number => n != null);
  const band = sampleBand(resolved.length);

  return {
    strategyVersion: "4",
    mode: "SHADOW",
    environment: input.environment,
    sampleSize: resolved.length,
    ...band,
    totalAnalyses: analyses.length,
    buyBias: analyses.filter((a) => a.bias === "BUY_BIAS").length,
    sellBias: analyses.filter((a) => a.bias === "SELL_BIAS").length,
    neutralWait: analyses.filter((a) => a.bias === "NEUTRAL").length,
    candidates: candidates.length,
    rejectedCandidates: candidates.filter((c) => c.status === "CANCELLED" || c.status === "EXPIRED")
      .length,
    rejectionReasons,
    validatedShadowPlans: plans.length,
    entriesTriggered: plans.filter((p) => p.entryTriggeredAt != null).length,
    expiredBeforeEntry: plans.filter((p) => p.status === "EXPIRED" && p.entryTriggeredAt == null)
      .length,
    tp1: plans.filter((p) => p.status === "TP1_HIT").length,
    tp2: plans.filter((p) => p.status === "TP2_HIT").length,
    tp3: plans.filter((p) => p.status === "TP3_HIT").length,
    stopLosses: plans.filter((p) => p.status === "LOSS_SL").length,
    ambiguous: plans.filter((p) => p.status === "AMBIGUOUS_WORST_CASE_SL").length,
    grossExpectancyR:
      gross.length > 0
        ? Math.round((gross.reduce((a, b) => a + b, 0) / gross.length) * 100) / 100
        : null,
    netExpectancyR:
      nets.length > 0 ? Math.round((nets.reduce((a, b) => a + b, 0) / nets.length) * 100) / 100 : null,
    profitFactor: grossLossAbs > 0 ? Math.round((grossWin / grossLossAbs) * 100) / 100 : null,
    maxDrawdownR: Math.round(maxDd * 100) / 100,
    maxLosingStreak: maxStreak,
    averageMfe:
      mfes.length > 0 ? Math.round((mfes.reduce((a, b) => a + b, 0) / mfes.length) * 100) / 100 : null,
    averageMae:
      maes.length > 0 ? Math.round((maes.reduce((a, b) => a + b, 0) / maes.length) * 100) / 100 : null,
    byStrategy,
    byDirection,
    bySession,
    byRegime,
    unsafePlanCount: plans.filter((p) => p.riskDistance < 1.5).length,
    planMutationCount: plans.reduce((a, p) => a + p.mutationAttempts, 0),
    gcUnavailableCount: analyses.filter((a) => a.gcConfirmation === "UNAVAILABLE").length
  };
}
