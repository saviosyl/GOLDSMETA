/**
 * Single-consumer ordered event queue for GOLD_HUNTER FAST.
 * Spot and Depth share the same queue — apply order == receive order.
 * No DB I/O in the consumer path.
 */
import { LatencyTracker } from "./latency";

export type QueuedMarketWork<T> = {
  receiveSeq: number;
  enqueuedAtMs: number;
  payload: T;
};

export type EventQueueStats = {
  depth: number;
  dropped: number;
  processed: number;
  enqueued: number;
  eventsPerSec: number;
  queueWait: ReturnType<LatencyTracker["percentiles"]>;
  processing: ReturnType<LatencyTracker["percentiles"]>;
};

export class OrderedEventQueue<T> {
  private q: QueuedMarketWork<T>[] = [];
  private processing = false;
  private dropped = 0;
  private processed = 0;
  private enqueued = 0;
  private readonly maxDepth: number;
  private readonly waitLat = new LatencyTracker();
  private readonly procLat = new LatencyTracker();
  private windowStart = Date.now();
  private windowProcessed = 0;
  private handler: ((item: QueuedMarketWork<T>) => Promise<void>) | null = null;

  constructor(opts?: { maxDepth?: number }) {
    this.maxDepth = opts?.maxDepth ?? 50_000;
  }

  setHandler(handler: (item: QueuedMarketWork<T>) => Promise<void>): void {
    this.handler = handler;
  }

  /** Enqueue from market callback — never awaits processing. */
  enqueue(receiveSeq: number, payload: T): boolean {
    if (this.q.length >= this.maxDepth) {
      this.dropped += 1;
      return false;
    }
    this.enqueued += 1;
    this.q.push({
      receiveSeq,
      enqueuedAtMs: LatencyTracker.nowMs(),
      payload
    });
    void this.pump();
    return true;
  }

  private async pump(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.q.length > 0) {
        const item = this.q.shift()!;
        const start = LatencyTracker.nowMs();
        this.waitLat.record({
          marketEventReceivedMs: item.enqueuedAtMs,
          featuresCalculatedMs: item.enqueuedAtMs,
          decisionProducedMs: start,
          shadowOrderProducedMs: null,
          eventToDecisionMs: Math.max(0, start - item.enqueuedAtMs)
        });
        if (this.handler) {
          await this.handler(item);
        }
        const end = LatencyTracker.nowMs();
        this.procLat.record({
          marketEventReceivedMs: start,
          featuresCalculatedMs: start,
          decisionProducedMs: end,
          shadowOrderProducedMs: null,
          eventToDecisionMs: Math.max(0, end - start)
        });
        this.processed += 1;
        this.windowProcessed += 1;
      }
    } finally {
      this.processing = false;
      if (this.q.length > 0) void this.pump();
    }
  }

  /** Drain for tests — wait until idle. */
  async drain(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((this.q.length > 0 || this.processing) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  stats(): EventQueueStats {
    const now = Date.now();
    const elapsed = Math.max(0.001, (now - this.windowStart) / 1000);
    const eps = this.windowProcessed / elapsed;
    if (now - this.windowStart > 5000) {
      this.windowStart = now;
      this.windowProcessed = 0;
    }
    return {
      depth: this.q.length,
      dropped: this.dropped,
      processed: this.processed,
      enqueued: this.enqueued,
      eventsPerSec: eps,
      queueWait: this.waitLat.percentiles(),
      processing: this.procLat.percentiles()
    };
  }

  clear(): void {
    this.q = [];
  }
}
