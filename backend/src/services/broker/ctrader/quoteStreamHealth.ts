/**
 * Pure quote-stream health helpers for the persistent XAUUSD worker.
 *
 * Lock heartbeat alone is NOT proof of market-data health — callers must
 * evaluate last successful valid quote / persist timestamps.
 */

export const DEFAULT_QUOTE_STALL_MS = 20_000;
export const DEFAULT_QUOTE_STALL_MS_MARKET_CLOSED = 600_000;
export const DEFAULT_LOCK_QUOTE_STALE_MS = 45_000;

export type QuoteStreamHealthInput = {
  nowMs: number;
  /** Last time a valid bid+ask spot was accepted (ms epoch). */
  lastValidQuoteAtMs: number | null;
  /** Last time Firestore quote persist succeeded (ms epoch). */
  lastPersistedQuoteAtMs: number | null;
  marketStatus?: "OPEN" | "CLOSED" | "UNKNOWN" | null;
  stallAfterMs?: number;
  stallAfterMsMarketClosed?: number;
};

export type QuoteStreamHealth = {
  stalled: boolean;
  reason: "OK" | "NO_VALID_QUOTE" | "VALID_QUOTE_STALE" | "PERSIST_STALE";
  ageMs: number | null;
  stallAfterMs: number;
};

function stallThresholdMs(input: QuoteStreamHealthInput): number {
  if (input.marketStatus === "CLOSED") {
    return (
      input.stallAfterMsMarketClosed ?? DEFAULT_QUOTE_STALL_MS_MARKET_CLOSED
    );
  }
  return input.stallAfterMs ?? DEFAULT_QUOTE_STALL_MS;
}

/**
 * Stream is stalled when we have no recent valid quote, or valid quotes are
 * arriving but Firestore persists have stopped (write path wedged).
 */
export function evaluateQuoteStreamHealth(
  input: QuoteStreamHealthInput
): QuoteStreamHealth {
  const stallAfterMs = stallThresholdMs(input);
  const validAt = input.lastValidQuoteAtMs;
  if (validAt == null || !Number.isFinite(validAt)) {
    return {
      stalled: true,
      reason: "NO_VALID_QUOTE",
      ageMs: null,
      stallAfterMs
    };
  }
  const validAge = input.nowMs - validAt;
  if (validAge > stallAfterMs) {
    return {
      stalled: true,
      reason: "VALID_QUOTE_STALE",
      ageMs: validAge,
      stallAfterMs
    };
  }
  const persistedAt = input.lastPersistedQuoteAtMs;
  if (persistedAt == null || !Number.isFinite(persistedAt)) {
    return {
      stalled: true,
      reason: "PERSIST_STALE",
      ageMs: validAge,
      stallAfterMs
    };
  }
  const persistAge = input.nowMs - persistedAt;
  if (persistAge > stallAfterMs) {
    return {
      stalled: true,
      reason: "PERSIST_STALE",
      ageMs: persistAge,
      stallAfterMs
    };
  }
  return {
    stalled: false,
    reason: "OK",
    ageMs: Math.max(validAge, persistAge),
    stallAfterMs
  };
}

/** True when an existing worker lock may be stolen due to quote-stream stall. */
export function isWorkerLockQuoteStale(args: {
  nowMs: number;
  lastSuccessfulQuoteAt: string | null | undefined;
  staleAfterMs?: number;
}): boolean {
  const staleAfter = args.staleAfterMs ?? DEFAULT_LOCK_QUOTE_STALE_MS;
  if (!args.lastSuccessfulQuoteAt) return true;
  const at = Date.parse(args.lastSuccessfulQuoteAt);
  if (!Number.isFinite(at)) return true;
  return args.nowMs - at > staleAfter;
}

/**
 * Health endpoint readiness: process running + lock held + quote stream not stalled.
 * Live order flags are intentionally out of scope here.
 */
export function isQuoteWorkerHealthy(args: {
  running: boolean;
  lockHeld: boolean;
  stream: QuoteStreamHealth;
}): boolean {
  return args.running && args.lockHeld && !args.stream.stalled;
}
