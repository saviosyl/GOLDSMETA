/**
 * High-impact USD economic-event protection.
 * Calendar is intentionally conservative; expand via config without LLM.
 */

export interface EconomicEvent {
  id: string;
  title: string;
  currency: "USD";
  impact: "HIGH";
  startsAt: string; // ISO
}

/** Static reference schedule template — replace/extend with live calendar feed later. */
export const HIGH_IMPACT_USD_EVENT_TYPES = [
  "FOMC rate decision",
  "Fed press conference",
  "US CPI",
  "US PCE",
  "US payrolls",
  "Unemployment data"
] as const;

export function isNewsBlackout(
  nowIso: string,
  events: EconomicEvent[],
  minutesBefore: number,
  minutesAfter: number
): { blackout: boolean; event: EconomicEvent | null } {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return { blackout: false, event: null };
  for (const ev of events) {
    const t = Date.parse(ev.startsAt);
    if (!Number.isFinite(t)) continue;
    const before = minutesBefore * 60_000;
    const after = minutesAfter * 60_000;
    if (now >= t - before && now <= t + after) {
      return { blackout: true, event: ev };
    }
  }
  return { blackout: false, event: null };
}
