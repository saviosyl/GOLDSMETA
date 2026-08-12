/** Micro-owned clock helpers (no Core imports). */

export function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

export function floorToMinuteMs(epochMs: number): number {
  return Math.floor(epochMs / 60_000) * 60_000;
}

export function horizonMs(h: "1m" | "5m" | "15m"): number {
  if (h === "1m") return 60_000;
  if (h === "5m") return 5 * 60_000;
  return 15 * 60_000;
}

export function classifyMicroSession(utcHour: number): {
  session: import("./types").MicroSession;
  sessionVersion: string;
} {
  // Transparent UTC buckets — versioned independently of Core.
  // Asia ~00-07, London ~07-12, NY ~13-21, overlap ~13-16 UTC.
  let session: import("./types").MicroSession = "OTHER";
  if (utcHour >= 0 && utcHour < 7) session = "ASIA";
  else if (utcHour >= 7 && utcHour < 12) session = "LONDON";
  else if (utcHour >= 13 && utcHour < 16) session = "LONDON_NY_OVERLAP";
  else if (utcHour >= 16 && utcHour < 21) session = "NEW_YORK";
  else if (utcHour >= 12 && utcHour < 13) session = "LONDON";
  return { session, sessionVersion: "session-v1.0.0" };
}
