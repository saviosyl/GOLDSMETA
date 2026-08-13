/**
 * FAST event collector — hot path only enqueues into durable async sink.
 * Never calls gzipSync/writeFileSync/Firestore on the decision path.
 */
import { join } from "node:path";
import type { GhFastDecision, GhFastMarketEvent } from "./types";
import type { GhFastEngineStatus } from "./engine";
import { GhFastDurableSink } from "./durableSink";

export type GhFastCollectorRecord = {
  t: number;
  event: GhFastMarketEvent;
  decision: GhFastDecision;
  status: Pick<
    GhFastEngineStatus,
    | "state"
    | "bid"
    | "ask"
    | "spread"
    | "depthImbalance"
    | "velocity"
    | "acceleration"
    | "setup"
    | "setupQuality"
  >;
  depthTop?: {
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  };
};

export class GhFastEventCollector {
  readonly sink: GhFastDurableSink;

  constructor(opts?: {
    dir?: string;
    chunkRows?: number;
    runId?: string;
    configHash?: string;
    gcsBucket?: string | null;
  }) {
    this.sink = new GhFastDurableSink({
      localDir:
        opts?.dir ??
        join(process.cwd(), ".gold-hunter-data", "fast-live-shadow"),
      chunkRows: opts?.chunkRows ?? 500,
      runId: opts?.runId,
      configHash: opts?.configHash,
      gcsBucket: opts?.gcsBucket
    });
  }

  /** Hot path: enqueue only. */
  record(rec: GhFastCollectorRecord): void {
    this.sink.enqueue(rec);
  }

  /** Test/shutdown helper — not for hot path. */
  flush(): void {
    this.sink.flush();
  }

  async flushAndWait(timeoutMs?: number): Promise<void> {
    await this.sink.flushAndWait(timeoutMs);
  }

  path(): string {
    return this.sink.localPath();
  }

  hasData(): boolean {
    return this.sink.stats().chunksWritten > 0 || this.sink.manifests.length > 0;
  }

  stats() {
    return this.sink.stats();
  }
}
