import type {
  V4LockedShadowPlan,
  V4ShadowAnalysisRecord,
  V4ShadowCandidateRecord
} from "../v4/shadowTypes";
import type { ReplaySession } from "./types";

/**
 * Educational replay — step through stored analyses/candidates/plans by bar time.
 * Does not invent candles.
 */
export function buildReplaySession(input: {
  environment: "LIVE" | "TEST";
  analyses: V4ShadowAnalysisRecord[];
  candidates: V4ShadowCandidateRecord[];
  plans: V4LockedShadowPlan[];
  limit?: number;
}): ReplaySession {
  const limit = input.limit ?? 40;
  const analyses = [...input.analyses]
    .filter((a) => a.environment === input.environment)
    .sort((a, b) => a.barTime.localeCompare(b.barTime))
    .slice(-limit);

  if (!analyses.length) {
    return {
      sessionId: `replay-empty-${input.environment}`,
      environment: input.environment,
      frames: [],
      educationalOnly: true,
      insufficientData: true,
      disclaimer: "Insufficient verified historical analyses for replay."
    };
  }

  const frames = analyses.map((a) => {
    const cand = input.candidates.find((c) => c.parentAnalysisId === a.analysisId) ?? null;
    const plan =
      input.plans.find((p) => p.parentDecisionId === a.parentDecisionId) ??
      input.plans.find((p) => p.barTime === a.barTime) ??
      null;
    return {
      barTime: a.barTime,
      analysisSummary: `${a.bias} · ${a.regime} · session ${a.session} · rejects=${a.rejectionReasons.slice(0, 2).join(",") || "none"}`,
      candidateStatus: cand ? `${cand.strategyFamily} ${cand.direction} ${cand.status}` : null,
      planStatus: plan ? `${plan.status} ${plan.direction}` : null,
      lifecycleNote: plan
        ? `grossR=${plan.grossR ?? "—"} netR=${plan.netR ?? "—"} mfe=${plan.mfe ?? "—"} mae=${plan.mae ?? "—"}`
        : null,
      result: plan?.resolvedAt ? plan.status : cand?.status ?? a.bias
    };
  });

  return {
    sessionId: `replay-${input.environment}-${analyses[0]!.barTime}-${analyses.at(-1)!.barTime}`,
    environment: input.environment,
    frames,
    educationalOnly: true,
    insufficientData: false,
    disclaimer: "Replay is educational only. Not a trade recommendation. Broker DISABLED."
  };
}
