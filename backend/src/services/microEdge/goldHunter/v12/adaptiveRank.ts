/**
 * Past-only rolling adaptive ranking for entry scores.
 */
export type AdaptiveRankWindowSec = 300 | 900 | 1800 | 3600;

export type AdaptivePercentile = 0.8 | 0.9 | 0.95 | 0.98 | 0.99;

/**
 * Rolling buffer of past scores (strictly before current evaluation).
 * Entry when current score >= empirical quantile of the buffer.
 */
export class PastOnlyScoreWindow {
  private readonly timestamps: number[] = [];
  private readonly scores: number[] = [];
  constructor(private readonly windowMs: number) {}

  /** Push a completed past score (call AFTER decision for that second). */
  push(timestampMs: number, score: number): void {
    this.timestamps.push(timestampMs);
    this.scores.push(score);
    this.evict(timestampMs);
  }

  private evict(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.timestamps.length && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
      this.scores.shift();
    }
  }

  /**
   * Quantile threshold from scores strictly older than nowMs.
   * Returns null if insufficient history.
   */
  quantileThreshold(nowMs: number, q: number, minSamples = 30): number | null {
    const cutoff = nowMs - this.windowMs;
    const vals: number[] = [];
    for (let i = 0; i < this.timestamps.length; i++) {
      const ts = this.timestamps[i]!;
      if (ts >= nowMs) break;
      if (ts >= cutoff) vals.push(this.scores[i]!);
    }
    if (vals.length < minSamples) return null;
    vals.sort((a, b) => a - b);
    const idx = Math.min(vals.length - 1, Math.floor(q * (vals.length - 1)));
    return vals[idx]!;
  }

  size(): number {
    return this.scores.length;
  }
}

export function adaptiveRankPasses(args: {
  score: number;
  nowMs: number;
  window: PastOnlyScoreWindow;
  percentile: AdaptivePercentile;
  /** Fallback absolute floor when window cold. */
  coldFloor: number;
}): boolean {
  const thr = args.window.quantileThreshold(args.nowMs, args.percentile);
  if (thr == null) return args.score >= args.coldFloor;
  return args.score >= thr;
}
