/**
 * Depth-book health diagnostics — operational only (not strategy thresholds).
 */
import type { DepthBookStats } from "./depthBook";

export type DepthUnavailableReason =
  | "NO_BIDS"
  | "NO_ASKS"
  | "CROSSED_BOOK"
  | "DEPTH_STALE"
  | "WARMING_UP"
  | "OTHER"
  | null;

export function depthUnavailableReason(args: {
  stats: DepthBookStats;
  depthAgeMs: number | null;
  depthFreshnessMs: number;
  warmingUp: boolean;
}): DepthUnavailableReason {
  if (args.warmingUp) return "WARMING_UP";
  const { stats } = args;
  if (stats.bidLevels <= 0 && stats.askLevels <= 0) return "OTHER";
  if (stats.bidLevels <= 0) return "NO_BIDS";
  if (stats.askLevels <= 0) return "NO_ASKS";
  if (stats.crossed) return "CROSSED_BOOK";
  if (!stats.available) return "OTHER";
  if (
    args.depthAgeMs == null ||
    args.depthAgeMs > args.depthFreshnessMs
  ) {
    return "DEPTH_STALE";
  }
  return null;
}
