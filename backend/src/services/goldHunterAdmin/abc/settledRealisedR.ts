/**
 * Settled realised-R helpers for SMART_LOSS_CONTROLLER_V1.
 * Never invents R from maeR / mfeR approximations.
 */
import type { GhFastSide } from "./types";

/**
 * Realised R from settled entry/exit using the frozen original risk price.
 * BUY: (exit - entry) / risk
 * SELL: (entry - exit) / risk
 * Returns null when any input is missing or non-finite (do not invent).
 */
export function computeSettledRealisedR(args: {
  side: GhFastSide | "BUY" | "SELL";
  entry: number | null | undefined;
  exit: number | null | undefined;
  originalRiskPrice: number | null | undefined;
}): number | null {
  const { side, entry, exit, originalRiskPrice } = args;
  if (
    entry == null ||
    exit == null ||
    originalRiskPrice == null ||
    !Number.isFinite(entry) ||
    !Number.isFinite(exit) ||
    !Number.isFinite(originalRiskPrice) ||
    !(originalRiskPrice > 0)
  ) {
    return null;
  }
  const move = side === "BUY" ? exit - entry : entry - exit;
  if (!Number.isFinite(move)) return null;
  return move / originalRiskPrice;
}

/**
 * Resolve original risk from absolute stop vs entry (frozen hard-stop geometry).
 * Returns null when stop/entry cannot safely define risk.
 */
export function resolveOriginalRiskPrice(args: {
  side: GhFastSide | "BUY" | "SELL";
  entry: number | null | undefined;
  stop: number | null | undefined;
  /** Explicit stamp when available (preferred over stop distance). */
  initialRiskPrice?: number | null;
}): number | null {
  if (
    args.initialRiskPrice != null &&
    Number.isFinite(args.initialRiskPrice) &&
    args.initialRiskPrice > 0
  ) {
    return args.initialRiskPrice;
  }
  if (
    args.entry == null ||
    args.stop == null ||
    !Number.isFinite(args.entry) ||
    !Number.isFinite(args.stop)
  ) {
    return null;
  }
  const dist = Math.abs(args.entry - args.stop);
  return dist > 0 && Number.isFinite(dist) ? dist : null;
}
