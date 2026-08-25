/**
 * Retention helpers — prepare policy; do NOT run destructive cleanup in this PR.
 */

export const MICRO_QUOTE_RETENTION_DAYS = 30;
export const MICRO_BAR_RETENTION_DAYS = 365 * 2;

export type MicroRetentionPolicy = {
  quoteRetentionDays: number;
  barRetentionDays: number;
  destructiveCleanupEnabled: false;
  note: string;
};

export function getMicroRetentionPolicy(
  env: NodeJS.ProcessEnv = process.env
): MicroRetentionPolicy {
  const quoteDays = Number(env.MICRO_QUOTE_RETENTION_DAYS ?? MICRO_QUOTE_RETENTION_DAYS);
  const barDays = Number(env.MICRO_BAR_RETENTION_DAYS ?? MICRO_BAR_RETENTION_DAYS);
  return {
    quoteRetentionDays: Number.isFinite(quoteDays) ? quoteDays : MICRO_QUOTE_RETENTION_DAYS,
    barRetentionDays: Number.isFinite(barDays) ? barDays : MICRO_BAR_RETENTION_DAYS,
    destructiveCleanupEnabled: false,
    note: "Cleanup helper only — not scheduled against production in V1.1."
  };
}

/** Pure helper: which quote sample ids would be eligible for deletion. */
export function selectExpiredQuoteIds(
  quotes: Array<{ id: string; brokerTimestamp: string }>,
  nowMs: number,
  retentionDays = MICRO_QUOTE_RETENTION_DAYS
): string[] {
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  return quotes
    .filter((q) => Date.parse(q.brokerTimestamp) < cutoff)
    .map((q) => q.id);
}
