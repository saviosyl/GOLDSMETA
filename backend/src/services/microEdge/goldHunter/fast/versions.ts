/**
 * GOLD_HUNTER FAST — event-driven live microstructure scalper identity.
 * Preserves V1 / V1.1 / V1.2 research baselines; does not retune them.
 */
export const GOLD_HUNTER_FAST_STRATEGY_VERSION = "GOLD_HUNTER_FAST_V1" as const;
export const GOLD_HUNTER_FAST_ENGINE_VERSION = "GH_FAST_EVENT_V1" as const;
export const GOLD_HUNTER_FAST_FEATURE_SCHEMA_VERSION =
  "gh-fast-features-v1.0.0" as const;

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
