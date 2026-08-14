/**
 * GOLD HUNTER FAST research — feed freshness vs transport reconnect policy.
 *
 * Soft stale (~20s): FEED_STALE — block paper / captureHealthy soft path.
 * Does NOT tear down a connected transport.
 *
 * Hard feed stale (45s Spot+Depth silence): HARD_FEED_STALE diagnostic only
 * while transport heartbeat/message liveness is healthy. Does NOT full-detach.
 *
 * Transport reconnect: genuine session failure OR transport-liveness loss
 * (no inbound heartbeat/message within TRANSPORT_LIVENESS_MS), not market quiet.
 *
 * Forensic (deadf271 / gh_research_mstdzd6i_zf956q, Ireland 21:21–21:46):
 * former SCHEDULE_STALE_FEED_RECONNECT on >45s Spot+Depth silence produced an
 * ~110s reconnect loop (backoff index stuck at 0 because brief fresh bursts
 * reset recovery). Spot/Depth silence ≠ broken cTrader transport.
 */
export const GH_FAST_RESEARCH_SOFT_STALE_MS = 20_000;

/**
 * Hard *feed* stale diagnostic threshold (Spot+Depth known ages).
 * Formerly triggered full-session reconnect — that path is retired.
 */
export const GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS = 45_000;

/** Alias — hard feed stale is diagnostic, not a reconnect trigger. */
export const GH_FAST_RESEARCH_HARD_FEED_STALE_MS =
  GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS;

export const GH_FAST_RESEARCH_HARD_STALE_THRESHOLD_REASON =
  "45s Spot+Depth silence is HARD_FEED_STALE diagnostic only while transport heartbeat/message liveness is healthy. Full session reconnect is reserved for genuine transport/auth/liveness loss — not market quiet. (Former stale-feed reconnect loop on deadf271 / gh_research_mstdzd6i_zf956q.)" as const;

/**
 * Official cTrader Open API recommends ProtoHeartbeatEvent ~every 10s when
 * no other market messages are flowing. Research-only opt-in cadence.
 */
export const GH_FAST_RESEARCH_TRANSPORT_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Transport-liveness timeout: no inbound transport message/heartbeat.
 * 40s ≈ four missed 10s heartbeat intervals — conservative, within the
 * former 35–45s band. Must NOT be interpreted as Spot/Depth silence.
 */
export const GH_FAST_RESEARCH_TRANSPORT_LIVENESS_MS = 40_000;

export const GH_FAST_RESEARCH_TRANSPORT_LIVENESS_REASON =
  "ProtoHeartbeatEvent outbound cadence 10s (research opt-in keep-alive). Remote liveness requires recent INBOUND ProtoHeartbeatEvent or other inbound platform message within 40s. Live quiet-market sample on f697b1f / gh_research_mstfgzl3_2lsmyp: inbound HB intervals ≈30.000s (min/median/p95/max). 40s retains ~10s margin above observed healthy inbound gaps. Successful local sendHeartbeat() is attempt telemetry only — not remote proof." as const;

/**
 * @deprecated Retained for telemetry compatibility with prior runs.
 * Full stale-feed reconnect is no longer scheduled while transport is live.
 */
export const GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS = [
  120_000, // 2 min
  300_000, // 5 min
  900_000 // 15 min max
] as const;

export type ResearchReconnectReason =
  | "transport_disconnect"
  | "transport_liveness_lost"
  | "stale_feed" // historical / unused for new schedules
  | "oauth_missing"
  | "connect_failed";

export type StaleReconnectDecision =
  | { action: "NONE"; feedSoftStale: false; feedHardStale: false }
  | {
      action: "SOFT_STALE_ONLY";
      feedSoftStale: true;
      feedHardStale: false;
    }
  | {
      /** Spot+Depth known ages past hard threshold; transport still live. */
      action: "HARD_FEED_STALE";
      feedSoftStale: true;
      feedHardStale: true;
    }
  | {
      action: "SCHEDULE_TRANSPORT_RECONNECT";
      feedSoftStale: boolean;
      feedHardStale: boolean;
      reason: "transport_disconnect" | "transport_liveness_lost";
    }
  /** @deprecated No longer emitted while transport liveness is healthy. */
  | {
      action: "SCHEDULE_STALE_FEED_RECONNECT";
      feedSoftStale: true;
      feedHardStale: true;
      reason: "stale_feed";
    }
  /** @deprecated Stale-feed backoff path retired with full stale reconnect. */
  | {
      action: "STALE_BACKOFF_WAIT";
      feedSoftStale: true;
      feedHardStale: boolean;
      reason: "stale_feed";
      nextEligibleAtMs: number;
      backoffMs: number;
    };

