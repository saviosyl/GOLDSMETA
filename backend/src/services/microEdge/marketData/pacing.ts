/**
 * Conservative request pacing for Micro historical / non-historical reads.
 * Stay WELL below Spotware ceilings (hist ~5/s, non-hist ~50/s).
 */

export type MicroPacer = {
  waitTurn(): Promise<void>;
  noteRateLimit(): void;
  resetBackoff(): void;
  getState(): { delayMs: number; consecutiveRateLimits: number };
};

export function createMicroPacer(args?: {
  minIntervalMs?: number;
  maxBackoffMs?: number;
}): MicroPacer {
  const minIntervalMs = args?.minIntervalMs ?? 250; // ~4 historical req/s max
  const maxBackoffMs = args?.maxBackoffMs ?? 30_000;
  let lastAt = 0;
  let delayMs = minIntervalMs;
  let consecutiveRateLimits = 0;

  return {
    async waitTurn() {
      const now = Date.now();
      const wait = Math.max(0, lastAt + delayMs - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
    },
    noteRateLimit() {
      consecutiveRateLimits += 1;
      delayMs = Math.min(maxBackoffMs, Math.max(minIntervalMs, delayMs * 2));
    },
    resetBackoff() {
      consecutiveRateLimits = 0;
      delayMs = minIntervalMs;
    },
    getState() {
      return { delayMs, consecutiveRateLimits };
    }
  };
}

export async function withBoundedRetries<T>(args: {
  maxAttempts: number;
  pacer: MicroPacer;
  run: () => Promise<T>;
  isRateLimit: (e: unknown) => boolean;
}): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < args.maxAttempts; i++) {
    await args.pacer.waitTurn();
    try {
      const result = await args.run();
      args.pacer.resetBackoff();
      return result;
    } catch (e) {
      lastErr = e;
      if (args.isRateLimit(e)) {
        args.pacer.noteRateLimit();
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
