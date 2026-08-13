/**
 * GOLD_HUNTER V1.1 identity — never overwrite V1 real-7d results.
 */

/** Preserved V1 real-7d research identity (do not mutate artifacts). */
export const GOLD_HUNTER_V1_REAL_7D_RUN_ID = "GH_REAL_7D_20260813_d1b08b82" as const;
export const GOLD_HUNTER_V1_REAL_7D_LABEL = "GOLD_HUNTER_V1_REAL_7D" as const;
export const GOLD_HUNTER_V1_CLASSIFICATION = "INSUFFICIENT_EDGE" as const;

/** Start of already-inspected V1 window — V1.1 must end before this. */
export const V1_REAL_7D_WINDOW_START_MS = Date.parse(
  "2026-08-06T11:49:08.494Z"
);
export const V1_REAL_7D_WINDOW_END_MS = Date.parse(
  "2026-08-13T11:49:08.494Z"
);

export const V11_DEV_WINDOW_DAYS = 28;

export const GOLD_HUNTER_V11_STRATEGY_VERSION = "GOLD_HUNTER_V1_1" as const;
export const GOLD_HUNTER_V11_MODEL_RESEARCH_VERSION = "GH_EDGE_V1_1" as const;
export const GOLD_HUNTER_V11_FEATURE_SCHEMA_VERSION =
  "gh-features-v1.1.0" as const;

export type V11ModelFamily =
  | "multinomial_v1_baseline"
  | "independent_binary"
  | "direct_edge_ridge"
  | "stump_boost_edge";

export type V11ArchitectureId =
  | "A_5s_primary"
  | "B_15s_primary"
  | "C_30s_primary"
  | "D_60s_primary"
  | "E_5_15_ensemble"
  | "F_15_30_ensemble"
  | "G_5_15_30_ensemble"
  | "H_15_30_60_ensemble";

export type V11RankSignalClass =
  | "NO_SIGNAL"
  | "WEAK_RANK_SIGNAL"
  | "USABLE_RANK_SIGNAL";

export type V11QualificationStatus =
  | "POSITIVE"
  | "MIXED"
  | "NEGATIVE"
  | "NO_PREDICTIVE_EDGE"
  | "BLOCKED"
  | "INSUFFICIENT_EDGE";
