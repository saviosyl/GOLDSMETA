/**
 * GOLD_HUNTER FAST — event-driven live microstructure scalper identity.
 * V1 research baselines preserved in git history.
 * Brain V2 revises Setup B entry quality only (Demo forward validation).
 */
/** Brain identity for Demo A/B/C selection — distinguishable from V1. */
export const GOLD_HUNTER_BRAIN_VERSION = "GOLD_HUNTER_BRAIN_V2" as const;
/**
 * Strategy version stamped on selector candidates / frozen identity.
 * Brain V2: Setup B uses prior-only breakouts + stronger confirmation.
 * A/C specialist logic unchanged from V1.
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
