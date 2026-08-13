import type { GhRegime, GhSession } from "./types";

/** Deterministic UTC session buckets (research). */
export function classifySession(timestampMs: number): GhSession {
  const hour = new Date(timestampMs).getUTCHours();
  // Approximate FX metal sessions in UTC.
  const asia = hour >= 0 && hour < 7;
  const london = hour >= 7 && hour < 12;
  const overlap = hour >= 12 && hour < 16;
  const ny = hour >= 16 && hour < 21;
  if (overlap) return "OVERLAP";
  if (london) return "LONDON";
  if (ny) return "NEW_YORK";
  if (asia) return "ASIA";
  return "OFF_HOURS";
}

export function classifyRegime(args: {
  shortVol: number;
  range60: number;
  ret15: number;
  ret60: number;
  spreadOverMedian: number;
}): GhRegime {
  if (args.spreadOverMedian >= 2.5 || args.shortVol >= 1.5) return "DANGER";
  const absRet = Math.abs(args.ret60);
  if (absRet >= 0.0008 && args.range60 > 0 && absRet / args.range60 >= 0.55) {
    return "TREND";
  }
  if (Math.abs(args.ret15) >= 0.0005 && args.shortVol >= 0.4) return "BREAKOUT";
  return "RANGE";
}
