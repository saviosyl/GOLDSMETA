/**
 * GOLD_HUNTER V1 research / SHADOW configuration.
 * Fail-closed: never enables broker execution.
 */

/** Real-data optimizer revision — never mix with SYNTHETIC_SMOKE metrics. */
export const GOLD_HUNTER_STRATEGY_VERSION = "GOLD_HUNTER_V1_0_R1" as const;
export const GOLD_HUNTER_FEATURE_SCHEMA_VERSION = "gh-features-v1.0.1" as const;
export const GOLD_HUNTER_LABEL_VERSION = "gh-label-bidask-v1.0.0" as const;
export const GOLD_HUNTER_MODEL_FAMILY = "multinomial-logistic-v1" as const;
export const GOLD_HUNTER_MODEL_VERSION = "gh-model-v1.0.1-real7d" as const;
export const GOLD_HUNTER_SYNTHETIC_SMOKE_LABEL = "SYNTHETIC_SMOKE" as const;

export const GH_HORIZONS_SEC = [5, 15, 30, 60] as const;
export type GhHorizonSec = (typeof GH_HORIZONS_SEC)[number];

/** Dedicated evaluation clock (ms). */
export const GH_EVALUATION_INTERVAL_MS = 1000;

/** Max age of either Bid or Ask side for as-of second usability. */
export const GH_SIDE_FRESHNESS_MS = 2000;

/** Max age of consolidated quote for live evaluation. */
export const GH_QUOTE_FRESHNESS_MS = 2000;

/** First valid quote at/after target T must arrive within this window. */
export const GH_TARGET_TOLERANCE_MS = 1500;

/** Chronological split purge between partitions (ms). */
export const GH_PURGE_MS = 60_000;

export const GH_TRAIN_FRACTION = 0.6;
export const GH_VALIDATION_FRACTION = 0.2;
/** Holdout = remainder (0.2). */

/** Historical tick request pacing — keep under official 5/s. */
export const GH_HISTORICAL_MIN_INTERVAL_MS = 250;

/** Abnormal invalid-price rate fail threshold (0.5%). */
export const GH_INVALID_PRICE_RATE_THRESHOLD = 0.005;

/** Candidate net-edge thresholds (USD/oz) for validation selection. */
export const GH_THETA_CANDIDATES = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5] as const;

/** Candidate max-hold seconds for validation selection. */
export const GH_MAX_HOLD_CANDIDATES = [15, 30, 45, 60] as const;

/** Validation entry-policy search grids (mirrored for SELL). */
export const GH_P5_CANDIDATES = [0.6, 0.65, 0.7, 0.75, 0.8] as const;
export const GH_P15_CANDIDATES = [0.6, 0.65, 0.68, 0.7, 0.75] as const;
export const GH_P30_CANDIDATES = [0.55, 0.6, 0.63, 0.65, 0.7] as const;
export const GH_P60_VETO_CANDIDATES = [0.5, 0.55, 0.6] as const;
export const GH_CONFIRMATION_CANDIDATES = [1, 2, 3] as const;

/** Preferred / minimum validation participation. */
export const GH_MIN_VALIDATION_TRADES_PREFERRED = 50;
export const GH_MIN_VALIDATION_TRADES_FLOOR = 30;

/** Default research friction on top of Bid/Ask (already includes spread). */
export const GH_DEFAULT_ENTRY_SLIPPAGE = 0.02;
export const GH_DEFAULT_EXIT_SLIPPAGE = 0.02;
export const GH_DEFAULT_EXECUTION_BUFFER = 0.02;

/** Max acceptable spread for shadow entry (price units). */
export const GH_MAX_ACCEPTABLE_SPREAD = 0.8;

/** Cooldown after shadow exit (ms). */
export const GH_COOLDOWN_MS = 5_000;

/** Take-profit research defaults. */
export const GH_TAKE_PROFIT_SIGNAL_USD = 0.35;
export const GH_TAKE_PROFIT_EDGE_FADE = 0.02;

/** Default protective stop (USD/oz adverse). */
export const GH_DEFAULT_PROTECTIVE_STOP = 0.6;

/** Calibration bin edges for side probability. */
export const GH_CALIBRATION_BIN_EDGES = [
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9
] as const;

/** UI day grouping timezone. */
export const GH_UI_TIMEZONE = "Europe/Dublin" as const;

/** Research display lot — validated against symbol metadata at runtime when available. */
export const GH_RESEARCH_LOT_SIZE = 0.01;
export const GH_RESEARCH_OZ_PER_LOT = 100; // Pepperstone XAUUSD typical; confirm via symbol meta

/** Initial research entry thresholds (frozen after validation sweep). */
export const GH_DEFAULT_ENTRY = {
  pUp5: 0.7,
  pUp15: 0.68,
  pUp30: 0.63,
  pDown5: 0.7,
  pDown15: 0.68,
  pDown30: 0.63,
  p60OpposeMax: 0.55,
  consecutiveEvals: 2,
  maxHoldSec: 60,
  protectiveStop: GH_DEFAULT_PROTECTIVE_STOP
} as const;

export const GH_SHADOW_ONLY = true as const;
export const GH_MUTATION_SURFACE = "NONE" as const;
export const GH_BROKER_EXECUTION_ENABLED = false as const;

export function assertGoldHunterShadowOnly(
  env: NodeJS.ProcessEnv = process.env
): void {
  const raw = (env.MICRO_BROKER_EXECUTION_ENABLED ?? "false").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") {
    throw new Error(
      "GOLD_HUNTER_FAIL_CLOSED: MICRO_BROKER_EXECUTION_ENABLED must remain false"
    );
  }
}

assertGoldHunterShadowOnly();
