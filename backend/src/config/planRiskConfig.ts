/**
 * Configurable XAUUSD intraday plan risk defaults.
 *
 * Values are explicit product defaults — not silently tuned to raise trade count.
 * Override via env only when an approved ops change documents the new numbers.
 */

const numEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Defaults (XAUUSD points / ratios) and reasoning:
 * - minStopDistancePoints 0.8 — below ~0.8pt stop is noise vs typical spread/slippage
 * - maxStopDistancePoints 25 — wider than ~25pt is usually swing, not intraday plan
 * - minTp1DistancePoints 1.5 — TP1 must clear spread + a small structural room
 * - minTp1RiskReward 1.0 — at least 1R to first target; never fabricate higher RR
 * - entryZoneTolerancePoints 0.15 — zone membership fuzz for quote noise
 * - staleDataThresholdMs 5m — aligned with decision stale threshold
 * - planExpiryMs 30m — two 15m bars; plans must refresh from PLAN_15M
 */
export const planRiskConfig = {
  minStopDistancePoints: numEnv("PLAN_MIN_STOP_DISTANCE_POINTS", 0.8),
  maxStopDistancePoints: numEnv("PLAN_MAX_STOP_DISTANCE_POINTS", 25),
  minTp1DistancePoints: numEnv("PLAN_MIN_TP1_DISTANCE_POINTS", 1.5),
  minTp1RiskReward: numEnv("PLAN_MIN_TP1_RISK_REWARD", 1.0),
  /** Legacy name used by quick-target room checks. */
  minQuickTargetRoomPoints: numEnv("PLAN_MIN_QUICK_TARGET_ROOM_POINTS", 1.5),
  minQuickTargetRiskReward: numEnv("PLAN_MIN_QUICK_TARGET_RISK_REWARD", 1.0),
  entryZoneTolerancePoints: numEnv("PLAN_ENTRY_ZONE_TOLERANCE_POINTS", 0.15),
  staleDataThresholdMs: numEnv("PLAN_STALE_DATA_THRESHOLD_MS", 5 * 60 * 1000),
  planExpiryMs: numEnv("PLAN_EXPIRY_MS", 30 * 60 * 1000),
  geometryEpsilonPoints: numEnv("PLAN_GEOMETRY_EPSILON_POINTS", 0.05)
} as const;

export type PlanRiskConfig = typeof planRiskConfig;
