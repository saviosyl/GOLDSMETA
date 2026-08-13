/**
 * Execution-aware GOLD_HUNTER labels.
 * BUY gross = Bid_T - Ask_t  (spread already included)
 * SELL gross = Bid_t - Ask_T
 * Additional friction only after that — never subtract spread again.
 */
import {
  GH_DEFAULT_ENTRY_SLIPPAGE,
  GH_DEFAULT_EXECUTION_BUFFER,
  GH_DEFAULT_EXIT_SLIPPAGE,
  GH_TARGET_TOLERANCE_MS,
  type GhHorizonSec
} from "./config";
import type { GhClass, GhLabel } from "./types";

export type GhFriction = {
  entrySlippage: number;
  exitSlippage: number;
  executionBuffer: number;
};

export const DEFAULT_FRICTION: GhFriction = {
  entrySlippage: GH_DEFAULT_ENTRY_SLIPPAGE,
  exitSlippage: GH_DEFAULT_EXIT_SLIPPAGE,
  executionBuffer: GH_DEFAULT_EXECUTION_BUFFER
};

export function computeExecutionAwareMove(args: {
  bidT: number;
  askT: number;
  bidTarget: number;
  askTarget: number;
  friction?: GhFriction;
}): {
  midMove: number;
  grossLong: number;
  grossShort: number;
  netLong: number;
  netShort: number;
  additionalFriction: number;
} {
  const f = args.friction ?? DEFAULT_FRICTION;
  const midT = (args.bidT + args.askT) / 2;
  const midTarget = (args.bidTarget + args.askTarget) / 2;
  const midMove = midTarget - midT;
  // Spread already inside these gross definitions — do NOT subtract spread again.
  const grossLong = args.bidTarget - args.askT;
  const grossShort = args.bidT - args.askTarget;
  const additionalFriction =
    f.entrySlippage + f.exitSlippage + f.executionBuffer;
  return {
    midMove,
    grossLong,
    grossShort,
    netLong: grossLong - additionalFriction,
    netShort: grossShort - additionalFriction,
    additionalFriction
  };
}

export function classFromNets(
  netLong: number,
  netShort: number,
  theta: number
): GhClass {
  const up = netLong >= theta;
  const down = netShort >= theta;
  if (up && !down) return "UP_TRADEABLE";
  if (down && !up) return "DOWN_TRADEABLE";
  if (up && down) {
    return netLong >= netShort ? "UP_TRADEABLE" : "DOWN_TRADEABLE";
  }
  return "NO_EDGE";
}

export type GhQuoteAt = {
  timestampMs: number;
  bid: number;
  ask: number;
};

/** First valid quote at/after target within tolerance — no interpolation, no quote before T. */
export function firstQuoteAtOrAfter(
  quotes: GhQuoteAt[],
  targetMs: number,
  toleranceMs = GH_TARGET_TOLERANCE_MS,
  fromIndex = 0
): GhQuoteAt | null {
  let best: GhQuoteAt | null = null;
  for (let i = Math.max(0, fromIndex); i < quotes.length; i++) {
    const q = quotes[i]!;
    if (q.timestampMs < targetMs) continue;
    if (q.timestampMs - targetMs > toleranceMs) break;
    if (!Number.isFinite(q.bid) || !Number.isFinite(q.ask)) continue;
    if (!(q.bid > 0) || !(q.ask > 0) || q.ask < q.bid) continue;
    best = q;
    break;
  }
  return best;
}

export function labelHorizon(args: {
  horizonSec: GhHorizonSec;
  entry: GhQuoteAt;
  futureQuotes: GhQuoteAt[];
  /** Inclusive start index into futureQuotes (monotonic scan optimization). */
  fromIndex?: number;
  theta: number;
  friction?: GhFriction;
  toleranceMs?: number;
}): GhLabel {
  const targetTimestampMs = args.entry.timestampMs + args.horizonSec * 1000;
  const target = firstQuoteAtOrAfter(
    args.futureQuotes,
    targetTimestampMs,
    args.toleranceMs ?? GH_TARGET_TOLERANCE_MS,
    args.fromIndex ?? 0
  );
  if (!target) {
    return {
      horizonSec: args.horizonSec,
      classLabel: "UNSCORABLE_DATA_GAP",
      midMove: null,
      grossLong: null,
      grossShort: null,
      netLong: null,
      netShort: null,
      targetTimestampMs: null
    };
  }
  const m = computeExecutionAwareMove({
    bidT: args.entry.bid,
    askT: args.entry.ask,
    bidTarget: target.bid,
    askTarget: target.ask,
    friction: args.friction
  });
  return {
    horizonSec: args.horizonSec,
    classLabel: classFromNets(m.netLong, m.netShort, args.theta),
    midMove: m.midMove,
    grossLong: m.grossLong,
    grossShort: m.grossShort,
    netLong: m.netLong,
    netShort: m.netShort,
    targetTimestampMs: target.timestampMs
  };
}
