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
    momentumVelMin: 0.00008,
    breakoutTouchCount: 2,
    pullbackRetraceMax: 0.45
  };
  return { ...base, ...over, rearmFloorMs: rearm };
}
