/**
 * GOLD_HUNTER V1.2 identity — walk-forward fast edge.
 * Preserves V1 and V1.1 baselines permanently (do not mutate their artifacts).
 */

import {
  GOLD_HUNTER_V1_CLASSIFICATION,
  GOLD_HUNTER_V1_REAL_7D_LABEL,
  GOLD_HUNTER_V1_REAL_7D_RUN_ID,
  GOLD_HUNTER_V11_STRATEGY_VERSION,
  V1_REAL_7D_WINDOW_END_MS,
  V1_REAL_7D_WINDOW_START_MS
} from "../v11/versions";

/** Preserved V1.1 NEGATIVE research identity. */
export const GOLD_HUNTER_V11_NEGATIVE_FROZEN_SHA =
  "e5e5e55ec72b4598003c04a97eb7e1676572078089526012228f52a468e5b84d" as const;
export const GOLD_HUNTER_V11_CLASSIFICATION = "NEGATIVE" as const;
export const GOLD_HUNTER_V11_FAMILY = "independent_binary" as const;
export const GOLD_HUNTER_V11_ARCHITECTURE = "E_5_15_ensemble" as const;

/** V1.1 development window — KNOWN, not for V1.2 selection. */
export const V11_DEV_WINDOW_START_MS = Date.parse(
  "2026-07-09T11:49:08.493Z"
);
export const V11_DEV_WINDOW_END_MS = Date.parse("2026-08-06T11:49:08.493Z");

/** V1.2 development must end before V1.1 development start. */
export const V12_DEV_WINDOW_END_MS = V11_DEV_WINDOW_START_MS - 1;
export const V12_DEV_WINDOW_DAYS = 56;

export const GOLD_HUNTER_V12_STRATEGY_VERSION = "GOLD_HUNTER_V1_2" as const;
export const GOLD_HUNTER_V12_MODEL_RESEARCH_VERSION = "GH_EDGE_V1_2" as const;
export const GOLD_HUNTER_V12_FEATURE_SCHEMA_VERSION =
  "gh-features-v1.2.0" as const;

export {
  GOLD_HUNTER_V1_CLASSIFICATION,
  GOLD_HUNTER_V1_REAL_7D_LABEL,
  GOLD_HUNTER_V1_REAL_7D_RUN_ID,
  GOLD_HUNTER_V11_STRATEGY_VERSION,
  V1_REAL_7D_WINDOW_END_MS,
  V1_REAL_7D_WINDOW_START_MS
};

export type V12ModelFamily =
  | "independent_binary"
  | "direct_edge_ridge"
  | "stump_boost_edge"
  | "shallow_boost_edge"
  | "two_stage_opportunity";

export type V12ArchitectureId =
  | "M1s_5s"
  | "M3s_15s"
  | "M5s_15s"
  | "E_5_15"
  | "BREAKOUT_M1"
  | "REVERSAL_M1_M5";

export type V12ExitArchitecture =
  | "FIXED_MAX_HOLD"
  | "EDGE_FADE"
  | "EDGE_FLIP"
  | "DYNAMIC_TRAIL"
  | "HYBRID_TRAIL_FADE";

export type V12QualificationStatus =
  | "POSITIVE"
  | "MIXED"
  | "NEGATIVE"
  | "NO_ROBUST_FAST_EDGE"
  | "BLOCKED"
  | "INSUFFICIENT_EDGE";

/** Periods that must not tune V1.2 selection. */
export const V12_KNOWN_STRESS_PERIODS = [
  {
    id: "V11_DEVELOPMENT",
    fromMs: V11_DEV_WINDOW_START_MS,
    toMs: V11_DEV_WINDOW_END_MS,
    label: "KNOWN_STRESS_REPLAY"
  },
  {
    id: "V11_RECOVERY_HOLDOUT_SLICE",
    fromMs: Date.parse("2026-07-31T11:38:35Z"),
    toMs: V11_DEV_WINDOW_END_MS,
    label: "KNOWN_STRESS_REPLAY"
  },
  {
    id: "AUG6_13_KNOWN_AUDIT",
    fromMs: V1_REAL_7D_WINDOW_START_MS,
    toMs: V1_REAL_7D_WINDOW_END_MS,
    label: "KNOWN_STRESS_REPLAY"
  }
] as const;
