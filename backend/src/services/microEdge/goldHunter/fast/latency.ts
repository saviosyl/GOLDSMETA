/**
 * Monotonic latency instrumentation for GOLD_HUNTER FAST.
 * Never fabricates samples — only records measured intervals.
 */
import type { GhFastLatencySample } from "./types";

export type LatencyPercentiles = {
  count: number;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
};

export class LatencyTracker {
  private samples: number[] = [];
  private readonly maxKeep: number;

  constructor(maxKeep = 50_000) {
    this.maxKeep = maxKeep;
  }

  /** Prefer process.hrtime.bigint when available for monotonicity. */
  static nowMs(): number {
    if (typeof process !== "undefined" && typeof process.hrtime?.bigint === "function") {
      return Number(process.hrtime.bigint()) / 1e6;
    }
    return performance.now();
  }

  record(sample: GhFastLatencySample): void {
    this.samples.push(sample.eventToDecisionMs);
    if (this.samples.length > this.maxKeep) {
      this.samples.splice(0, this.samples.length - this.maxKeep);
    }
  }

  percentiles(): LatencyPercentiles {
    const n = this.samples.length;
    if (!n) {
      return { count: 0, p50: null, p90: null, p95: null, p99: null, max: null };
    }
    const s = [...this.samples].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
    return {
      count: n,
      p50: q(0.5),
      p90: q(0.9),
      p95: q(0.95),
      p99: q(0.99),
      max: s[s.length - 1]!
    };
  }

  clear(): void {
    this.samples = [];
  }
}

export function buildLatencySample(args: {
  marketEventReceivedMs: number;
  featuresCalculatedMs: number;
  decisionProducedMs: number;
  shadowOrderProducedMs?: number | null;
}): GhFastLatencySample {
  return {
    marketEventReceivedMs: args.marketEventReceivedMs,
    featuresCalculatedMs: args.featuresCalculatedMs,
    decisionProducedMs: args.decisionProducedMs,
    shadowOrderProducedMs: args.shadowOrderProducedMs ?? null,
    eventToDecisionMs: Math.max(
      0,
      args.decisionProducedMs - args.marketEventReceivedMs
    )
  };
}
