/**
 * Naive baseline comparisons for holdout honesty.
 */
import type { GhPolicyBacktest, GhShadowTrade } from "./types";
import { computePolicyBacktest } from "./metrics";
import type { GhQuoteAt } from "./labels";

export type BaselineId =
  | "always_wait"
  | "always_buy"
  | "always_sell"
  | "prev_second_momentum"
  | "m1_trend";

function friction(): number {
  return 0.06; // matches default entry+exit+buffer
}

/** Simulate naive always-side holds for fixed horizon using Bid/Ask. */
export function simulateAlwaysSide(args: {
  side: "BUY" | "SELL" | "WAIT";
  quotes: GhQuoteAt[];
  holdSec: number;
  stepSec?: number;
}): GhShadowTrade[] {
  if (args.side === "WAIT") return [];
  const step = (args.stepSec ?? 60) * 1000;
  const holdMs = args.holdSec * 1000;
  const trades: GhShadowTrade[] = [];
  let i = 0;
  let exitIdx = 0;
  while (i < args.quotes.length) {
    const entry = args.quotes[i]!;
    const exitTarget = entry.timestampMs + holdMs;
    if (exitIdx < i) exitIdx = i;
    while (
      exitIdx < args.quotes.length &&
      args.quotes[exitIdx]!.timestampMs < exitTarget
    ) {
      exitIdx += 1;
    }
    const exit = exitIdx < args.quotes.length ? args.quotes[exitIdx]! : undefined;
    if (!exit) break;
    const entryPrice = args.side === "BUY" ? entry.ask : entry.bid;
    const exitPrice = args.side === "BUY" ? exit.bid : exit.ask;
    const gross =
      args.side === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
    const net = gross - friction();
    trades.push({
      tradeId: `base_${args.side}_${entry.timestampMs}`,
      date: new Date(entry.timestampMs).toISOString().slice(0, 10),
      strategyVersion: `BASELINE_${args.side}`,
      modelVersion: "baseline",
      entryTimestampMs: entry.timestampMs,
      exitTimestampMs: exit.timestampMs,
      durationSeconds: Math.round((exit.timestampMs - entry.timestampMs) / 1000),
      side: args.side,
      entryBid: entry.bid,
      entryAsk: entry.ask,
      entryPrice,
      exitBid: exit.bid,
      exitAsk: exit.ask,
      exitPrice,
      entrySpread: entry.ask - entry.bid,
      grossMove: gross,
      additionalFriction: friction(),
      netMove: net,
      mfe: net,
      mae: Math.min(0, net),
      entryProbs: {
        5: {
          horizonSec: 5,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: 0,
          expectedNetSell: 0
        },
        15: {
          horizonSec: 15,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: 0,
          expectedNetSell: 0
        },
        30: {
          horizonSec: 30,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: 0,
          expectedNetSell: 0
        },
        60: {
          horizonSec: 60,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: 0,
          expectedNetSell: 0
        }
      },
      exitProbs: null,
      entryReason: `BASELINE_${args.side}`,
      exitReason: "MAX_HOLD",
      session: "OFF_HOURS",
      regime: "RANGE",
      result: net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN"
    });
    const nextTs = entry.timestampMs + step;
    while (i < args.quotes.length && args.quotes[i]!.timestampMs < nextTs) i++;
  }
  return trades;
}

export function simulatePrevSecondMomentum(args: {
  quotes: GhQuoteAt[];
  holdSec: number;
}): GhShadowTrade[] {
  const trades: GhShadowTrade[] = [];
  let exitIdx = 0;
  for (let i = 1; i < args.quotes.length; i++) {
    const prev = args.quotes[i - 1]!;
    const cur = args.quotes[i]!;
    if (cur.timestampMs - prev.timestampMs > 1500) continue;
    const prevMid = (prev.bid + prev.ask) / 2;
    const curMid = (cur.bid + cur.ask) / 2;
    const side = curMid > prevMid ? "BUY" : curMid < prevMid ? "SELL" : null;
    if (!side) continue;
    const exitTarget = cur.timestampMs + args.holdSec * 1000;
    if (exitIdx < i) exitIdx = i;
    while (
      exitIdx < args.quotes.length &&
      args.quotes[exitIdx]!.timestampMs < exitTarget
    ) {
      exitIdx += 1;
    }
    const exit = exitIdx < args.quotes.length ? args.quotes[exitIdx]! : undefined;
    if (!exit) break;
    const entryPrice = side === "BUY" ? cur.ask : cur.bid;
    const exitPrice = side === "BUY" ? exit.bid : exit.ask;
    const gross =
      side === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
    const net = gross - friction();
    trades.push({
      tradeId: `base_mom_${cur.timestampMs}`,
      date: new Date(cur.timestampMs).toISOString().slice(0, 10),
      strategyVersion: "BASELINE_MOMENTUM",
      modelVersion: "baseline",
      entryTimestampMs: cur.timestampMs,
      exitTimestampMs: exit.timestampMs,
      durationSeconds: Math.round((exit.timestampMs - cur.timestampMs) / 1000),
      side,
      entryBid: cur.bid,
      entryAsk: cur.ask,
      entryPrice,
      exitBid: exit.bid,
      exitAsk: exit.ask,
      exitPrice,
      entrySpread: cur.ask - cur.bid,
      grossMove: gross,
      additionalFriction: friction(),
      netMove: net,
      mfe: net,
      mae: Math.min(0, net),
      entryProbs: {
        5: {
          horizonSec: 5,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: 0,
          expectedNetSell: 0
        },
        15: {
          horizonSec: 15,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: 0,
          expectedNetSell: 0
        },
        30: {
          horizonSec: 30,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: 0,
          expectedNetSell: 0
        },
        60: {
          horizonSec: 60,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: 0,
          expectedNetSell: 0
        }
      },
      exitProbs: null,
      entryReason: "PREV_SECOND_MOMENTUM",
      exitReason: "MAX_HOLD",
      session: "OFF_HOURS",
      regime: "RANGE",
      result: net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN"
    });
    // skip ahead to avoid overlapping spam
    const skipUntil = exit.timestampMs;
    while (i < args.quotes.length && args.quotes[i]!.timestampMs < skipUntil) i++;
  }
  return trades;
}

export function baselineComparisons(quotes: GhQuoteAt[]): Record<
  BaselineId,
  GhPolicyBacktest
> {
  return {
    always_wait: computePolicyBacktest([]),
    always_buy: computePolicyBacktest(
      simulateAlwaysSide({ side: "BUY", quotes, holdSec: 30 })
    ),
    always_sell: computePolicyBacktest(
      simulateAlwaysSide({ side: "SELL", quotes, holdSec: 30 })
    ),
    prev_second_momentum: computePolicyBacktest(
      simulatePrevSecondMomentum({ quotes, holdSec: 30 })
    ),
    m1_trend: computePolicyBacktest(
      simulateAlwaysSide({ side: "BUY", quotes, holdSec: 60, stepSec: 60 })
    )
  };
}
