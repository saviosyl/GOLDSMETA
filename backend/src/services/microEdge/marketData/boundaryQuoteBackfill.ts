/**
 * Streaming historical tick sampler → MicroBoundaryQuote at each M1 boundary.
 * Resumable via checkpoint. READ ONLY against broker.
 */
import {
  MICRO_HISTORICAL_MIN_INTERVAL_MS,
  MICRO_HISTORICAL_QUOTE_BACKFILL_DAYS
} from "../config";
import {
  computeLabelReadyDiagnostics,
  defaultHistoricalQuoteBackfillRange,
  fetchHistoricalTicksWindow,
  resolveBoundaryQuote,
  splitIntoTickWindows,
  type LabelReadyDiagnostics,
  type MicroBoundaryQuote
} from "./historicalTicks";
import type { MicroMarketDataStore } from "./marketDataStore";
import { createMicroPacer } from "./pacing";
import type { MicroOpenApiTransport } from "./microCTraderTransport";
import { microLog } from "./microLog";

export type BoundaryBackfillResult = {
  status: "COMPLETED" | "FAILED" | "PAUSED";
  inserted: number;
  skipped: number;
  unscorable: number;
  labelReady: LabelReadyDiagnostics;
  lastErrorCode: string | null;
};

function minuteBoundaries(fromMs: number, toMs: number): number[] {
  const start = Math.ceil(fromMs / 60_000) * 60_000;
  const end = Math.floor(toMs / 60_000) * 60_000;
  const out: number[] = [];
  for (let t = start; t <= end; t += 60_000) out.push(t);
  return out;
}

export async function runBoundaryQuoteBackfill(args: {
  transport: MicroOpenApiTransport;
  store: MicroMarketDataStore;
  accountId: string;
  symbol: string;
  symbolId: string;
  environment: "DEMO" | "LIVE";
  fromMs?: number;
  toMs?: number;
  days?: number;
}): Promise<BoundaryBackfillResult> {
  const range =
    args.fromMs != null && args.toMs != null
      ? { fromMs: args.fromMs, toMs: args.toMs, days: args.days ?? 0 }
      : defaultHistoricalQuoteBackfillRange();

  const prior = await args.store.getBoundaryCheckpoint();
  let cursorFrom = prior?.status === "COMPLETED" ? range.toMs : prior?.cursorFromMs ?? range.fromMs;
  if (prior?.status === "RUNNING" || prior?.status === "PAUSED" || prior?.status === "FAILED") {
    cursorFrom = prior.cursorFromMs;
  }
  if (cursorFrom < range.fromMs) cursorFrom = range.fromMs;

  let inserted = prior?.inserted ?? 0;
  let skipped = prior?.skipped ?? 0;
  let unscorable = prior?.unscorable ?? 0;
  const attempts = (prior?.attempts ?? 0) + 1;
  const collected: MicroBoundaryQuote[] = [];

  const pacer = createMicroPacer({
    minIntervalMs: MICRO_HISTORICAL_MIN_INTERVAL_MS
  });

  await args.store.saveBoundaryCheckpoint({
    kind: "BOUNDARY_QUOTES",
    cursorFromMs: cursorFrom,
    cursorToMs: range.toMs,
    status: "RUNNING",
    inserted,
    skipped,
    unscorable,
    attempts,
    lastSuccessAt: prior?.lastSuccessAt ?? null,
    lastErrorCode: null,
    updatedAt: new Date().toISOString()
  });

  try {
    const windows = splitIntoTickWindows(cursorFrom, range.toMs);
    for (const win of windows) {
      const bids = await fetchHistoricalTicksWindow({
        transport: args.transport,
        accountId: args.accountId,
        symbolId: args.symbolId,
        side: "BID",
        fromMs: win.fromMs,
        toMs: win.toMs,
        pacer
      });
      const asks = await fetchHistoricalTicksWindow({
        transport: args.transport,
        accountId: args.accountId,
        symbolId: args.symbolId,
        side: "ASK",
        fromMs: win.fromMs,
        toMs: win.toMs,
        pacer
      });

      const boundaries = minuteBoundaries(win.fromMs, win.toMs);
      for (const T of boundaries) {
        const bq = resolveBoundaryQuote({
          symbol: args.symbol,
          boundaryTimestampMs: T,
          bids,
          asks,
          environment: args.environment
        });
        const r = await args.store.saveBoundaryQuote(bq);
        if (r === "created") {
          inserted += 1;
          if (bq.status === "UNSCORABLE_DATA_GAP") unscorable += 1;
        } else {
          skipped += 1;
        }
        collected.push(bq);
      }

      cursorFrom = win.toMs;
      await args.store.saveBoundaryCheckpoint({
        kind: "BOUNDARY_QUOTES",
        cursorFromMs: cursorFrom,
        cursorToMs: range.toMs,
        status: "RUNNING",
        inserted,
        skipped,
        unscorable,
        attempts,
        lastSuccessAt: new Date().toISOString(),
        lastErrorCode: null,
        updatedAt: new Date().toISOString()
      });
    }

    const existing = await args.store.listBoundaryQuotes();
    const labelReady = computeLabelReadyDiagnostics(existing);
    await args.store.saveBoundaryCheckpoint({
      kind: "BOUNDARY_QUOTES",
      cursorFromMs: range.toMs,
      cursorToMs: range.toMs,
      status: "COMPLETED",
      inserted,
      skipped,
      unscorable,
      attempts,
      lastSuccessAt: new Date().toISOString(),
      lastErrorCode: null,
      updatedAt: new Date().toISOString()
    });
    microLog("MICRO_BOUNDARY_BACKFILL_DONE", {
      inserted,
      skipped,
      unscorable,
      labelReadyMinutes: labelReady.labelReadyMinutes,
      days: args.days ?? MICRO_HISTORICAL_QUOTE_BACKFILL_DAYS
    });
    return {
      status: "COMPLETED",
      inserted,
      skipped,
      unscorable,
      labelReady,
      lastErrorCode: null
    };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "boundary_backfill_failed";
    await args.store.saveBoundaryCheckpoint({
      kind: "BOUNDARY_QUOTES",
      cursorFromMs: cursorFrom,
      cursorToMs: range.toMs,
      status: "FAILED",
      inserted,
      skipped,
      unscorable,
      attempts,
      lastSuccessAt: prior?.lastSuccessAt ?? null,
      lastErrorCode: code,
      updatedAt: new Date().toISOString()
    });
    return {
      status: "FAILED",
      inserted,
      skipped,
      unscorable,
      labelReady: computeLabelReadyDiagnostics(collected),
      lastErrorCode: code
    };
  }
}
