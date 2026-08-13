import type { MicroCTraderEnvironment } from "./microCTraderAuth";
import type { MicroMarketDataStore } from "./marketDataStore";
import { makeRawBar } from "./marketDataStore";
import { microLog } from "./microLog";
import type { MicroOpenApiTransport } from "./microCTraderTransport";
import { chunkHistoricalWindows, fetchTrendbarsWindow } from "./microCTraderTrendbars";
import { filterCompletedBars } from "./microCTraderTrendbars";
import { createMicroPacer, withBoundedRetries } from "./pacing";
import type { MicroBackfillCheckpoint, MicroTimeframe } from "./types";

export const DEFAULT_BACKFILL_DAYS: Record<MicroTimeframe, number> = {
  M1: 30,
  M5: 90,
  M15: 180
};

export type MicroBackfillResult = {
  timeframe: MicroTimeframe;
  inserted: number;
  skipped: number;
  conflicts: number;
  failed: number;
  status: MicroBackfillCheckpoint["status"];
  lastErrorCode: string | null;
};

function isRateLimit(e: unknown): boolean {
  const err = e as { code?: string; status?: number; message?: string };
  return (
    err?.code === "rate_limited" ||
    err?.status === 429 ||
    /rate.?limit/i.test(String(err?.message ?? ""))
  );
}

export async function runHistoricalBackfill(args: {
  transport: MicroOpenApiTransport;
  store: MicroMarketDataStore;
  symbol: string;
  symbolId: string;
  environment: MicroCTraderEnvironment;
  timeframes?: MicroTimeframe[];
  nowMs?: number;
  daysByTf?: Partial<Record<MicroTimeframe, number>>;
  /** Min interval between historical requests (default 250ms). */
  minIntervalMs?: number;
}): Promise<MicroBackfillResult[]> {
  const nowMs = args.nowMs ?? Date.now();
  const tfs = args.timeframes ?? (["M1", "M5", "M15"] as MicroTimeframe[]);
  const pacer = createMicroPacer({ minIntervalMs: args.minIntervalMs ?? 250 });
  const results: MicroBackfillResult[] = [];

  for (const tf of tfs) {
    const days = args.daysByTf?.[tf] ?? DEFAULT_BACKFILL_DAYS[tf];
    const fromMs = nowMs - days * 24 * 60 * 60 * 1000;
    const prior = await args.store.getCheckpoint(tf);
    const resumeFrom = prior?.status === "PAUSED" || prior?.status === "FAILED"
      ? Math.max(fromMs, prior.cursorToMs)
      : fromMs;

    let inserted = prior?.inserted ?? 0;
    let skipped = prior?.skipped ?? 0;
    let conflicts = prior?.conflicts ?? 0;
    let failed = 0;
    let lastErrorCode: string | null = null;

    microLog("MICRO_BACKFILL_STARTED", {
      timeframe: tf,
      fromMs: resumeFrom,
      toMs: nowMs,
      days
    });

    const checkpoint = async (
      status: MicroBackfillCheckpoint["status"],
      cursorFrom: number,
      cursorTo: number
    ) => {
      await args.store.saveCheckpoint({
        timeframe: tf,
        cursorFromMs: cursorFrom,
        cursorToMs: cursorTo,
        status,
        inserted,
        skipped,
        conflicts,
        failed,
        lastErrorCode,
        updatedAt: new Date().toISOString()
      });
    };

    await checkpoint("RUNNING", resumeFrom, resumeFrom);
    const chunks = chunkHistoricalWindows({
      timeframe: tf,
      fromMs: resumeFrom,
      toMs: nowMs
    });

    try {
      for (const chunk of chunks) {
        try {
          const bars = await withBoundedRetries({
            maxAttempts: 5,
            pacer,
            isRateLimit,
            run: () =>
              fetchTrendbarsWindow({
                transport: args.transport,
                symbolId: args.symbolId,
                timeframe: tf,
                fromTimestamp: chunk.fromMs,
                toTimestamp: chunk.toMs,
                count: 300
              })
          });
          const completed = filterCompletedBars(bars, nowMs);
          for (const b of completed) {
            const result = await args.store.upsertBar(
              makeRawBar({
                symbol: args.symbol,
                symbolId: args.symbolId,
                timeframe: tf,
                openTimeMs: b.openTimeMs,
                closeTimeMs: b.closeTimeMs,
                open: b.open,
                high: b.high,
                low: b.low,
                close: b.close,
                tickVolume: b.tickVolume,
                environment: args.environment,
                source: "CTRADER_OPEN_API"
              })
            );
            if (result === "created") inserted += 1;
            else if (result === "skipped_identical") skipped += 1;
            else conflicts += 1;
          }
          await checkpoint("RUNNING", chunk.fromMs, chunk.toMs);
          microLog("MICRO_BACKFILL_PROGRESS", {
            timeframe: tf,
            cursorToMs: chunk.toMs,
            inserted,
            skipped,
            conflicts
          });
        } catch (e) {
          const err = e as { code?: string };
          if (isRateLimit(e)) {
            microLog("MICRO_RATE_LIMITED", { timeframe: tf });
            lastErrorCode = "rate_limited";
            await checkpoint("PAUSED", chunk.fromMs, chunk.fromMs);
            results.push({
              timeframe: tf,
              inserted,
              skipped,
              conflicts,
              failed,
              status: "PAUSED",
              lastErrorCode
            });
            return results;
          }
          failed += 1;
          lastErrorCode = err.code ?? "backfill_api_failure";
          throw e;
        }
      }
      await checkpoint("COMPLETED", resumeFrom, nowMs);
      microLog("MICRO_BACKFILL_COMPLETED", {
        timeframe: tf,
        inserted,
        skipped,
        conflicts
      });
      results.push({
        timeframe: tf,
        inserted,
        skipped,
        conflicts,
        failed,
        status: "COMPLETED",
        lastErrorCode: null
      });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      lastErrorCode = err.code ?? "backfill_failed";
      microLog("MICRO_BACKFILL_FAILED", {
        timeframe: tf,
        code: lastErrorCode,
        message: String(err.message ?? "").slice(0, 120)
      });
      await checkpoint("FAILED", resumeFrom, nowMs);
      results.push({
        timeframe: tf,
        inserted,
        skipped,
        conflicts,
        failed,
        status: "FAILED",
        lastErrorCode
      });
    }
  }
  return results;
}
