/**
 * Overnight review helpers — display only; does not alter V4 rules.
 * Quiet hours and preferred trading hours are user preferences for alerts/UI.
 */

const HOURS_KEY = "goldmeta.tradingHours.v1";
const ALERTS_KEY = "goldmeta.alertPrefs.v1";

export type TradingHoursMode =
  | "24h"
  | "london"
  | "newyork"
  | "london_ny"
  | "asia"
  | "custom";

export type TradingHoursPreference = {
  mode: TradingHoursMode;
  /** Local HH:mm when custom */
  customStart?: string;
  customEnd?: string;
};

export type AlertPrefs = {
  allAnalysis: boolean;
  candidateForming: boolean;
  validatedShadowPlan: boolean;
  highQualityOnly: boolean;
  planWeakening: boolean;
  planConflict: boolean;
  planResolved: boolean;
  overnightSummary: boolean;
  quietHoursEnabled: boolean;
  quietStart: string; // HH:mm local
  quietEnd: string;
  urgentHighQuality: boolean; // default false
};

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  allAnalysis: false,
  candidateForming: false,
  validatedShadowPlan: true,
  highQualityOnly: true,
  planWeakening: true,
  planConflict: true,
  planResolved: true,
  overnightSummary: true,
  quietHoursEnabled: true,
  quietStart: "22:00",
  quietEnd: "07:00",
  urgentHighQuality: false
};

export function loadTradingHours(): TradingHoursPreference {
  try {
    const raw = localStorage.getItem(HOURS_KEY);
    if (!raw) return { mode: "24h" };
    return JSON.parse(raw) as TradingHoursPreference;
  } catch {
    return { mode: "24h" };
  }
}

export function saveTradingHours(pref: TradingHoursPreference): void {
  localStorage.setItem(HOURS_KEY, JSON.stringify(pref));
}

export function loadAlertPrefs(): AlertPrefs {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    if (!raw) return { ...DEFAULT_ALERT_PREFS };
    return { ...DEFAULT_ALERT_PREFS, ...(JSON.parse(raw) as AlertPrefs) };
  } catch {
    return { ...DEFAULT_ALERT_PREFS };
  }
}

export function saveAlertPrefs(prefs: AlertPrefs): void {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(prefs));
}

/** Parse HH:mm to minutes since midnight */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Whether local clock is inside quiet hours (supports wrap past midnight). */
export function isInQuietHours(
  now: Date,
  prefs: AlertPrefs,
  timeZone: string
): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const cur = hour * 60 + minute;
  const start = toMinutes(prefs.quietStart);
  const end = toMinutes(prefs.quietEnd);
  if (start === end) return true;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

export type OvernightSetupSummary = {
  setupId: string;
  direction?: string | null;
  status: string;
  createdAt: string;
  quality?: number | null;
  entry?: number | null;
  resultLabel?: string | null;
};

export type OvernightReviewModel = {
  analysesHint: string;
  candidatesCreated: number;
  validatedPlans: number;
  best: OvernightSetupSummary | null;
  items: OvernightSetupSummary[];
  disclaimer: string;
};

/** Build overnight review from recent setups whose createdAt falls in prior local night window. */
export function buildOvernightReview(
  setups: Array<{
    setupId: string;
    direction?: string | null;
    status: string;
    createdAt: string;
    levels?: { entryPrice?: number | null } | null;
  }>,
  now = new Date(),
  _timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): OvernightReviewModel {
  void _timeZone;
  // Prior 12 hours as a practical "overnight" window for UI review
  const windowMs = 12 * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  const overnight = setups.filter((s) => {
    const t = new Date(s.createdAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });

  const validated = overnight.filter((s) =>
    /VALID|ACTIVE|RESOLVED|TP|SHADOW/i.test(String(s.status))
  );

  const items: OvernightSetupSummary[] = overnight.slice(0, 8).map((s) => ({
    setupId: s.setupId,
    direction: s.direction,
    status: String(s.status),
    createdAt: s.createdAt,
    entry: s.levels?.entryPrice ?? null,
    resultLabel: String(s.status).replace(/_/g, " ")
  }));

  return {
    analysesHint: "Shadow evidence collected overnight (analysis only).",
    candidatesCreated: overnight.length,
    validatedPlans: validated.length,
    best: items[0] ?? null,
    items,
    disclaimer:
      "SHADOW RESULT — NOT AN EXECUTED TRADE. Past shadow outcomes do not guarantee future performance."
  };
}