export function ageExceeds(
  ageMs: number | null | undefined,
  thresholdMs: number
): boolean {
  return ageMs == null || ageMs > thresholdMs;
}

/**
 * Soft stale: missing ages OR ages older than soft threshold.
 * Used for FEED_STALE / paper block — does not tear down transport.
 */
export function bothFeedsSoftStale(
  spotAgeMs: number | null | undefined,
  depthAgeMs: number | null | undefined,
  softStaleMs: number
): boolean {
  return bothFeedsExceed(spotAgeMs, depthAgeMs, softStaleMs);
}

/**
 * Hard feed stale requires *known* ages past the hard threshold.
 * Null ages (startup / post-reconnect before first Spot+Depth) are soft-stale
 * only — never a transport teardown signal.
 */
export function bothFeedsHardStale(
  spotAgeMs: number | null | undefined,
  depthAgeMs: number | null | undefined,
  hardStaleReconnectMs: number
): boolean {
  return (
    spotAgeMs != null &&
    depthAgeMs != null &&
    spotAgeMs > hardStaleReconnectMs &&
    depthAgeMs > hardStaleReconnectMs
  );
}

export function bothFeedsExceed(
  spotAgeMs: number | null | undefined,
  depthAgeMs: number | null | undefined,
  thresholdMs: number
): boolean {
  return (
    ageExceeds(spotAgeMs, thresholdMs) && ageExceeds(depthAgeMs, thresholdMs)
  );
}

export function staleFeedBackoffMs(attemptIndex: number): number {
  const steps = GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS;
  if (attemptIndex <= 0) return steps[0]!;
  if (attemptIndex >= steps.length) return steps[steps.length - 1]!;
  return steps[attemptIndex]!;
}

/**
 * Pure decision for the research stale/transport watchdog.
 * Does not mutate state — caller applies reconnectInFlight / timers.
 *
 * transportLivenessHealthy: inbound ProtoHeartbeatEvent / any transport
 * message younger than TRANSPORT_LIVENESS_MS (or unknown→treat as healthy
 * only when connectionState is CONNECTED and caller has no HB yet — prefer
 * explicit boolean from process).
 */
export function decideResearchStaleReconnect(input: {
  nowMs: number;
  connectionState: string;
  spotAgeMs: number | null;
  depthAgeMs: number | null;
  softStaleMs?: number;
  hardStaleReconnectMs?: number;
  reconnectInFlight: boolean;
  /**
   * When false, schedule transport reconnect even if Spot/Depth are quiet.
   * When true, Spot/Depth silence must NOT full-detach.
   */
  transportLivenessHealthy: boolean;
  /** @deprecated Ignored — stale-feed full reconnect retired. */
  lastStaleFeedReconnectAttemptMs?: number | null;
  /** @deprecated Ignored — stale-feed full reconnect retired. */
  staleFeedBackoffIndex?: number;
}): StaleReconnectDecision {
  const soft = input.softStaleMs ?? GH_FAST_RESEARCH_SOFT_STALE_MS;
  const hard =
    input.hardStaleReconnectMs ?? GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS;

  const softStale = bothFeedsSoftStale(
    input.spotAgeMs,
    input.depthAgeMs,
    soft
  );
  const hardStale = bothFeedsHardStale(
    input.spotAgeMs,
    input.depthAgeMs,
    hard
  );

  if (input.reconnectInFlight) {
    return softStale
      ? {
          action: "SOFT_STALE_ONLY",
          feedSoftStale: true,
          feedHardStale: false
        }
      : { action: "NONE", feedSoftStale: false, feedHardStale: false };
  }

  if (
    input.connectionState === "DISCONNECTED" ||
    input.connectionState === "RECONNECTING"
  ) {
    return {
      action: "SCHEDULE_TRANSPORT_RECONNECT",
      feedSoftStale: softStale,
      feedHardStale: hardStale,
      reason: "transport_disconnect"
    };
  }

  // Connected cohort but heartbeat/message liveness lost → genuine transport recovery.
  if (!input.transportLivenessHealthy) {
    return {
      action: "SCHEDULE_TRANSPORT_RECONNECT",
      feedSoftStale: softStale,
      feedHardStale: hardStale,
      reason: "transport_liveness_lost"
    };
  }

  if (!softStale) {
    return { action: "NONE", feedSoftStale: false, feedHardStale: false };
  }

  if (hardStale) {
    return {
      action: "HARD_FEED_STALE",
      feedSoftStale: true,
      feedHardStale: true
    };
  }

  return {
    action: "SOFT_STALE_ONLY",
    feedSoftStale: true,
    feedHardStale: false
  };
}
