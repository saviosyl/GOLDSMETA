/**
 * GOLD HUNTER FAST research — Spot+Depth soft-freshness for reference paper
 * and specialist qualification (parity with soft FEED_STALE / freshnessLimitMs).
 *
 * Soft threshold is GH_FAST_RESEARCH_FRESHNESS_MS (20s) — NOT a new knob.
 * Hard reconnect (45s) and engine sideFreshnessMs/depthFreshnessMs are separate.
 */
import type { ResearchDepthValidity } from "../depthRecovery";
import { GH_FAST_RESEARCH_FRESHNESS_MS } from "./researchTypes";

export function feedAgeFresh(
  lastAtMs: number | null | undefined,
  nowMs: number,
  freshnessLimitMs: number = GH_FAST_RESEARCH_FRESHNESS_MS
): boolean {
  return lastAtMs != null && nowMs - lastAtMs <= freshnessLimitMs;
}

/**
 * Reference-paper dataOk requires BOTH feeds fresh at the soft boundary,
 * plus a complete non-crossed quote and valid Depth (engine entry-gate intent).
 */
export function computeResearchReferencePaperDataOk(input: {
  nowMs: number;
  lastSpotAtMs: number | null;
  lastDepthAtMs: number | null;
  freshnessLimitMs?: number;
  lastBid: number | null;
  lastAsk: number | null;
  crossed: boolean;
  depthAvailable: boolean;
  depthRecoveryInFlight: boolean;
  depthValidity: ResearchDepthValidity;
}): boolean {
  const limit = input.freshnessLimitMs ?? GH_FAST_RESEARCH_FRESHNESS_MS;
  const spotFresh = feedAgeFresh(input.lastSpotAtMs, input.nowMs, limit);
  const depthFresh = feedAgeFresh(input.lastDepthAtMs, input.nowMs, limit);
  const quoteOk =
    input.lastBid != null &&
    input.lastAsk != null &&
    input.lastAsk > input.lastBid;
  return (
    spotFresh &&
    depthFresh &&
    quoteOk &&
    input.depthAvailable &&
    !input.crossed &&
    !input.depthRecoveryInFlight &&
    input.depthValidity === "DEPTH_VALID"
  );
}

/**
 * When either Spot or Depth exceeds the soft freshness boundary, derived
 * specialist rows are contaminated for qualification (raw rows kept).
 */
export function feedsSoftFreshForQualification(input: {
  nowMs: number;
  lastSpotAtMs: number | null;
  lastDepthAtMs: number | null;
  freshnessLimitMs?: number;
}): boolean {
  const limit = input.freshnessLimitMs ?? GH_FAST_RESEARCH_FRESHNESS_MS;
  return (
    feedAgeFresh(input.lastSpotAtMs, input.nowMs, limit) &&
    feedAgeFresh(input.lastDepthAtMs, input.nowMs, limit)
  );
}
