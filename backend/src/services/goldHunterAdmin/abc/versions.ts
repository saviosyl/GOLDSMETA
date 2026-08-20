/**
 * GOLD_HUNTER FAST — event-driven live microstructure scalper identity.
 * V1/V2 research baselines preserved in git history.
 * Brain V3: Setup A 1s direction consistency + post-loss anti-churn.
 */
/** Brain identity for Demo A/B/C selection — distinguishable from V1/V2. */
export const GOLD_HUNTER_BRAIN_VERSION = "GOLD_HUNTER_BRAIN_V3" as const;
/**
 * Smart position-management layer on top of the current brain.
 * Kept separate so brainVersion telemetry stays stable.
 */
export const GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION =
  "SMART_POSITION_MANAGER_V1" as const;
/**
 * Smart loss-side controller on top of the current brain + Smart PM V1.
 * Kept separate so brainVersion / positionManagerVersion stay stable.
 */
export const GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION =
  "SMART_LOSS_CONTROLLER_V1" as const;
/**
 * Strategy version stamped on selector candidates / frozen identity.
 * Brain V3: Setup A 1s direction consistency + post-loss anti-churn.
 * B remains Brain V2; C unchanged from V1.
 */
export const GOLD_HUNTER_FAST_STRATEGY_VERSION =
  GOLD_HUNTER_BRAIN_VERSION;
export const GOLD_HUNTER_FAST_ENGINE_VERSION = "GH_FAST_EVENT_V1" as const;
/** Feature schema includes priorHigh/Low* (past-only, excludes current tick). */
export const GOLD_HUNTER_FAST_FEATURE_SCHEMA_VERSION =
  "gh-fast-features-v1.1.0" as const;

/** Engineering latency targets (ms) — not broker guarantees. */
export const GH_FAST_LATENCY_P50_TARGET_MS = 20;
export const GH_FAST_LATENCY_P95_TARGET_MS = 50;

/** Re-arm floor after close — prevent duplicate-event double-fire only. */
export const GH_FAST_REARM_FLOOR_MS_DEFAULT = 350;
export const GH_FAST_REARM_FLOOR_MS_MIN = 250;
export const GH_FAST_REARM_FLOOR_MS_MAX = 500;

export const GH_FAST_MAX_OPEN_POSITIONS = 1 as const;
export const GH_FAST_MUTATION_SURFACE = "NONE" as const;
export const GH_FAST_SHADOW_ONLY = true as const;
export const GH_FAST_BROKER_EXECUTION_ENABLED = false as const;

/** Default false — collector must set GOLD_HUNTER_FAST_SHADOW_ENABLED=true. */
export function isGoldHunterFastShadowEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (env.GOLD_HUNTER_FAST_SHADOW_ENABLED ?? "false").toLowerCase() === "true";
}
