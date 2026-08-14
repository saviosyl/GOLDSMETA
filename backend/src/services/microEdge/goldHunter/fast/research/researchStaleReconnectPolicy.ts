/**
 * GOLD HUNTER FAST research — stale-feed vs hard reconnect policy.
 *
 * Soft stale (~20s freshness) = FEED_STALE: block paper entry / captureHealthy
 * soft path. Does NOT tear down a connected transport.
 *
 * Hard stale (45s) = operational reconnect for prolonged silence while
 * transport still claims connected. Chosen above Day-1 observed quiet gaps
 * (~22–26.5s on gh_research_mst8r61c_1corxy). NOT strategy tuning.
 *
 * Quiet/market-closed storm protection: after a stale-feed reconnect that
 * does not restore fresh data, stepped backoff (2m → 5m → 15m) before the
 * next stale-feed reconnect. Transport disconnect recovery stays prompt.
 */
export const GH_FAST_RESEARCH_SOFT_STALE_MS = 20_000;

/**
 * Hard reconnect threshold for connected-but-silent Spot+Depth.
 * Evidence: run gh_research_mst8r61c_1corxy quiet gaps ~22–26.5s before
 * the previous 20s hard rule flapped. 45s is safely above those gaps.
 */
export const GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS = 45_000;

export const GH_FAST_RESEARCH_HARD_STALE_THRESHOLD_REASON =
  "Observed legitimate quiet Spot+Depth gaps ~22–26.5s on gh_research_mst8r61c_1corxy; 45s hard reconnect is an ops integrity threshold above those gaps — not A/B/C or paper-policy tuning." as const;

/** Stepped backoff after stale-feed reconnects that do not restore fresh data. */
export const GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS = [
  120_000, // 2 min
  300_000, // 5 min
  900_000 // 15 min max
] as const;

export type ResearchReconnectReason =
  | "transport_disconnect"
  | "stale_feed"
  | "oauth_missing"
  | "connect_failed";

export type StaleReconnectDecision =
  | { action: "NONE"; feedSoftStale: false }
  | { action: "SOFT_STALE_ONLY"; feedSoftStale: true }
  | {
      action: "SCHEDULE_TRANSPORT_RECONNECT";
      feedSoftStale: boolean;
      reason: "transport_disconnect";
    }
  | {
      action: "SCHEDULE_STALE_FEED_RECONNECT";
      feedSoftStale: true;
      reason: "stale_feed";
    }
  | {
      action: "STALE_BACKOFF_WAIT";
      feedSoftStale: true;
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
 * Pure decision for the research stale watchdog (call every few seconds).
 * Does not mutate state — caller applies reconnectInFlight / timers.
 */
export function decideResearchStaleReconnect(input: {
  nowMs: number;
  connectionState: string;
  spotAgeMs: number | null;
  depthAgeMs: number | null;
  softStaleMs?: number;
  hardStaleReconnectMs?: number;
  reconnectInFlight: boolean;
  /** Last time a stale-feed reconnect was started (not transport). */
  lastStaleFeedReconnectAttemptMs: number | null;
  /** 0-based index into backoff steps after consecutive unproductive stale reconnects. */
  staleFeedBackoffIndex: number;
}): StaleReconnectDecision {
  const soft = input.softStaleMs ?? GH_FAST_RESEARCH_SOFT_STALE_MS;
  const hard =
    input.hardStaleReconnectMs ?? GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS;

  if (input.reconnectInFlight) {
    const softNow = bothFeedsExceed(input.spotAgeMs, input.depthAgeMs, soft);
    return softNow
      ? { action: "SOFT_STALE_ONLY", feedSoftStale: true }
      : { action: "NONE", feedSoftStale: false };
  }

  if (
    input.connectionState === "DISCONNECTED" ||
    input.connectionState === "RECONNECTING"
  ) {
    return {
      action: "SCHEDULE_TRANSPORT_RECONNECT",
      feedSoftStale: bothFeedsExceed(input.spotAgeMs, input.depthAgeMs, soft),
      reason: "transport_disconnect"
    };
  }

  const softStale = bothFeedsExceed(input.spotAgeMs, input.depthAgeMs, soft);
  if (!softStale) {
    return { action: "NONE", feedSoftStale: false };
  }

  const hardStale = bothFeedsExceed(input.spotAgeMs, input.depthAgeMs, hard);
  if (!hardStale) {
    return { action: "SOFT_STALE_ONLY", feedSoftStale: true };
  }

  if (input.lastStaleFeedReconnectAttemptMs != null) {
    const backoffMs = staleFeedBackoffMs(input.staleFeedBackoffIndex);
    const nextEligibleAtMs =
      input.lastStaleFeedReconnectAttemptMs + backoffMs;
    if (input.nowMs < nextEligibleAtMs) {
      return {
        action: "STALE_BACKOFF_WAIT",
        feedSoftStale: true,
        reason: "stale_feed",
        nextEligibleAtMs,
        backoffMs
      };
    }
  }

  return {
    action: "SCHEDULE_STALE_FEED_RECONNECT",
    feedSoftStale: true,
    reason: "stale_feed"
  };
}
