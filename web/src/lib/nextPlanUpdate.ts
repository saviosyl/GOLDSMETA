/**
 * Informational countdown to the next candle-close check window.
 * Derived from UTC-aligned period boundaries — does not imply a signal will fire.
 */

export type NextUpdateKind = "PLAN_15M" | "CONFIRM_5M";

export function msUntilNextPeriodClose(nowMs: number, periodMinutes: number): number {
  const periodMs = Math.max(1, periodMinutes) * 60_000;
  const elapsed = ((nowMs % periodMs) + periodMs) % periodMs;
  const remaining = periodMs - elapsed;
  return remaining === 0 ? periodMs : remaining;
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/**
 * PLAN_15M while building / waiting / no valid plan.
 * CONFIRM_5M once price is in/near the entry zone and confirmation is outstanding.
 */
export function resolveNextUpdateKind(plan: {
  planStatus?: string | null;
  confirmation5m?: { state?: string | null; meaningful?: boolean } | null;
  setupProgress?: { items?: Array<{ id: string; mark?: string; complete?: boolean }> } | null;
  geometryValid?: boolean | null;
}): NextUpdateKind {
  const status = String(plan.planStatus ?? "").toUpperCase();
  if (
    status === "NO_VALID_PLAN" ||
    status === "BUILDING" ||
    status === "EXPIRED" ||
    plan.geometryValid === false
  ) {
    return "PLAN_15M";
  }
  const inZone = plan.setupProgress?.items?.some(
    (i) => i.id === "location" && (i.mark === "pass" || i.complete)
  );
  const confirmState = String(plan.confirmation5m?.state ?? "NONE").toUpperCase();
  const confirmDone =
    /BREAKOUT_CONFIRMED|REJECTION_CONFIRMED|RETEST_HELD/.test(confirmState) ||
    status === "CONFIRMED" ||
    status === "IN_PROGRESS" ||
    status === "TP1_REACHED" ||
    status === "TP2_REACHED";
  if (inZone && !confirmDone) return "CONFIRM_5M";
  if (status === "ARMED" || status === "WAITING_FOR_ENTRY_ZONE") {
    return inZone ? "CONFIRM_5M" : "PLAN_15M";
  }
  return confirmDone ? "CONFIRM_5M" : "PLAN_15M";
}

export function nextUpdateLabel(kind: NextUpdateKind): string {
  return kind === "CONFIRM_5M"
    ? "Next 5M confirmation check"
    : "Next 15M plan check";
}
