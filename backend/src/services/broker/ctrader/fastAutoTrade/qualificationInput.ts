/**
 * Assemble FAST_AUTOTRADE_V1 input for AutoTrade qualification / 1-minute scan.
 * DecisionRecord (3m/5m/15m) stays context only. Primary OHLC is the freshest
 * completed 1m candle from the existing trendbar pipeline.
 */

import type { DecisionRecord } from "../../../../models/types";
import type { TrendbarCandle } from "../openApiClient";
import { loadFastAutoTradeConfig } from "./config";
import {
  classifyCompletedM1Freshness,
  loadCompletedM1BarsForFastAutoTrade
} from "./completedM1Candles";
import { mapDecisionToFastInput } from "./fromDecision";
import { loadFastReentryState } from "./reentryStateStore";
import type {
  FastAutoTradeInput,
  FastM1Availability,
  FastOhlc,
  FastReentryContext
} from "./types";

export function ohlcFromTrendbar(bar: TrendbarCandle): FastOhlc {
  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume
  };
}

export function oneMinuteMarketFromBars(bars: TrendbarCandle[]): {
  ohlcv: FastOhlc | null;
  priorOhlcv: FastOhlc | null;
  timeframe: "1" | null;
} {
  if (!bars.length) {
    return { ohlcv: null, priorOhlcv: null, timeframe: null };
  }
  const latest = bars[bars.length - 1]!;
  const prior = bars.length >= 2 ? bars[bars.length - 2]! : null;
  return {
    ohlcv: ohlcFromTrendbar(latest),
    priorOhlcv: prior ? ohlcFromTrendbar(prior) : null,
    timeframe: "1"
  };
}

export async function loadFastOneMinuteMarket(args: {
  ownerUid: string;
  nowMs?: number;
  maxAgeMs?: number;
}): Promise<{
  ohlcv: FastOhlc | null;
  priorOhlcv: FastOhlc | null;
  timeframe: "1" | null;
  availability: FastM1Availability;
  completedAtMs: number | null;
}> {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? loadFastAutoTradeConfig().maxCompletedM1AgeMs;
  try {
    const bars = await loadCompletedM1BarsForFastAutoTrade({
      ownerUid: args.ownerUid,
      nowMs,
      count: 8
    });
    const classified = classifyCompletedM1Freshness({ bars, nowMs, maxAgeMs });
    if (!classified.latest) {
      return {
        ohlcv: null,
        priorOhlcv: null,
        timeframe: null,
        availability: classified.availability,
        completedAtMs: classified.completedAtMs
      };
    }
    return {
      ohlcv: ohlcFromTrendbar(classified.latest),
      priorOhlcv: classified.prior ? ohlcFromTrendbar(classified.prior) : null,
      timeframe: "1",
      availability: classified.availability,
      completedAtMs: classified.completedAtMs
    };
  } catch {
    return {
      ohlcv: null,
      priorOhlcv: null,
      timeframe: null,
      availability: "UNAVAILABLE",
      completedAtMs: null
    };
  }
}

export async function loadPersistedFastReentry(uid: string): Promise<FastReentryContext> {
  try {
    return await loadFastReentryState(uid);
  } catch {
    return {
      lastSetup: null,
      lastExitAtMs: null,
      lastSignalKey: null,
      currentCandleKey: null,
      lastAction: null,
      lastActionAtMs: null
    };
  }
}

export async function buildFastAutoTradeInput(args: {
  uid: string;
  decision: DecisionRecord;
  nowMs?: number;
  bid?: number | null;
  ask?: number | null;
  spread?: number | null;
  quoteAgeSeconds?: number | null;
  quoteStale?: boolean;
  marketStatus?: string | null;
  accountIsLive: boolean;
  accountEnvironment: "DEMO" | "LIVE" | null;
  spreadLimit: number;
  maxQuoteAgeSeconds: number;
  dailyLossBreached?: boolean;
  maxOpenReached?: boolean;
  newsBlocked?: boolean;
  disconnected?: boolean;
  duplicateActiveOrder?: boolean;
  riskLimitBreached?: boolean;
  sessionPlanState?: string | null;
}): Promise<FastAutoTradeInput> {
  const nowMs = args.nowMs ?? Date.now();
  const [m1, reentry] = await Promise.all([
    loadFastOneMinuteMarket({ ownerUid: args.uid, nowMs }),
    loadPersistedFastReentry(args.uid)
  ]);
  return mapDecisionToFastInput({
    decision: args.decision,
    nowMs,
    bid: args.bid,
    ask: args.ask,
    spread: args.spread,
    quoteAgeSeconds: args.quoteAgeSeconds,
    quoteStale: args.quoteStale,
    marketStatus: args.marketStatus,
    accountIsLive: args.accountIsLive,
    accountEnvironment: args.accountEnvironment,
    spreadLimit: args.spreadLimit,
    maxQuoteAgeSeconds: args.maxQuoteAgeSeconds,
    dailyLossBreached: args.dailyLossBreached,
    maxOpenReached: args.maxOpenReached,
    newsBlocked: args.newsBlocked,
    disconnected: args.disconnected,
    duplicateActiveOrder: args.duplicateActiveOrder,
    riskLimitBreached: args.riskLimitBreached,
    sessionPlanState: args.sessionPlanState,
    reentry,
    ohlcv: m1.availability === "UNAVAILABLE" ? null : m1.ohlcv,
    priorOhlcv: m1.availability === "UNAVAILABLE" ? null : m1.priorOhlcv,
    timeframe: m1.availability === "UNAVAILABLE" ? null : m1.timeframe,
    requireCompletedM1: true,
    m1Availability: m1.availability,
    m1CompletedAtMs: m1.completedAtMs
  });
}
