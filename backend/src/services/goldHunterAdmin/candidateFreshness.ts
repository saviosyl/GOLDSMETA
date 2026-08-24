/**
 * Candidate freshness at execution time — frozen sideFreshnessMs / depthFreshnessMs.
 * Do not invent new thresholds.
 *
 * IMPORTANT: bookGeneration may advance while a queued opportunity waits for the
 * async execution queue (harmless Depth updates). Reject only when the active
 * opportunity identity diverges, resync changes, Depth/spot is truly stale/invalid,
 * or setup/side no longer matches.
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
  const opportunityId = c.opportunityId || c.signalId;

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

  const activeId = sel.getActiveOpportunityId();
  // Identity for book-race allowance does NOT require depthExecutable —
  // Depth validity is checked separately below with the frozen thresholds.
  const sameOpportunityIdentity =
    activeId === opportunityId &&
    c.resyncGeneration === sel.getResyncGeneration();

  if (!sameOpportunityIdentity) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: "opportunity_no_longer_active"
    };
  }

  const liveDisplay = sel.getLastCandidate();
  if (
    liveDisplay &&
    liveDisplay.opportunityId === opportunityId &&
    (liveDisplay.setup !== c.setup || liveDisplay.side !== c.side)
  ) {
    return {
      ok: false,
      blocker: "WAIT — SIGNAL STALE",
      detail: "setup_or_side_changed"
    };
  }

  // Harmless Depth advance while the SAME opportunity remains active — OK.
  // (Do not require exact bookGeneration match.)

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

/**
 * Refresh market fields from the live active opportunity while preserving
 * opportunity identity (same opportunityId). Returns null if identity diverged.
 */
export function refreshGoldHunterCandidateAgainstLive(args: {
  ownerUid: string;
  candidate: GoldHunterSelectedCandidate;
}): GoldHunterSelectedCandidate | null {
  const sel = getGoldHunterStrategySelector(args.ownerUid);
  const opportunityId =
    args.candidate.opportunityId || args.candidate.signalId;
  if (sel.getActiveOpportunityId() !== opportunityId) return null;
  const live =
    sel.getExecutableCandidate() ??
    (sel.getLastCandidate()?.opportunityId === opportunityId
      ? sel.getLastCandidate()
      : null);
  if (!live) return null;
  if (live.opportunityId !== opportunityId) return null;
  if (live.setup !== args.candidate.setup || live.side !== args.candidate.side) {
    return null;
  }
  if (live.resyncGeneration !== args.candidate.resyncGeneration) return null;
  return {
    ...args.candidate,
    // Copy the full live candidate, not only price fields. Final pretransport
    // safety must use current M1 quality and microstructure rather than the
    // original queued observation.
    ...live,
    signalId: args.candidate.signalId,
    opportunityId
  };
}
