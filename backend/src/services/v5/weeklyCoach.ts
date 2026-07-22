import type { V4LockedShadowPlan, V4ShadowAnalysisRecord } from "../v4/shadowTypes";
import type { JournalEntry } from "../../models/types";
import type { WeeklyCoachReport } from "./types";

function startOfUtcWeek(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

/**
 * Weekly AI Coach — rules-based summary from verified data only.
 * Optional LLM narration is off; numbers are never fabricated.
 */
export function buildWeeklyCoachReport(input: {
  nowIso?: string;
  plans: V4LockedShadowPlan[];
  analyses: V4ShadowAnalysisRecord[];
  journal?: JournalEntry[];
}): WeeklyCoachReport {
  const now = new Date(input.nowIso ?? new Date().toISOString());
  const weekStart = startOfUtcWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const inWeek = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= weekStart.getTime() && t <= weekEnd.getTime() + 86400000 - 1;
  };

  const plans = input.plans.filter((p) => inWeek(p.createdAt) || inWeek(p.resolvedAt));
  const analyses = input.analyses.filter((a) => inWeek(a.generatedAt));
  const journal = (input.journal ?? []).filter((j) => inWeek(j.createdAt));

  const resolved = plans.filter((p) =>
    ["TP1_HIT", "TP2_HIT", "TP3_HIT", "LOSS_SL", "AMBIGUOUS_WORST_CASE_SL"].includes(p.status)
  );
  const waits = analyses.filter((a) => a.bias === "NEUTRAL" || a.rejectionReasons.length > 0);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const areas: string[] = [];
  const verifiedFacts: string[] = [
    `Verified analyses this week=${analyses.length}.`,
    `Verified shadow plans touched this week=${plans.length}.`,
    `Verified resolved plans=${resolved.length}.`,
    `Verified journal entries=${journal.length}.`
  ];

  if (analyses.length === 0 && plans.length === 0 && journal.length === 0) {
    return {
      weekStart: weekStart.toISOString().slice(0, 10),
      weekEnd: weekEnd.toISOString().slice(0, 10),
      summary: "Insufficient verified data for a weekly coach report.",
      strengths: [],
      weaknesses: [],
      tradesAvoided: null,
      moneyTheoreticallyProtectedNote:
        "Cannot estimate protected capital without verified WAIT/rejection counts and risk settings.",
      bestSetup: null,
      worstSetup: null,
      areasToImprove: ["Collect more LIVE shadow evidence this week."],
      verifiedFacts,
      insufficientData: true,
      disclaimer: "Coach uses verified stored records only. Not financial advice.",
      actionable: false
    };
  }

  if (waits.length > 0) {
    strengths.push(`Recorded ${waits.length} WAIT/rejection analyses — discipline to stand aside.`);
  }
  if (resolved.some((p) => (p.netR ?? 0) > 0)) {
    strengths.push("At least one resolved shadow plan finished with positive net R (verified).");
  }
  if (resolved.some((p) => p.status === "AMBIGUOUS_WORST_CASE_SL")) {
    weaknesses.push("Ambiguous SL/TP same-candle outcomes present — review risk geometry.");
  }
  if (resolved.filter((p) => (p.netR ?? 0) < 0).length > resolved.filter((p) => (p.netR ?? 0) > 0).length) {
    weaknesses.push("More negative net-R resolutions than positive this week (verified counts).");
  }
  if (!strengths.length) strengths.push("No strong verified pattern yet — sample still forming.");
  if (!weaknesses.length) weaknesses.push("No specific verified weakness codes this week.");

  const best = [...resolved].sort((a, b) => (b.netR ?? -999) - (a.netR ?? -999))[0];
  const worst = [...resolved].sort((a, b) => (a.netR ?? 999) - (b.netR ?? 999))[0];

  areas.push("Review rejection reasons frequency in V4 analytics.");
  areas.push("Do not promote V4 to manual €20 testing until acceptance gates are met.");

  return {
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: weekEnd.toISOString().slice(0, 10),
    summary: `Week of ${weekStart.toISOString().slice(0, 10)}: ${analyses.length} analyses, ${resolved.length} resolved shadows, ${journal.length} journal notes.`,
    strengths,
    weaknesses,
    tradesAvoided: waits.length,
    moneyTheoreticallyProtectedNote:
      "Theoretical protection is qualitative only (WAIT/rejection count). No fabricated euro P&L.",
    bestSetup: best
      ? `${best.strategyFamily} ${best.direction} netR=${best.netR} status=${best.status}`
      : null,
    worstSetup: worst
      ? `${worst.strategyFamily} ${worst.direction} netR=${worst.netR} status=${worst.status}`
      : null,
    areasToImprove: areas,
    verifiedFacts,
    insufficientData: false,
    disclaimer: "Coach uses verified stored records only. Not financial advice. Broker DISABLED.",
    actionable: false
  };
}
