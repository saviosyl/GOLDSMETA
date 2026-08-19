/**
 * Rational conservative defaults — not a giant optimizer grid.
 */
import type { GhFastConfig } from "./types";
import {
  GH_FAST_REARM_FLOOR_MS_DEFAULT,
  GH_FAST_REARM_FLOOR_MS_MAX,
  GH_FAST_REARM_FLOOR_MS_MIN
} from "./versions";

export function defaultGhFastConfig(
  over: Partial<GhFastConfig> = {}
): GhFastConfig {
  const rearm = Math.min(
    GH_FAST_REARM_FLOOR_MS_MAX,
    Math.max(
      GH_FAST_REARM_FLOOR_MS_MIN,
      over.rearmFloorMs ?? GH_FAST_REARM_FLOOR_MS_DEFAULT
    )
  );
  const base: GhFastConfig = {
    rearmFloorMs: rearm,
    maxSpread: 0.35,
    sideFreshnessMs: 1500,
    depthFreshnessMs: 2000,
    friction: 0.06,
    safetyBuffer: 0.04,
    hardStop: 0.55,
    profitLockActivateMfe: 0.18,
    profitLockFraction: 0.45,
    trailDistance: 0.12,
    depthTopN: 5,
    minSetupQuality: 0.55,
    // Brain V2 B floor: mid of 0.68–0.72. Above A/C (0.55) so B must earn quality
    // from displacement/velocity/efficiency/depth — not a large base contribution.
    minSetupQualityB: 0.7,
    // Mid of 0.40–0.50: reject alternating noise while allowing directional paths.
    breakoutMinEfficiency1s: 0.45,
    breakoutImbalanceMin: 0.15,
    breakoutDepthImbalanceMin: 0.05,
    // Mid of 5–15s secondary B re-arm guard (structural reset is primary).
    breakoutBRearmFloorMs: 8_000,
    momentumVelMin: 0.00008,
    breakoutTouchCount: 2,
    pullbackRetraceMax: 0.45,
    // SMART_POSITION_MANAGER_V1 — Demo forward default ON; set false to roll back.
    smartPositionManagerEnabled: true,
    spmTickSize: 0.01,
    spmMinStopDistance: 0.05,
    spmProtectMfeR: 1.0,
    spmProtect15MfeR: 1.5,
    spmProtect15FloorR: 0.4,
    spmLockMfeR: 2.0,
    spmLockFloorR: 0.9,
    spmRunnerMfeR: 3.0,
    spmRunnerMinFloorR: 1.6,
    spmRunnerTrailR: 1.25,
    spmHarvestMinMfeR: 2.5,
    spmHarvestMinRetraceR: 0.75,
    antiChurnLossMinMs: 8_000,
    antiChurnOppositeFlipMinMs: 15_000
  };
  return { ...base, ...over, rearmFloorMs: rearm };
}
