/**
 * Micro DATA-ONLY historical Bid/Ask tick collector (ProtoOAGetTickDataReq).
 * READ ONLY — zero relation to broker execution.
 *
 * Tick decoding: first timestamp is absolute; subsequent entries are deltas
 * relative to the previous tick. Official responses may be newest-first;
 * we expand deltas then normalize to ascending absolute timestamps.
 */
import {
  MICRO_BOUNDARY_QUOTE_TOLERANCE_MS,
  MICRO_HISTORICAL_MIN_INTERVAL_MS,
  MICRO_HISTORICAL_QUOTE_BACKFILL_DAYS,
  MICRO_HISTORICAL_TICK_MAX_WINDOW_MS
} from "../config";
import {
  asFiniteNumber,
  MICRO_QUOTE_TYPE,
  MICRO_SPOT_PRICE_SCALE,
  spotPriceFromRelative,
  type MicroHistoricalQuoteSide
} from "./microCTraderProtocol";
import { createMicroPacer, withBoundedRetries } from "./pacing";
import type { MicroOpenApiTransport } from "./microCTraderTransport";

export type MicroHistoricalTick = {
  side: MicroHistoricalQuoteSide;
  price: number;
  brokerTimestampMs: number;
};

export type MicroRawTickDatum = {
  timestamp: number;
  tick: number;
};

/**
 * Expand compressed tick list into absolute timestamps + relative prices.
 * Does not assume ascending absolute timestamps in the wire payload.
 */
export function decodeHistoricalTickData(
  tickData: unknown,
  side: MicroHistoricalQuoteSide,
  priceScale = MICRO_SPOT_PRICE_SCALE
): MicroHistoricalTick[] {
  const list = Array.isArray(tickData) ? tickData : [];
  if (!list.length) return [];

  const expanded: MicroHistoricalTick[] = [];
  let absoluteTs: number | null = null;

  for (let i = 0; i < list.length; i++) {
    const raw = (list[i] ?? {}) as Record<string, unknown>;
    const tsPart = asFiniteNumber(raw.timestamp);
    const tickRel = asFiniteNumber(raw.tick);
    if (tsPart == null || tickRel == null) continue;

    if (i === 0 || absoluteTs == null) {
      absoluteTs = tsPart;
    } else {
      // Delta from previous — may be negative when newest-first.
      absoluteTs = absoluteTs + tsPart;
    }

    const price = tickRel / priceScale;
    if (!(price > 0) || !Number.isFinite(absoluteTs)) continue;
    expanded.push({
      side,
      price,
      brokerTimestampMs: absoluteTs
    });
  }

  // Normalize to ascending for boundary samplers.
  expanded.sort((a, b) => a.brokerTimestampMs - b.brokerTimestampMs);
  return expanded;
}

export function assertTickWindowWithinLimit(
  fromMs: number,
  toMs: number,
  maxWindowMs = MICRO_HISTORICAL_TICK_MAX_WINDOW_MS
): void {
  if (!(toMs > fromMs)) {
    throw Object.assign(new Error("MICRO_TICK_WINDOW_INVALID"), {
      code: "tick_window_invalid"
    });
  }
  if (toMs - fromMs > maxWindowMs) {
    throw Object.assign(new Error("MICRO_TICK_WINDOW_EXCEEDS_7_DAYS"), {
      code: "tick_window_too_large",
      maxWindowMs
    });
  }
}

