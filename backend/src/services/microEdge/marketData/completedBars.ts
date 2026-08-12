import type { MicroParsedTrendbar } from "./microCTraderProtocol";
import type { MicroTimeframe } from "./types";

export type MicroM1CompletedEvent = {
  type: "MICRO_M1_COMPLETED";
  closeTimeMs: number;
  bar: MicroParsedTrendbar;
};

/**
 * Detect newly completed M1 bars. Never treats a forming bar as completed.
 * Idempotent via seenCloseTimes set.
 */
export function detectCompletedM1(args: {
  bars: MicroParsedTrendbar[];
  nowMs: number;
  seenCloseTimes: Set<number>;
}): MicroM1CompletedEvent[] {
  const events: MicroM1CompletedEvent[] = [];
  for (const bar of args.bars) {
    if (bar.closeTimeMs > args.nowMs) continue; // forming
    if (args.seenCloseTimes.has(bar.closeTimeMs)) continue;
    args.seenCloseTimes.add(bar.closeTimeMs);
    events.push({ type: "MICRO_M1_COMPLETED", closeTimeMs: bar.closeTimeMs, bar });
  }
  return events;
}

/**
 * At completed M1 timestamp t, only higher-TF bars with closeTimeMs <= t are visible.
 */
export function filterBarsAtOrBeforeCutoff<T extends { closeTimeMs: number }>(
  bars: T[],
  cutoffCloseMs: number
): T[] {
  return bars.filter((b) => b.closeTimeMs <= cutoffCloseMs);
}

export function assertNoLookahead(
  contextBars: Array<{ closeTimeMs: number; timeframe: MicroTimeframe }>,
  m1CloseMs: number
): void {
  for (const b of contextBars) {
    if (b.closeTimeMs > m1CloseMs) {
      throw new Error(
        `LOOKAHEAD: ${b.timeframe} bar close ${b.closeTimeMs} after M1 ${m1CloseMs}`
      );
    }
  }
}
