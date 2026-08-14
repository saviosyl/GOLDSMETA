/**
 * GOLD_HUNTER activity diagnostics — trades/hour and opportunity rates.
 * Not forced optimization targets; profitability remains primary.
 */
import type { GhShadowTrade, GhSession } from "../types";

export type ActivityBand =
  | "TOO_SLOW_FOR_GOLD_HUNTER"
  | "LOW_ACTIVITY"
  | "ACCEPTABLE_IF_HIGH_EDGE"
  | "TARGET_FAST_ACTIVITY_RANGE"
  | "HIGH_ACTIVITY_REVIEW_COSTS"
  | "NO_TRADES";

export type SessionActivity = {
  trades: number;
  hours: number;
  tradesPerHour: number;
};

export type ActivityReport = {
  overallTradesPerHour: number;
  overallTradesPerDay: number;
  activityBand: ActivityBand;
  bySession: Record<GhSession, SessionActivity>;
  opportunitiesPerHour: number | null;
  qualifiedEntriesPerHour: number | null;
};

export function activityBand(tradesPerHour: number): ActivityBand {
  if (!(tradesPerHour > 0)) return "NO_TRADES";
  if (tradesPerHour < 3) return "TOO_SLOW_FOR_GOLD_HUNTER";
  if (tradesPerHour < 5) return "LOW_ACTIVITY";
  if (tradesPerHour < 10) return "ACCEPTABLE_IF_HIGH_EDGE";
  if (tradesPerHour <= 30) return "TARGET_FAST_ACTIVITY_RANGE";
  return "HIGH_ACTIVITY_REVIEW_COSTS";
}

/** Session hour spans used by classifySession (UTC). */
const SESSION_HOURS: Record<GhSession, number> = {
  ASIA: 7,
  LONDON: 5,
  OVERLAP: 4,
  NEW_YORK: 5,
  OFF_HOURS: 3
};

export function computeActivityMetrics(args: {
  trades: GhShadowTrade[];
  /** Span of the evaluated slice in ms (validation / holdout / audit). */
  windowFromMs: number;
  windowToMs: number;
  /** Optional: seconds that were score-eligible before policy entry. */
  opportunityCount?: number;
  /** Optional: seconds that passed score floors (pre consecutive). */
  qualifiedEntryCount?: number;
}): ActivityReport {
  const spanMs = Math.max(1, args.windowToMs - args.windowFromMs);
  const spanHours = spanMs / 3_600_000;
  const spanDays = spanMs / 86_400_000;
  const trades = args.trades;
  const overallTradesPerHour = trades.length / spanHours;
  const overallTradesPerDay = trades.length / Math.max(spanDays, 1e-9);

  const bySession = {} as Record<GhSession, SessionActivity>;
  for (const s of Object.keys(SESSION_HOURS) as GhSession[]) {
    const n = trades.filter((t) => t.session === s).length;
    // Approximate session hours in the window from calendar-day fraction.
    const hours = (SESSION_HOURS[s] / 24) * spanHours;
    bySession[s] = {
      trades: n,
      hours,
      tradesPerHour: hours > 0 ? n / hours : 0
    };
  }

  return {
    overallTradesPerHour,
    overallTradesPerDay,
    activityBand: activityBand(overallTradesPerHour),
    bySession,
    opportunitiesPerHour:
      args.opportunityCount != null ? args.opportunityCount / spanHours : null,
    qualifiedEntriesPerHour:
      args.qualifiedEntryCount != null
        ? args.qualifiedEntryCount / spanHours
        : null
  };
}