export async function fetchHistoricalTicksWindow(args: {
  transport: MicroOpenApiTransport & {
    getTickData?: (a: {
      symbolId: string;
      side: MicroHistoricalQuoteSide;
      fromTimestamp: number;
      toTimestamp: number;
    }) => Promise<{ tickData?: unknown; hasMore?: boolean }>;
  };
  accountId: string;
  symbolId: string;
  side: MicroHistoricalQuoteSide;
  fromMs: number;
  toMs: number;
  pacer?: ReturnType<typeof createMicroPacer>;
}): Promise<MicroHistoricalTick[]> {
  assertTickWindowWithinLimit(args.fromMs, args.toMs);
  const pacer =
    args.pacer ??
    createMicroPacer({ minIntervalMs: MICRO_HISTORICAL_MIN_INTERVAL_MS });

  const all: MicroHistoricalTick[] = [];
  let cursorTo = args.toMs;
  let guard = 0;

  while (cursorTo > args.fromMs && guard < 500) {
    guard += 1;
    const fromTimestamp = args.fromMs;
    const toTimestamp = cursorTo;
    assertTickWindowWithinLimit(fromTimestamp, toTimestamp);

    const res = await withBoundedRetries({
      maxAttempts: 4,
      pacer,
      isRateLimit: (e) => (e as { code?: string }).code === "rate_limited",
      run: async () => {
        if (typeof args.transport.getTickData === "function") {
          return args.transport.getTickData!({
            symbolId: args.symbolId,
            side: args.side,
            fromTimestamp,
            toTimestamp
          });
        }
        // Fallback via sendReadCommand
        const raw = (await args.transport.sendReadCommand(
          "ProtoOAGetTickDataReq",
          {
            ctidTraderAccountId: Number(args.accountId),
            symbolId: Number(args.symbolId),
            type: MICRO_QUOTE_TYPE[args.side],
            fromTimestamp,
            toTimestamp
          }
        )) as { tickData?: unknown; hasMore?: boolean };
        return raw;
      }
    });

    const decoded = decodeHistoricalTickData(res.tickData, args.side);
    all.push(...decoded);

    if (!res.hasMore) break;
    if (!decoded.length) break;
    // hasMore: move window end to oldest received tick (exclusive) and continue.
    const oldest = decoded[0]!.brokerTimestampMs;
    if (oldest >= cursorTo) break;
    cursorTo = oldest;
  }

  // Deduplicate by timestamp+price
  const seen = new Set<string>();
  const deduped: MicroHistoricalTick[] = [];
  for (const t of all.sort(
    (a, b) => a.brokerTimestampMs - b.brokerTimestampMs
  )) {
    const k = `${t.brokerTimestampMs}_${t.price}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(t);
  }
  return deduped;
}

export type MicroBoundaryQuoteStatus = "OK" | "UNSCORABLE_DATA_GAP";

export type MicroBoundaryQuote = {
  id: string;
  symbol: string;
  boundaryTimestampMs: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  bidTimestampMs: number | null;
  askTimestampMs: number | null;
  maxSideDelayMs: number | null;
  status: MicroBoundaryQuoteStatus;
  source: "CTRADER_HISTORICAL_TICKS";
  environment: "DEMO" | "LIVE";
  collectedAt: string;
};

export function boundaryQuoteId(
  symbol: string,
  boundaryTimestampMs: number
): string {
  return `${symbol}_BQ_${boundaryTimestampMs}`;
}

/**
 * First valid Bid and Ask at/after boundary T within tolerance.
 * Never uses a quote BEFORE T. Never interpolates.
 */
export function resolveBoundaryQuote(args: {
  symbol: string;
  boundaryTimestampMs: number;
  bids: MicroHistoricalTick[];
  asks: MicroHistoricalTick[];
  toleranceMs?: number;
  environment: "DEMO" | "LIVE";
  nowMs?: number;
}): MicroBoundaryQuote {
  const tolerance = args.toleranceMs ?? MICRO_BOUNDARY_QUOTE_TOLERANCE_MS;
  const T = args.boundaryTimestampMs;
  const deadline = T + tolerance;

  const bid = args.bids.find(
    (t) =>
      t.side === "BID" &&
      t.brokerTimestampMs >= T &&
      t.brokerTimestampMs <= deadline &&
      t.price > 0
  );
  const ask = args.asks.find(
    (t) =>
      t.side === "ASK" &&
      t.brokerTimestampMs >= T &&
      t.brokerTimestampMs <= deadline &&
      t.price > 0
  );

  if (!bid || !ask || !(ask.price >= bid.price)) {
    return {
      id: boundaryQuoteId(args.symbol, T),
      symbol: args.symbol,
      boundaryTimestampMs: T,
      bid: bid?.price ?? null,
      ask: ask?.price ?? null,
      mid: null,
      spread: null,
      bidTimestampMs: bid?.brokerTimestampMs ?? null,
      askTimestampMs: ask?.brokerTimestampMs ?? null,
      maxSideDelayMs: null,
      status: "UNSCORABLE_DATA_GAP",
      source: "CTRADER_HISTORICAL_TICKS",
      environment: args.environment,
      collectedAt: new Date(args.nowMs ?? Date.now()).toISOString()
    };
  }

  const bidDelay = bid.brokerTimestampMs - T;
  const askDelay = ask.brokerTimestampMs - T;
  return {
    id: boundaryQuoteId(args.symbol, T),
    symbol: args.symbol,
    boundaryTimestampMs: T,
    bid: bid.price,
    ask: ask.price,
    mid: (bid.price + ask.price) / 2,
    spread: ask.price - bid.price,
    bidTimestampMs: bid.brokerTimestampMs,
    askTimestampMs: ask.brokerTimestampMs,
    maxSideDelayMs: Math.max(bidDelay, askDelay),
    status: "OK",
    source: "CTRADER_HISTORICAL_TICKS",
    environment: args.environment,
    collectedAt: new Date(args.nowMs ?? Date.now()).toISOString()
  };
}

export type LabelReadyDiagnostics = {
  labelReadyMinutes: number;
  unscorableBoundaryMinutes: number;
  coveragePercent: number;
  medianBoundaryDelayMs: number | null;
  p95BoundaryDelayMs: number | null;
  totalBoundaries: number;
};

export function computeLabelReadyDiagnostics(
  quotes: MicroBoundaryQuote[]
): LabelReadyDiagnostics {
  const ok = quotes.filter((q) => q.status === "OK");
  const gap = quotes.filter((q) => q.status === "UNSCORABLE_DATA_GAP");
  const delays = ok
    .map((q) => q.maxSideDelayMs)
    .filter((d): d is number => d != null && Number.isFinite(d))
    .sort((a, b) => a - b);
  const total = quotes.length;
  const median =
    delays.length === 0
      ? null
      : delays.length % 2 === 1
        ? delays[(delays.length - 1) / 2]!
        : (delays[delays.length / 2 - 1]! + delays[delays.length / 2]!) / 2;
  const p95 =
    delays.length === 0
      ? null
      : delays[Math.min(delays.length - 1, Math.floor(delays.length * 0.95))]!;
  return {
    labelReadyMinutes: ok.length,
    unscorableBoundaryMinutes: gap.length,
    coveragePercent: total === 0 ? 0 : (ok.length / total) * 100,
    medianBoundaryDelayMs: median,
    p95BoundaryDelayMs: p95,
    totalBoundaries: total
  };
}

export function defaultHistoricalQuoteBackfillRange(nowMs = Date.now()): {
  fromMs: number;
  toMs: number;
  days: number;
} {
  const days = MICRO_HISTORICAL_QUOTE_BACKFILL_DAYS;
  const toMs = nowMs;
  const fromMs = nowMs - days * 24 * 60 * 60 * 1000;
  return { fromMs, toMs, days };
}

/** Split a range into <= 7-day windows (oldest→newest). */
export function splitIntoTickWindows(
  fromMs: number,
  toMs: number,
  maxWindowMs = MICRO_HISTORICAL_TICK_MAX_WINDOW_MS
): Array<{ fromMs: number; toMs: number }> {
  if (!(toMs > fromMs)) return [];
  const windows: Array<{ fromMs: number; toMs: number }> = [];
  let cursor = fromMs;
  while (cursor < toMs) {
    const end = Math.min(toMs, cursor + maxWindowMs);
    windows.push({ fromMs: cursor, toMs: end });
    cursor = end;
  }
  return windows;
}

// Keep spotPriceFromRelative re-export for tests that convert relatives.
export { spotPriceFromRelative };
