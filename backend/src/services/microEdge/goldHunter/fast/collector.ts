/**
 * Durable read-only FAST event collector — compact append/chunk storage.
 * Persistence is OFF the decision hot path (call after engine.onMarketEvent).
 * Never stores secrets/tokens.
 */
import { mkdirSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { GhFastDecision, GhFastMarketEvent } from "./types";
import type { GhFastEngineStatus } from "./engine";

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
  private buf: GhFastCollectorRecord[] = [];
  private chunkIdx = 0;
  private readonly dir: string;
  private readonly chunkRows: number;

  constructor(opts?: { dir?: string; chunkRows?: number }) {
    this.dir =
      opts?.dir ??
      join(process.cwd(), ".gold-hunter-data", "fast-live-shadow");
    this.chunkRows = opts?.chunkRows ?? 2000;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Async-friendly: enqueue; flush when chunk full. */
  record(rec: GhFastCollectorRecord): void {
    this.buf.push(rec);
    if (this.buf.length >= this.chunkRows) this.flush();
  }

  flush(): void {
    if (!this.buf.length) return;
    const path = join(
      this.dir,
      `chunk-${String(this.chunkIdx).padStart(5, "0")}.ndjson.gz`
    );
    const body =
      this.buf.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(path, gzipSync(Buffer.from(body, "utf8")));
    // Checkpoint pointer
    appendFileSync(
      join(this.dir, "checkpoint.jsonl"),
      JSON.stringify({
        chunk: this.chunkIdx,
        rows: this.buf.length,
        at: new Date().toISOString()
      }) + "\n"
    );
    this.chunkIdx += 1;
    this.buf = [];
  }

  path(): string {
    return this.dir;
  }

  hasData(): boolean {
    return existsSync(this.dir);
  }
}
