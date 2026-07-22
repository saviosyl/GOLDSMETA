import { v4Config } from "./config";
import type { V4Bar, V4ProfileSource, V4VolumeProfile } from "./types";

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

export function pocZoneWidth(atr: number | null): number {
  const fromAtr = atr != null && atr > 0 ? atr * v4Config.pocZone.atrMult : 0;
  return Math.max(v4Config.pocZone.minAbsPoints, fromAtr, v4Config.pocZone.tickSize * 10);
}

export function validateProfileOrdering(
  vah: number | null,
  poc: number | null,
  val: number | null
): string[] {
  const reasons: string[] = [];
  if (poc == null || vah == null || val == null) {
    reasons.push("Missing POC/VAH/VAL");
    return reasons;
  }
  if (!(vah > poc && poc > val)) {
    reasons.push("Invalid ordering: require VAH > POC > VAL");
  }
  return reasons;
}

/**
 * Build / validate a session volume profile.
 * XAUUSD CFD tick volume is never treated as exchange contract volume.
 */
export function buildVolumeProfile(input: {
  source: V4ProfileSource;
  session: string;
  poc: number | null;
  vah: number | null;
  val: number | null;
  hvn?: number[];
  lvn?: number[];
  sessionHigh?: number | null;
  sessionLow?: number | null;
  priorDayHigh?: number | null;
  priorDayLow?: number | null;
  pocMigration?: V4VolumeProfile["pocMigration"];
  barCount: number;
  volumeObservations: number;
  asOf: string;
  atr: number | null;
}): V4VolumeProfile {
  const invalidReasons: string[] = [];
  invalidReasons.push(...validateProfileOrdering(input.vah, input.poc, input.val));

  if (input.barCount < v4Config.profileGates.minBars) {
    invalidReasons.push(`Insufficient bars (${input.barCount} < ${v4Config.profileGates.minBars})`);
  }
  if (input.volumeObservations < v4Config.profileGates.minVolumeObservations) {
    invalidReasons.push("Insufficient volume observations");
  }

  const valueAreaWidth =
    input.vah != null && input.val != null ? round(Math.abs(input.vah - input.val)) : null;
  if (valueAreaWidth != null && valueAreaWidth < v4Config.profileGates.minValueAreaWidth) {
    invalidReasons.push("Value-area width below minimum");
  }

  const cleaned = [...invalidReasons];
  if (input.source === "UNKNOWN" || input.source === "SYNTHETIC") {
    cleaned.push(`Profile source ${input.source} is not exchange-confirmed`);
  }

  return {
    source: input.source,
    session: input.session,
    poc: input.poc,
    vah: input.vah,
    val: input.val,
    pocZoneWidth: pocZoneWidth(input.atr),
    valueAreaWidth,
    hvn: input.hvn ?? [],
    lvn: input.lvn ?? [],
    sessionHigh: input.sessionHigh ?? null,
    sessionLow: input.sessionLow ?? null,
    priorDayHigh: input.priorDayHigh ?? null,
    priorDayLow: input.priorDayLow ?? null,
    pocMigration: input.pocMigration ?? "UNKNOWN",
    barCount: input.barCount,
    volumeObservations: input.volumeObservations,
    asOf: input.asOf,
    valid: cleaned.length === 0,
    invalidReasons: cleaned
  };
}

export function profilesConflictMaterially(
  xau: V4VolumeProfile | null,
  gc: V4VolumeProfile | null,
  atr: number | null
): boolean {
  if (!xau?.valid || !gc?.valid || xau.poc == null || gc.poc == null) return false;
  const tol = Math.max(pocZoneWidth(atr) * 2, (atr ?? 1) * 0.5);
  return Math.abs(xau.poc - gc.poc) > tol;
}

/** Approximate ATR from confirmed bars (Wilder-lite). */
export function atrFromBars(bars: V4Bar[], period = 14): number | null {
  const confirmed = bars.filter((b) => b.confirmed);
  if (confirmed.length < period + 1) return null;
  const slice = confirmed.slice(-period - 1);
  let sum = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const cur = slice[i]!;
    const prev = slice[i - 1]!;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    sum += tr;
  }
  return round(sum / period, 4);
}

export function priceInPocZone(price: number, profile: V4VolumeProfile): boolean {
  if (profile.poc == null) return false;
  return Math.abs(price - profile.poc) <= profile.pocZoneWidth;
}
