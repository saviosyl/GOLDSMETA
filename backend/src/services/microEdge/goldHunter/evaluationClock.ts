/**
 * Dedicated 1000 ms GOLD_HUNTER evaluation clock.
 * Reads local Bid/Ask only — NEVER issues a broker request.
 */
import { GH_EVALUATION_INTERVAL_MS, GH_QUOTE_FRESHNESS_MS } from "./config";
import { buildQuoteBook } from "./quoteValidity";
import type { GhMicrostructureInterval, GhQuoteBook } from "./types";
import { emptyMicrostructure } from "./microstructure";

export type LocalQuoteSource = {
  /** In-memory spot book — no network. */
  getLocalBook: () => {
    bid: number | null;
    ask: number | null;
    bidUpdatedMs: number | null;
    askUpdatedMs: number | null;
    brokerTimestampMs: number;
  };
  /** Optional microstructure snapshot+reset between evals. */
  takeMicrostructure?: () => GhMicrostructureInterval;
};

export type EvaluationTick = {
  evalTimestampMs: number;
  book: GhQuoteBook;
  micro: GhMicrostructureInterval;
  evaluated: boolean;
  reason: "OK" | "DATA_STALE" | "INVALID";
  /** Always 0 — evaluator must not call broker. */
  brokerRequestsThisTick: 0;
};

/**
 * Pure single-tick evaluation from a local book.
 * Callers schedule this every GH_EVALUATION_INTERVAL_MS.
 */
export function evaluateOnce(
  nowMs: number,
  source: LocalQuoteSource,
  opts?: { quoteFreshnessMs?: number; sideFreshnessMs?: number }
): EvaluationTick {
  const raw = source.getLocalBook();
  const book = buildQuoteBook({
    nowMs,
    brokerTimestampMs: raw.brokerTimestampMs,
    bid: raw.bid,
    ask: raw.ask,
    bidUpdatedMs: raw.bidUpdatedMs,
    askUpdatedMs: raw.askUpdatedMs,
    sideFreshnessMs: opts?.sideFreshnessMs
  });
  const micro = source.takeMicrostructure
    ? source.takeMicrostructure()
    : emptyMicrostructure();
  const freshness = opts?.quoteFreshnessMs ?? GH_QUOTE_FRESHNESS_MS;

  if (!book.valid) {
    return {
      evalTimestampMs: nowMs,
      book,
      micro,
      evaluated: false,
      reason: "INVALID",
      brokerRequestsThisTick: 0
    };
  }
  if (book.quoteAgeMs > freshness) {
    return {
      evalTimestampMs: nowMs,
      book,
      micro,
      evaluated: false,
      reason: "DATA_STALE",
      brokerRequestsThisTick: 0
    };
  }
  return {
    evalTimestampMs: nowMs,
    book,
    micro,
    evaluated: true,
    reason: "OK",
    brokerRequestsThisTick: 0
  };
}

/**
 * Interval runner for the 1-second clock.
 * The onTick callback must not perform broker I/O.
 */
export class GoldHunterEvaluationClock {
  private timer: ReturnType<typeof setInterval> | null = null;
  private brokerRequestCount = 0;

  constructor(
    private readonly source: LocalQuoteSource,
    private readonly onTick: (tick: EvaluationTick) => void,
    private readonly intervalMs = GH_EVALUATION_INTERVAL_MS
  ) {}

  /** Test/inspection: evaluator-caused broker requests (must stay 0). */
  getBrokerRequestsCausedByEvaluator(): number {
    return this.brokerRequestCount;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const nowMs = Date.now();
      const tick = evaluateOnce(nowMs, this.source);
      // Hard invariant: this clock never increments broker requests.
      this.onTick(tick);
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Deterministic one-shot for tests / research replay. */
  tickAt(nowMs: number): EvaluationTick {
    return evaluateOnce(nowMs, this.source);
  }
}

export { GH_EVALUATION_INTERVAL_MS };
