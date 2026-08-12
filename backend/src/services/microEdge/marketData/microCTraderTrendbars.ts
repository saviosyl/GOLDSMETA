import type { MicroOpenApiTransport } from "./microCTraderTransport";
import {
  MICRO_TIMEFRAME_MS,
  parseMicroTrendbars,
  type MicroParsedTrendbar
} from "./microCTraderProtocol";
import type { MicroTimeframe } from "./types";

export async function fetchTrendbarsWindow(args: {
  transport: MicroOpenApiTransport;
  symbolId: string;
  timeframe: MicroTimeframe;
  fromTimestamp: number;
  toTimestamp: number;
  count?: number;
}): Promise<MicroParsedTrendbar[]> {
  const count = Math.min(Math.max(args.count ?? 200, 1), 300);
  const res = await args.transport.getTrendbars({
    symbolId: args.symbolId,
    timeframe: args.timeframe,
    fromTimestamp: args.fromTimestamp,
    toTimestamp: args.toTimestamp,
    count
  });
  return parseMicroTrendbars(res.trendbar, args.timeframe);
}

/** Reject the currently forming bar (closeTime > now). */
export function filterCompletedBars(
  bars: MicroParsedTrendbar[],
  nowMs: number
): MicroParsedTrendbar[] {
  return bars.filter((b) => b.closeTimeMs <= nowMs);
}

export function chunkHistoricalWindows(args: {
  timeframe: MicroTimeframe;
  fromMs: number;
  toMs: number;
  /** Bars per request window. */
  barsPerChunk?: number;
}): Array<{ fromMs: number; toMs: number }> {
  const periodMs = MICRO_TIMEFRAME_MS[args.timeframe];
  const barsPerChunk = args.barsPerChunk ?? 200;
  const windowMs = periodMs * barsPerChunk;
  const chunks: Array<{ fromMs: number; toMs: number }> = [];
  let cursor = args.fromMs;
  while (cursor < args.toMs) {
    const end = Math.min(args.toMs, cursor + windowMs);
    chunks.push({ fromMs: cursor, toMs: end });
    cursor = end;
  }
  return chunks;
}
