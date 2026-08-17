/**
 * Activity / idle-time reporting for shadow qualification.
 * Observation only — never forces trade frequency.
 */
import type { GhShadowQualificationEpoch } from "./types";

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function percentile(nums: number[], p: number): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx]!;
}

export type GhShadowActivityClassification =
  | "MEETS_DESIRED_OPERATING_CHARACTER"
  | "LOW_ACTIVITY"
  | "INSUFFICIENT_ACTIVE_TIME";

export type GhShadowActivityReport = {
  newOpportunitiesDetected: number;
  formalTradesOpened: number;
  formalTradesClosed: number;
  opportunitiesWhileAlreadyOpen: number;
  opportunitiesExcludedDataQuality: number;
  opportunitiesRejectedSizing: number;
  opportunitiesWarmupIgnored: number;
  otherRejectionReasons: Record<string, number>;
  activeMarketHours: number;
  tradesPerActiveMarketHour: number | null;
  opportunitiesPerActiveMarketHour: number | null;
  medianTimeBetweenEntriesMs: number | null;
  p95TimeBetweenEntriesMs: number | null;
  longestFlatIdleDuringActiveMarketMs: number | null;
  longestOpenTradeDurationMs: number | null;
  bySetupOpened: Record<"A" | "B" | "C", number>;
  bySetupTradesPerActiveHour: Record<"A" | "B" | "C", number | null>;
  /** Desired character ~6–7 trades/hour when conditions support — observation only. */
  desiredTradesPerHourRange: { min: number; max: number };
  activityClassification: GhShadowActivityClassification;
};

export function computeGhShadowActivityReport(
  epoch: GhShadowQualificationEpoch | null
): GhShadowActivityReport {
  const empty: GhShadowActivityReport = {
    newOpportunitiesDetected: 0,
    formalTradesOpened: 0,
    formalTradesClosed: 0,
    opportunitiesWhileAlreadyOpen: 0,
    opportunitiesExcludedDataQuality: 0,
    opportunitiesRejectedSizing: 0,
    opportunitiesWarmupIgnored: 0,
    otherRejectionReasons: {},
    activeMarketHours: 0,
    tradesPerActiveMarketHour: null,
    opportunitiesPerActiveMarketHour: null,
    medianTimeBetweenEntriesMs: null,
    p95TimeBetweenEntriesMs: null,
    longestFlatIdleDuringActiveMarketMs: null,
    longestOpenTradeDurationMs: null,
    bySetupOpened: { A: 0, B: 0, C: 0 },
    bySetupTradesPerActiveHour: { A: null, B: null, C: null },
    desiredTradesPerHourRange: { min: 6, max: 7 },
    activityClassification: "INSUFFICIENT_ACTIVE_TIME"
  };
  if (!epoch?.activity) return empty;
  const a = epoch.activity;
  const hours = a.activeMarketMs / 3_600_000;
  const gaps: number[] = [];
  const entries = [...a.entryTimestampsMs].sort((x, y) => x - y);
  for (let i = 1; i < entries.length; i++) {
    gaps.push(entries[i]! - entries[i - 1]!);
  }
  const tradesPerHour = hours > 0 ? a.formalTradesOpened / hours : null;
  const oppsPerHour = hours > 0 ? a.newOpportunitiesDetected / hours : null;

  let activityClassification: GhShadowActivityClassification =
    "INSUFFICIENT_ACTIVE_TIME";
  if (hours < 0.25) {
    activityClassification = "INSUFFICIENT_ACTIVE_TIME";
  } else if (tradesPerHour != null && tradesPerHour >= 6) {
    activityClassification = "MEETS_DESIRED_OPERATING_CHARACTER";
  } else {
    activityClassification = "LOW_ACTIVITY";
  }

  const bySetupTradesPerActiveHour: Record<"A" | "B" | "C", number | null> = {
    A: hours > 0 ? a.bySetupOpened.A / hours : null,
    B: hours > 0 ? a.bySetupOpened.B / hours : null,
    C: hours > 0 ? a.bySetupOpened.C / hours : null
  };

  return {
    newOpportunitiesDetected: a.newOpportunitiesDetected,
    formalTradesOpened: a.formalTradesOpened,
    formalTradesClosed: a.formalTradesClosed,
    opportunitiesWhileAlreadyOpen: a.opportunitiesWhileAlreadyOpen,
    opportunitiesExcludedDataQuality: a.opportunitiesExcludedDataQuality,
    opportunitiesRejectedSizing: a.opportunitiesRejectedSizing,
    opportunitiesWarmupIgnored: a.opportunitiesWarmupIgnored,
    otherRejectionReasons: { ...a.otherRejectionReasons },
    activeMarketHours: hours,
    tradesPerActiveMarketHour: tradesPerHour,
    opportunitiesPerActiveMarketHour: oppsPerHour,
    medianTimeBetweenEntriesMs: median(gaps),
    p95TimeBetweenEntriesMs: percentile(gaps, 0.95),
    longestFlatIdleDuringActiveMarketMs: a.flatIdleSegmentsMs.length
      ? Math.max(...a.flatIdleSegmentsMs)
      : null,
    longestOpenTradeDurationMs: a.openTradeDurationsMs.length
      ? Math.max(...a.openTradeDurationsMs)
      : null,
    bySetupOpened: { ...a.bySetupOpened },
    bySetupTradesPerActiveHour,
    desiredTradesPerHourRange: { min: 6, max: 7 },
    activityClassification
  };
}
