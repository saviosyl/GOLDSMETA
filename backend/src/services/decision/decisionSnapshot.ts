/**
 * Authoritative decision snapshot — one compatible time window per cycle.
 * Inputs from different 15M planSourceKeys must not be mixed.
 */

export type FeedRoleFreshness = "fresh" | "delayed" | "stale" | "missing";

export type DecisionSnapshotFreshness = {
  quote: FeedRoleFreshness;
  plan15m: FeedRoleFreshness;
  confirm5m: FeedRoleFreshness;
  quoteAgeMs: number | null;
  planAgeMs: number | null;
  confirmAgeMs: number | null;
  /** Human-readable per-source lines for UI / diagnostics. */
  lines: string[];
};

export type AuthoritativeDecisionSnapshot = {
  snapshotId: string;
  symbol: string;
  currentPrice: number | null;
  quoteTimestamp: string | null;
  plan15mTimestamp: string | null;
  confirmation5mTimestamp: string | null;
  planSourceKey: string | null;
  confirmationSourceKey: string | null;
  session: string | null;
  marketStructureMode: string | null;
  trend: string | null;
  momentum: string | null;
  volume: string | null;
  support: number | null;
  resistance: number | null;
  triggerLevel: number | null;
  invalidationLevel: number | null;
  feedHealth: "green" | "amber" | "red" | "unknown";
  freshness: DecisionSnapshotFreshness;
  windowCompatible: boolean;
  incompatibilityReasons: string[];
};

export type FreshnessWindows = {
  quoteFreshMs: number;
  quoteDelayedMs: number;
  confirmGraceMs: number;
  planGraceMs: number;
  confirmBarMs: number;
  planBarMs: number;
};

export const DEFAULT_FRESHNESS_WINDOWS: FreshnessWindows = {
  quoteFreshMs: 90_000,
  quoteDelayedMs: 180_000,
  confirmGraceMs: 90_000,
  planGraceMs: 120_000,
  confirmBarMs: 5 * 60_000,
  planBarMs: 15 * 60_000
};

const ageMs = (iso: string | null | undefined, nowMs: number): number | null => {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, nowMs - at);
};

export const classifyQuoteFreshness = (
  age: number | null,
  windows: FreshnessWindows = DEFAULT_FRESHNESS_WINDOWS
): FeedRoleFreshness => {
  if (age == null) return "missing";
  if (age <= windows.quoteFreshMs) return "fresh";
  if (age <= windows.quoteDelayedMs) return "delayed";
  return "stale";
};

export const classifyBarFreshness = (
  age: number | null,
  barMs: number,
  graceMs: number
): FeedRoleFreshness => {
  if (age == null) return "missing";
  if (age <= barMs + graceMs) return "fresh";
  if (age <= barMs + graceMs * 2) return "delayed";
  return "stale";
};

export const formatAgeMinutes = (ageMsValue: number | null): string => {
  if (ageMsValue == null) return "missing";
  if (ageMsValue < 60_000) return `${Math.round(ageMsValue / 1000)}s`;
  return `${Math.round(ageMsValue / 60_000)}m`;
};

/** Build XAUUSD-20260806-123000 style id from plan or quote time. */
export const buildSnapshotId = (
  symbol: string,
  atIso: string | null | undefined,
  nowMs = Date.now()
): string => {
  const at = atIso ? Date.parse(atIso) : nowMs;
  const d = new Date(Number.isFinite(at) ? at : nowMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const sym = (symbol || "XAUUSD").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${sym}-${y}${mo}${day}-${hh}${mm}${ss}`;
};

export const buildAuthoritativeSnapshot = (input: {
  symbol: string;
  currentPrice?: number | null;
  quoteTimestamp?: string | null;
  plan15mTimestamp?: string | null;
  confirmation5mTimestamp?: string | null;
  planSourceKey?: string | null;
  confirmationSourceKey?: string | null;
  session?: string | null;
  marketStructureMode?: string | null;
  trend?: string | null;
  momentum?: string | null;
  volume?: string | null;
  support?: number | null;
  resistance?: number | null;
  triggerLevel?: number | null;
  invalidationLevel?: number | null;
  feedHealth?: "green" | "amber" | "red" | "unknown";
  nowMs?: number;
  windows?: FreshnessWindows;
}): AuthoritativeDecisionSnapshot => {
  const nowMs = input.nowMs ?? Date.now();
  const windows = input.windows ?? DEFAULT_FRESHNESS_WINDOWS;
  const quoteAge = ageMs(input.quoteTimestamp, nowMs);
  const planAge = ageMs(input.plan15mTimestamp, nowMs);
  const confirmAge = ageMs(input.confirmation5mTimestamp, nowMs);
  const quote = classifyQuoteFreshness(quoteAge, windows);
  const plan15m = classifyBarFreshness(planAge, windows.planBarMs, windows.planGraceMs);
  const confirm5m = classifyBarFreshness(confirmAge, windows.confirmBarMs, windows.confirmGraceMs);

  const incompatibilityReasons: string[] = [];
  const planKey = input.planSourceKey ?? null;
  const confirmKey = input.confirmationSourceKey ?? null;
  if (planKey && confirmKey && planKey !== confirmKey) {
    incompatibilityReasons.push("CONFIRM_PLAN_SOURCE_KEY_MISMATCH");
  }
  if (plan15m === "stale") incompatibilityReasons.push("PLAN_15M_STALE");
  if (confirm5m === "stale" && confirmKey) incompatibilityReasons.push("CONFIRM_5M_STALE");
  if (quote === "stale") incompatibilityReasons.push("QUOTE_STALE");

  const lines = [
    `15M plan: ${plan15m === "fresh" ? "Fresh" : plan15m === "delayed" ? "Delayed" : plan15m === "stale" ? `Stale by ${formatAgeMinutes(planAge)}` : "Missing"}`,
    `5M confirmation: ${confirm5m === "fresh" ? "Fresh" : confirm5m === "delayed" ? "Delayed" : confirm5m === "stale" ? `Stale by ${formatAgeMinutes(confirmAge)}` : "Missing"}`,
    `Quote: ${quote === "fresh" ? "Fresh" : quote === "delayed" ? "Delayed" : quote === "stale" ? `Stale by ${formatAgeMinutes(quoteAge)}` : "Missing"}`
  ];

  return {
    snapshotId: buildSnapshotId(input.symbol, input.plan15mTimestamp ?? input.quoteTimestamp, nowMs),
    symbol: input.symbol,
    currentPrice: input.currentPrice ?? null,
    quoteTimestamp: input.quoteTimestamp ?? null,
    plan15mTimestamp: input.plan15mTimestamp ?? null,
    confirmation5mTimestamp: input.confirmation5mTimestamp ?? null,
    planSourceKey: planKey,
    confirmationSourceKey: confirmKey,
    session: input.session ?? null,
    marketStructureMode: input.marketStructureMode ?? null,
    trend: input.trend ?? null,
    momentum: input.momentum ?? null,
    volume: input.volume ?? null,
    support: input.support ?? null,
    resistance: input.resistance ?? null,
    triggerLevel: input.triggerLevel ?? null,
    invalidationLevel: input.invalidationLevel ?? null,
    feedHealth: input.feedHealth ?? "unknown",
    freshness: {
      quote,
      plan15m,
      confirm5m,
      quoteAgeMs: quoteAge,
      planAgeMs: planAge,
      confirmAgeMs: confirmAge,
      lines
    },
    windowCompatible: incompatibilityReasons.length === 0,
    incompatibilityReasons
  };
};
