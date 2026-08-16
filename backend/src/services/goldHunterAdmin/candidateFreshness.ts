/**
 * Candidate freshness at execution time — frozen sideFreshnessMs / depthFreshnessMs.
 * Do not invent new thresholds.
 */
import { frozenGhFastSoakConfig } from "./abc";
import type { GoldHunterSelectedCandidate } from "./strategySelector";
import {
  getGoldHunterStrategySelector,
  isDepthExecutableForOrder
} from "./strategySelector";

export type FreshnessCheckResult =
  | { ok: true }
  | { ok: false; blocker: "WAIT — SIGNAL STALE"; detail: string };

/**
 * Verify the opportunity is still fresh against live selector state
 * at the moment of durable claim / broker submission.
 */
export function assertGoldHunterCandidateFresh(args: {
  ownerUid: string;
  candidate: GoldHunterSelectedCandidate;
  nowMs?: number;
}): FreshnessCheckResult {
  const now = args.nowMs ?? Date.now();
  const cfg = frozenGhFastSoakConfig();
  const sel = getGoldHunterStrategySelector(args.ownerUid);
  const snap = sel.getLastSnapshot();
  const c = args.candidate;

  if (c.resyncGeneration !== sel.getResyncGeneration()) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: "resync_generation_mismatch"
    };
  }
  if (!snap) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: "no_live_snapshot"
    };
  }
  if (c.bookGeneration !== snap.bookGeneration) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: "book_generation_mismatch"
    };
  }
  if (!isDepthExecutableForOrder(snap.depthValidity)) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: `depth_${snap.depthValidity}`
    };
  }

  const spotAt = sel.getLastSpotAtMs();
  const depthAt = sel.getLastDepthAtMs();
  if (spotAt == null || now - spotAt > cfg.sideFreshnessMs) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: "spot_side_stale"
    };
  }
  if (depthAt == null || now - depthAt > cfg.depthFreshnessMs) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: "depth_stale"
    };
  }

  const depthAgeMs =
    snap.depthStats.lastUpdateMs != null
      ? now - snap.depthStats.lastUpdateMs
      : null;
  if (depthAgeMs == null || depthAgeMs > cfg.depthFreshnessMs) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: "depth_book_age"
    };
  }

  return { ok: true };
}
