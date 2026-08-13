/**
 * Micro Edge V1 configuration — SHADOW ONLY.
 * Fail-closed if any broker execution flag is enabled.
 */

export const MICRO_FEATURE_VERSION = "features-v1.0.0";
export const MICRO_MODEL_VERSION = "logistic-champion-v1.0.0";
export const MICRO_LABEL_VERSION = "label-theta-v1.0.0";
export const MICRO_COST_MODEL_VERSION = "cost-proxy-v1.0.0";
export const MICRO_CALIBRATION_VERSION = "calibration-none-v1.0.0";
export const MICRO_REGIME_VERSION = "regime-v1.0.0";
export const MICRO_SESSION_VERSION = "session-v1.0.0";
export const MICRO_NAMESPACE = "microEdge/shadow-v1";

export type MicroHorizon = "1m" | "5m" | "15m";

export const MICRO_HORIZONS: MicroHorizon[] = ["1m", "5m", "15m"];
export const MICRO_PRIMARY_HORIZON: MicroHorizon = "5m";

/** Max seconds after target to accept an exit quote. */
export const MICRO_TARGET_QUOTE_TOLERANCE_SECONDS = 5;

/** Assumed execution latency for slippage proxy (ms). */
export const MICRO_SLIPPAGE_LATENCY_MS = 250;

/** Execution buffer in price units (USD/oz). */
export const MICRO_EXECUTION_BUFFER = 0.02;

/** Max quote age (ms) for collector health / freshness. */
export const MICRO_QUOTE_MAX_AGE_MS = 30_000;

/** Max age (ms) of last completed M1 close for collector health. */
export const MICRO_M1_MAX_AGE_MS = 5 * 60_000;

/** Default Bid/Ask sample persist interval (ms). */
export const MICRO_QUOTE_SAMPLE_INTERVAL_MS = Number(
  process.env.MICRO_QUOTE_SAMPLE_INTERVAL_MS ?? 5000
);

/** Historical Bid/Ask boundary backfill days (default 30). */
export const MICRO_HISTORICAL_QUOTE_BACKFILL_DAYS = Number(
  process.env.MICRO_HISTORICAL_QUOTE_BACKFILL_DAYS ?? 30
);

/** Max window for a single ProtoOAGetTickDataReq (7 days). */
export const MICRO_HISTORICAL_TICK_MAX_WINDOW_MS = 604_800_000;

/** Boundary quote side tolerance after minute T (ms). */
export const MICRO_BOUNDARY_QUOTE_TOLERANCE_MS = 5_000;

/** Conservative historical request pacing (~2 req/s). */
export const MICRO_HISTORICAL_MIN_INTERVAL_MS = Number(
  process.env.MICRO_HISTORICAL_MIN_INTERVAL_MS ?? 500
);

/** Minimum positive NET edge theta by horizon (USD/oz). Validation-selected, frozen for V1. */
export const MICRO_THETA: Record<MicroHorizon, number> = {
  "1m": 0.05,
  "5m": 0.08,
  "15m": 0.12
};

export function assertMicroShadowOnly(env: NodeJS.ProcessEnv = process.env): void {
  const raw = (env.MICRO_BROKER_EXECUTION_ENABLED ?? "false").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") {
    throw new Error(
      "MICRO_EDGE_FAIL_CLOSED: MICRO_BROKER_EXECUTION_ENABLED must remain false (SHADOW ONLY)."
    );
  }
  // Defense: never allow Live either.
  if ((env.CTRADER_LIVE_ENABLED ?? "").trim().toLowerCase() === "true") {
    // Micro still refuses to execute; do not mutate Core flags — just document shadow stance.
  }
}

assertMicroShadowOnly();

export const MICRO_SHADOW_ONLY = true as const;
export const MICRO_BROKER_EXECUTION_ENABLED = false as const;
