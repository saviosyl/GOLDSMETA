/**
 * GOLD HUNTER FAST — Depth book recovery + research depth-validity semantics.
 *
 * Forensic basis (raw run gh_research_mst6992t_ug7ykh):
 *   - Stale bestBid 4387.32 pinned by quote id 2361229607
 *   - Quote seen once at receiveSeq=297; never in deletedQuotes; never size=0
 *   - Session disconnect @321 left pre-disconnect cohort immortal after resubscribe
 *   - Self-healing crossed periods observed at ~1004ms and ~4511ms
 *   - Stuck crossed period after ghost bid: ~56 minutes
 *
 * Thresholds are book-integrity ops knobs — NOT strategy / trade-count tuning.
 */
import type { DepthBookStats } from "./depthBook";

/**
 * Continuous crossed/unavailable duration before forcing recovery.
 * Chosen above observed healthy transient max (~4.5s) and far below the
 * Day-1 stuck failure (~56 min). Not tuned to increase paper trades.
 */
export const GH_FAST_SUSTAINED_CROSS_RECOVERY_MS = 10_000;

/**
 * Minimum spacing between sustained-cross recovery attempts to avoid
 * resync storms while the book rebuilds after clear + resubscribe.
 */
export const GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS = 30_000;

export const GH_FAST_DEPTH_RECOVERY_THRESHOLD_REASON =
  "Day-1 raw gh_research_mst6992t_ug7ykh: healthy crossed self-healed in ≤4511ms; stale ghost bid crossed ~56min. 10s is above transient max for integrity recovery; 30s cooldown prevents resync storms. Not trade-count tuning." as const;

export type ResearchDepthValidity =
  | "DEPTH_VALID"
  | "DEPTH_UNAVAILABLE"
  | "DEPTH_CROSSED"
  | "DEPTH_STALE"
  | "RESYNC_RECOVERY";

export type DepthValidityInput = {
  stats: Pick<
    DepthBookStats,
    "available" | "crossed" | "bidLevels" | "askLevels" | "lastUpdateMs"
  >;
  /** True while waiting for a fresh valid book after ordered resync clear. */
  recoveryInFlight: boolean;
  depthAgeMs: number | null;
  depthFreshnessMs: number;
};

/**
 * Classify Depth semantic validity for research specialist rows.
 * Contaminated ≠ deleted: raw rows remain; offline qualification must not
 * treat non-DEPTH_VALID specialist rows as clean research evidence.
 */
export function classifyResearchDepthValidity(
  input: DepthValidityInput
): ResearchDepthValidity {
  if (input.recoveryInFlight) return "RESYNC_RECOVERY";
  if (input.stats.crossed) return "DEPTH_CROSSED";
  if (!input.stats.available) return "DEPTH_UNAVAILABLE";
  if (
    input.depthAgeMs == null ||
    input.depthAgeMs > input.depthFreshnessMs
  ) {
    return "DEPTH_STALE";
  }
  return "DEPTH_VALID";
}

export function isDerivedDataContaminated(
  validity: ResearchDepthValidity
): boolean {
  return validity !== "DEPTH_VALID";
}

export type SustainedCrossRecoveryDecision =
  | { action: "NONE" }
  | {
      action: "TRIGGER_RECOVERY";
      reason: "sustained_crossed_book";
      crossedDurationMs: number;
      thresholdMs: number;
      cooldownMs: number;
    };

/**
 * Bounded deterministic recovery gate.
 * Requires continuous crossed state while depth events continue (caller
 * invokes only from DEPTH apply path).
 */
export function decideSustainedCrossRecovery(args: {
  crossed: boolean;
  crossedSinceMs: number | null;
  nowMs: number;
  recoveryInFlight: boolean;
  lastRecoveryAttemptMs: number | null;
  thresholdMs?: number;
  cooldownMs?: number;
}): SustainedCrossRecoveryDecision {
  const thresholdMs = args.thresholdMs ?? GH_FAST_SUSTAINED_CROSS_RECOVERY_MS;
  const cooldownMs =
    args.cooldownMs ?? GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS;
  if (!args.crossed || args.crossedSinceMs == null) return { action: "NONE" };
  if (args.recoveryInFlight) return { action: "NONE" };
  const crossedDurationMs = Math.max(0, args.nowMs - args.crossedSinceMs);
  if (crossedDurationMs < thresholdMs) return { action: "NONE" };
  if (
    args.lastRecoveryAttemptMs != null &&
    args.nowMs - args.lastRecoveryAttemptMs < cooldownMs
  ) {
    return { action: "NONE" };
  }
  return {
    action: "TRIGGER_RECOVERY",
    reason: "sustained_crossed_book",
    crossedDurationMs,
    thresholdMs,
    cooldownMs
  };
}
