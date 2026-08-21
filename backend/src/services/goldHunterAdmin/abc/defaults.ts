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
    // Broker hard stop remains emergency protection; V6 normal exits are earlier.
    hardStop: 0.55,
    profitLockActivateMfe: 0.18,
    profitLockFraction: 0.45,
    trailDistance: 0.12,
    depthTopN: 5,
    minSetupQuality: 0.55,
    // Brain V2 B floor: retained for shadow/research diagnostics.
    minSetupQualityB: 0.7,
    breakoutMinEfficiency1s: 0.45,
    breakoutImbalanceMin: 0.15,
    breakoutDepthImbalanceMin: 0.05,
    breakoutBRearmFloorMs: 8_000,
    momentumVelMin: 0.00008,
    breakoutTouchCount: 2,
    pullbackRetraceMax: 0.45,
    // SMART_POSITION_MANAGER_V1 — keep the proven runner/protection geometry
    // unchanged in V6. Modest winners are handled sooner by Smart Loss harvest.
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
    antiChurnLossMinMs: 30_000,
    antiChurnOppositeFlipMinMs: 30_000,
    // SMART_LOSS_CONTROLLER_V1 — Brain V6 economics:
    // cut ordinary losers earlier and harvest modest profits sooner on deterioration.
    smartLossControllerEnabled: true,
    slcSoftMaxLossR: 0.45,
    slcHandoffMfeR: 1.0,
    slcEarlyFailureMaxMfeR: 0.45,
    slcEarlyFailureMinMaeR: 0.12,
    slcEarlyFailureMinConfirms: 2,
    slcSmallHarvestMinMfeR: 0.3,
    slcSmallHarvestMinSurrenderR: 0.08,
    // Two consecutive losses trigger a mandatory recovery window plus the
    // selector's fresh-regime requirement before another entry can pass.
    slcLossStreakCount: 2,
    slcLossStreakResetMs: 120_000,
    // Stop a broader loss cluster earlier than V5; recovery still requires
    // time + structural reset + renewed directional confirmation.
    slcRollingCircuitBreakerR: 2.0,
    slcRollingWindowTrades: 8,
    slcCircuitBreakerResetMs: 180_000
  };
  return { ...base, ...over, rearmFloorMs: rearm };
}
