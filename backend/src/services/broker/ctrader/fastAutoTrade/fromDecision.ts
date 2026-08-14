/**
 * Map existing AutoTrade decision + quote into FAST_AUTOTRADE_V1 input.
 * Does not invent missing indicators — absent fields stay null.
 */

import type { DecisionRecord } from "../../../../models/types";
import type { FastAutoTradeInput, FastBias, FastOhlc, FastReentryContext } from "./types";

function asBias(v: string | null | undefined): FastBias | null {
  const s = String(v ?? "").toUpperCase();
  if (s === "BULLISH") return "BULLISH";
  if (s === "BEARISH") return "BEARISH";
  if (s === "NEUTRAL") return "NEUTRAL";
  return null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Best-effort optional indicator extraction from decision metadata.
 * Never fabricates values.
 */
function optionalNumber(decision: DecisionRecord, keys: string[]): number | null {
  const meta = decision as unknown as Record<string, unknown>;
  for (const key of keys) {
    const direct = num(meta[key]);
    if (direct != null) return direct;
  }
  const nested = meta.optionalIndicators;
  if (nested && typeof nested === "object") {
    const rec = nested as Record<string, unknown>;
    for (const key of keys) {
      const v = num(rec[key]);
      if (v != null) return v;
    }
  }
  return null;
}

/**
 * Nearby resistance/support only when independently present.
 * Do not copy VAH/VAL — those stay separate fields. Missing stays null.
 */
function independentNearbyLevel(
  decision: DecisionRecord,
  ms: DecisionRecord["marketStructure"],
  keys: string[]
): number | null {
  const fromDecision = optionalNumber(decision, keys);
  if (fromDecision != null) return fromDecision;
  if (!ms) return null;
  const rec = ms as unknown as Record<string, unknown>;
  for (const key of keys) {
    const v = num(rec[key]);
    if (v != null) return v;
  }
  return null;
}

export function mapDecisionToFastInput(args: {
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
  reentry?: FastReentryContext;
  /** Completed 1m OHLC only — never silently use DecisionRecord OHLC. */
  ohlcv?: FastOhlc | null;
  priorOhlcv?: FastOhlc | null;
  timeframe?: string | null;
  requireCompletedM1?: boolean;
  m1Availability?: import("./types").FastM1Availability;
  m1CompletedAtMs?: number | null;
  m1History?: import("./types").FastOhlc[] | null;
}): FastAutoTradeInput {
  const d = args.decision;
  const ms = d.marketStructure;
  const mappedOhlcv = args.ohlcv !== undefined ? args.ohlcv : null;
  const price =
    args.bid != null && args.ask != null
      ? (args.bid + args.ask) / 2
      : mappedOhlcv?.close ??
        d.lastKnownPrice ??
        d.entry?.price ??
        0;
  const v3 = String(d.decision ?? "WAIT").toUpperCase();
  return {
    nowMs: args.nowMs ?? Date.now(),
    price,
    bid: args.bid ?? null,
    ask: args.ask ?? null,
    spread: args.spread ?? null,
    quoteAgeSeconds: args.quoteAgeSeconds ?? null,
    quoteStale: Boolean(args.quoteStale),
    marketStatus: args.marketStatus ?? null,
    timeframe: args.timeframe !== undefined ? args.timeframe : (d.timeframe ?? null),
    ohlcv: mappedOhlcv,
    priorOhlcv: args.priorOhlcv !== undefined ? args.priorOhlcv : null,
    trendDirection: asBias(ms?.trend ?? d.higherTimeframeBias),
    trendStrength: ms?.trendStrength ?? null,
    htfBias: asBias(d.higherTimeframeBias),
    vwap: optionalNumber(d, ["vwap", "VWAP"]),
    ema21: optionalNumber(d, ["ema21", "EMA21"]),
    ema50: optionalNumber(d, ["ema50", "EMA50"]),
    atr: optionalNumber(d, ["atr", "ATR"]),
    poc: ms?.poc ?? null,
    vah: ms?.vah ?? null,
    val: ms?.val ?? null,
    nearbyResistance: independentNearbyLevel(d, ms, ["nearbyResistance"]),
    nearbySupport: independentNearbyLevel(d, ms, ["nearbySupport"]),
    marketRegimeHint: d.marketRegime ?? null,
    setupScore: typeof d.setupScore === "number" ? d.setupScore : null,
    v3Decision: v3 === "BUY" || v3 === "SELL" ? v3 : "WAIT",
    bullishEvidence: d.bullishEvidence ?? [],
    bearishEvidence: d.bearishEvidence ?? [],
    reasonCodes: d.reasonCodes ?? [],
    confirmationClassification: ms?.confirmationClassification ?? null,
    confirmationDirection: asBias(ms?.confirmationDirection),
    dataQuality: d.dataQuality ?? null,
    sessionPlanState: args.sessionPlanState ?? null,
    safety: {
      accountIsLive: args.accountIsLive,
      accountEnvironment: args.accountEnvironment,
      spreadLimit: args.spreadLimit,
      maxQuoteAgeSeconds: args.maxQuoteAgeSeconds,
      dailyLossBreached: Boolean(args.dailyLossBreached),
      maxOpenReached: Boolean(args.maxOpenReached),
      newsBlocked: Boolean(args.newsBlocked),
      disconnected: Boolean(args.disconnected),
      duplicateActiveOrder: Boolean(args.duplicateActiveOrder),
      riskLimitBreached: Boolean(args.riskLimitBreached)
    },
    reentry: args.reentry ?? {
      lastSetup: null,
      lastExitAtMs: null,
      lastSignalKey: null,
      currentCandleKey: null,
      lastAction: null,
      lastActionAtMs: null
    },
    lifecycle: { state: "SCANNING", stateEnteredAtMs: args.nowMs ?? Date.now() },
    requireCompletedM1: Boolean(args.requireCompletedM1),
    m1Availability: args.m1Availability,
    m1CompletedAtMs: args.m1CompletedAtMs ?? null,
    m1History: args.m1History ?? null
  };
}
