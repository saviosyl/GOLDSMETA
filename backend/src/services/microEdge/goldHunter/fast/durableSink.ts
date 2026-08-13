/**
 * Durable FAST live-shadow persistence.
 * Hot path only enqueues; background writer gzips + uploads.
 * Never stores secrets/tokens.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  GOLD_HUNTER_FAST_ENGINE_VERSION,
  GOLD_HUNTER_FAST_STRATEGY_VERSION
} from "./versions";
import type { GhFastCollectorRecord } from "./collector";

export type DurableChunkManifest = {
  runId: string;
  engineVersion: string;
  strategyVersion: string;
  configHash: string;
  chunkIndex: number;
  startTs: number;
  endTs: number;
  rowCount: number;
  sha256: string;
  gcsObject?: string | null;
  localPath?: string | null;
  uploadedAt: string | null;
};

export type DurableSinkStats = {
  queueDepth: number;
  chunksWritten: number;
  chunksUploaded: number;
  writeErrors: number;
  uploadErrors: number;
  healthWarning: string | null;
  durableMode: "GCS" | "LOCAL_BUFFER_ONLY";
  persistenceQueue: { p50: number | null; p95: number | null; max: number | null };
};

type PendingChunk = {
  records: GhFastCollectorRecord[];
  enqueuedAtMs: number;
};

async function tryUploadGcs(
  bucket: string,
  objectPath: string,
  body: Buffer
): Promise<boolean> {
  try {
    const mod = await import("@google-cloud/storage");
    const storage = new mod.Storage();
    await storage.bucket(bucket).file(objectPath).save(body, {
      contentType: "application/gzip",
      resumable: false,
      metadata: { cacheControl: "no-store" }
    });
    return true;
  } catch {
    return false;
  }
}

export class GhFastDurableSink {
  private pending: PendingChunk[] = [];
  private buf: GhFastCollectorRecord[] = [];
  private chunkIdx = 0;
  private writing = false;
  private chunksWritten = 0;
  private chunksUploaded = 0;
  private writeErrors = 0;
  private uploadErrors = 0;
  private healthWarning: string | null = null;
  private readonly chunkRows: number;
  private readonly maxQueue: number;
  private readonly runId: string;
  private readonly configHash: string;
  private readonly localDir: string;
  private readonly gcsBucket: string | null;
  private readonly gcsPrefix: string;
  private queueWaitSamples: number[] = [];
  readonly manifests: DurableChunkManifest[] = [];

  constructor(opts?: {
    runId?: string;
    configHash?: string;
    chunkRows?: number;
    maxQueue?: number;
    localDir?: string;
    gcsBucket?: string | null;
  }) {
    this.runId =
      opts?.runId ??
      `gh_fast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.configHash = opts?.configHash ?? "default";
    this.chunkRows = opts?.chunkRows ?? 500;
    this.maxQueue = opts?.maxQueue ?? 200;
    this.localDir =
      opts?.localDir ??
      join(process.cwd(), ".gold-hunter-data", "fast-live-shadow", this.runId);
    const envBucket = (process.env.GOLD_HUNTER_FAST_GCS_BUCKET ?? "").trim();
    this.gcsBucket = opts?.gcsBucket ?? (envBucket || null);
    const date = new Date().toISOString().slice(0, 10);
    this.gcsPrefix = `gold-hunter-fast/live-shadow/${this.runId}/${date}`;
    if (!this.gcsBucket) {
      this.healthWarning =
        "DURABLE_SINK_LOCAL_ONLY — set GOLD_HUNTER_FAST_GCS_BUCKET for Cloud Storage";
    }
  }

  getRunId(): string {
    return this.runId;
  }

  /** Hot path: enqueue only. Never gzip/write/upload here. */
  enqueue(rec: GhFastCollectorRecord): void {
    this.buf.push(rec);
    if (this.buf.length >= this.chunkRows) {
      this.sealChunk();
    }
    void this.drain();
  }

  /** Force seal leftover buffer (tests / shutdown). */
  flush(): void {
    if (this.buf.length) this.sealChunk();
    void this.drain();
  }

  async flushAndWait(timeoutMs = 10_000): Promise<void> {
    this.flush();
    const deadline = Date.now() + timeoutMs;
    while (
      (this.pending.length > 0 || this.writing || this.buf.length > 0) &&
      Date.now() < deadline
    ) {
      this.flush();
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  private sealChunk(): void {
    if (!this.buf.length) return;
    if (this.pending.length >= this.maxQueue) {
      this.healthWarning = "PERSISTENCE_QUEUE_BACKPRESSURE";
      // Drop oldest pending chunk (not decision path) to avoid unbounded growth.
      this.pending.shift();
      this.writeErrors += 1;
    }
    this.pending.push({
      records: this.buf,
      enqueuedAtMs: Date.now()
    });
    this.buf = [];
  }

  private async drain(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.pending.length > 0) {
        const chunk = this.pending.shift()!;
        const wait = Date.now() - chunk.enqueuedAtMs;
        this.queueWaitSamples.push(wait);
        if (this.queueWaitSamples.length > 5000) {
          this.queueWaitSamples.splice(0, 2500);
        }
        await this.writeChunk(chunk.records);
      }
    } finally {
      this.writing = false;
      if (this.pending.length > 0) void this.drain();
    }
  }

  private async writeChunk(records: GhFastCollectorRecord[]): Promise<void> {
    const startTs = records[0]?.t ?? Date.now();
    const endTs = records[records.length - 1]?.t ?? startTs;
    const body =
      records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const gz = gzipSync(Buffer.from(body, "utf8"));
    const sha256 = createHash("sha256").update(gz).digest("hex");
    const name = `chunk-${String(this.chunkIdx).padStart(5, "0")}.ndjson.gz`;
    let localPath: string | null = null;
    let gcsObject: string | null = null;

    try {
      await mkdir(this.localDir, { recursive: true });
      localPath = join(this.localDir, name);
      await writeFile(localPath, gz);
      const manifest: DurableChunkManifest = {
        runId: this.runId,
        engineVersion: GOLD_HUNTER_FAST_ENGINE_VERSION,
        strategyVersion: GOLD_HUNTER_FAST_STRATEGY_VERSION,
        configHash: this.configHash,
        chunkIndex: this.chunkIdx,
        startTs,
        endTs,
        rowCount: records.length,
        sha256,
        gcsObject: null,
        localPath,
        uploadedAt: null
      };
      if (this.gcsBucket) {
        const objectPath = `${this.gcsPrefix}/${name}`;
        const ok = await tryUploadGcs(this.gcsBucket, objectPath, gz);
        if (ok) {
          gcsObject = `gs://${this.gcsBucket}/${objectPath}`;
          manifest.gcsObject = gcsObject;
          manifest.uploadedAt = new Date().toISOString();
          this.chunksUploaded += 1;
          // Upload companion manifest
          const manBody = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
          await tryUploadGcs(
            this.gcsBucket,
            `${this.gcsPrefix}/${name}.manifest.json`,
            manBody
          );
        } else {
          this.uploadErrors += 1;
          this.healthWarning = "GCS_UPLOAD_FAILED — local buffer retained";
        }
      }
      await appendFile(
        join(this.localDir, "checkpoint.jsonl"),
        JSON.stringify(manifest) + "\n"
      );
      this.manifests.push(manifest);
      this.chunksWritten += 1;
      this.chunkIdx += 1;
    } catch {
      this.writeErrors += 1;
      this.healthWarning = "LOCAL_PERSIST_FAILED";
    }
  }

  stats(): DurableSinkStats {
    const s = [...this.queueWaitSamples].sort((a, b) => a - b);
    const q = (p: number) =>
      s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]! : null;
    return {
      queueDepth: this.pending.length + (this.buf.length > 0 ? 1 : 0),
      chunksWritten: this.chunksWritten,
      chunksUploaded: this.chunksUploaded,
      writeErrors: this.writeErrors,
      uploadErrors: this.uploadErrors,
      healthWarning: this.healthWarning,
      durableMode: this.gcsBucket ? "GCS" : "LOCAL_BUFFER_ONLY",
      persistenceQueue: { p50: q(0.5), p95: q(0.95), max: s[s.length - 1] ?? null }
    };
  }

  localPath(): string {
    return this.localDir;
  }
}
