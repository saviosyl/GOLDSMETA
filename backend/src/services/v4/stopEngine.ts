import { v4Config } from "./config";
import type { V4Bar, V4StopResult, V4VolumeProfile } from "./types";

/**
 * Stop-loss engine — never place stop exactly at VAH/VAL/POC.
 * Reject unsafe geometry (tiny stops like 0.22 points).
 */
export function computeStructuralStop(input: {
  direction: "BUY" | "SELL";
  entry: number;
  atr: number | null;
  spreadPoints: number;
  bars: V4Bar[];
  profile: V4VolumeProfile | null;
  swingLow?: number | null;
  swingHigh?: number | null;
  retestLow?: number | null;
  retestHigh?: number | null;
  rejectionLow?: number | null;
  rejectionHigh?: number | null;
}): V4StopResult {
  const { direction, entry, atr, spreadPoints, profile } = input;
  const confirmed = input.bars.filter((b) => b.confirmed);
  const recent = confirmed.slice(-8);

  const structural: number[] = [];
  if (direction === "BUY") {
    for (const b of recent) structural.push(b.low);
    if (input.swingLow != null) structural.push(input.swingLow);
    if (input.retestLow != null) structural.push(input.retestLow);
    if (input.rejectionLow != null) structural.push(input.rejectionLow);
    if (profile?.val != null) structural.push(profile.val - (profile.pocZoneWidth || 0.5));
  } else {
    for (const b of recent) structural.push(b.high);
    if (input.swingHigh != null) structural.push(input.swingHigh);
    if (input.retestHigh != null) structural.push(input.retestHigh);
    if (input.rejectionHigh != null) structural.push(input.rejectionHigh);
    if (profile?.vah != null) structural.push(profile.vah + (profile.pocZoneWidth || 0.5));
  }

  const below = structural.filter((p) => p < entry).sort((a, b) => b - a);
  const above = structural.filter((p) => p > entry).sort((a, b) => a - b);
  let raw = direction === "BUY" ? below[0] ?? null : above[0] ?? null;

  // Volatility / spread / absolute floors
  const atrMin = atr != null ? atr * v4Config.stop.atrMinMult : v4Config.stop.absoluteMinPoints;
  const spreadMin = spreadPoints * v4Config.stop.spreadSafetyFactor;
  const minDist = Math.max(
    v4Config.stop.absoluteMinPoints,
    atrMin,
    spreadMin
  );

  if (raw == null) {
    return {
      price: null,
      distance: null,
      reason: null,
      structuralCandidates: structural,
      rejected: true,
      rejectCode: "NO_TRADE_INVALID_RISK_GEOMETRY",
      rejectReason: "No clear invalidation structure"
    };
  }

  // Enforce never exactly at value boundary
  if (profile && v4Config.stop.neverExactAtValueBoundary) {
    for (const lvl of [profile.poc, profile.vah, profile.val]) {
      if (lvl != null && Math.abs(raw - lvl) < 0.05) {
        raw = direction === "BUY" ? raw - minDist * 0.25 : raw + minDist * 0.25;
      }
    }
  }

  let distance = Math.abs(entry - raw);
  if (distance < minDist) {
    // Push stop out to minimum — if that exceeds max ATR, reject
    raw = direction === "BUY" ? entry - minDist : entry + minDist;
    distance = minDist;
  }

  const maxDist = atr != null ? atr * v4Config.stop.maxAtrMult : minDist * 8;
  if (distance > maxDist) {
    return {
      price: null,
      distance,
      reason: null,
      structuralCandidates: structural,
      rejected: true,
      rejectCode: "NO_TRADE_INVALID_RISK_GEOMETRY",
      rejectReason: `Stop too far (${distance.toFixed(2)} > max ${maxDist.toFixed(2)})`
    };
  }

  // Spread consumes too much of stop
  if (spreadPoints > 0 && spreadPoints / distance > 0.35) {
    return {
      price: null,
      distance,
      reason: null,
      structuralCandidates: structural,
      rejected: true,
      rejectCode: "NO_TRADE_INVALID_RISK_GEOMETRY",
      rejectReason: "Spread consumes too much of the stop"
    };
  }

  if (distance < v4Config.stop.absoluteMinPoints) {
    return {
      price: null,
      distance,
      reason: null,
      structuralCandidates: structural,
      rejected: true,
      rejectCode: "NO_TRADE_INVALID_RISK_GEOMETRY",
      rejectReason: `Stop too close (${distance.toFixed(2)} < ${v4Config.stop.absoluteMinPoints})`
    };
  }

  return {
    price: Math.round(raw * 100) / 100,
    distance: Math.round(distance * 100) / 100,
    reason: "Structural invalidation with ATR/spread safety buffer",
    structuralCandidates: structural,
    rejected: false,
    rejectCode: null,
    rejectReason: null
  };
}
