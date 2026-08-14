/**
 * Durable research-capture sink.
 * Prefix: gold-hunter-fast/research-capture/  (NEVER live-shadow)
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX,
  GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
  GH_FAST_RESEARCH_SCHEMA_VERSION,
  type ResearchCaptureRecord,
  type ResearchChunkManifest,
  type ResearchDaySummary
} from "./researchTypes";
import { assertNoExecutionAdapterArgument } from "./nullExecutionGuard";

async function tryUploadGcs(
  bucket: string,
  objectPath: string,
  body: Buffer
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (objectPath.includes(GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX)) {
    return {
      ok: false,
      error: "REFUSING_LIVE_SHADOW_PREFIX"
    };
  }
  if (!objectPath.startsWith(`${GH_FAST_RESEARCH_GCS_PREFIX_ROOT}/`)) {
    return { ok: false, error: "REFUSING_NON_RESEARCH_PREFIX" };
  }
  try {
    const mod = await import("@google-cloud/storage");
    const saRaw = (process.env.GCP_SERVICE_ACCOUNT_JSON ?? "").trim();
    const storage = saRaw
      ? new mod.Storage({
          credentials: JSON.parse(saRaw) as {
            client_email: string;
            private_key: string;
          },
          projectId: (JSON.parse(saRaw) as { project_id?: string }).project_id
        })
      : new mod.Storage();
    await storage.bucket(bucket).file(objectPath).save(body, {
      contentType: "application/gzip",
      resumable: false,
      metadata: { cacheControl: "no-store" }
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 180) };
  }
}

type PendingChunk = {
  records: ResearchCaptureRecord[];
  enqueuedAtMs: number;
};

export class ResearchDurableSink {
  private pending: PendingChunk[] = [];
  private buf: ResearchCaptureRecord[] = [];
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
  private readonly datasetId: string;
  private readonly researchConfigSha: string;
  private readonly runtimeSha: string | null;
  private readonly captureStart: string;
  private readonly localDir: string;
  private readonly gcsBucket: string | null;
  private readonly gcsPrefix: string;
  readonly manifests: ResearchChunkManifest[] = [];

  constructor(opts: {
    runId: string;
    datasetId: string;
    researchConfigSha: string;
    runtimeSha?: string | null;
    captureStart: string;
    chunkRows?: number;
    maxQueue?: number;
    localDir?: string;
    gcsBucket?: string | null;
    _executionAdapterMustBeUndefined?: unknown;
  }) {
    assertNoExecutionAdapterArgument(opts._executionAdapterMustBeUndefined);
    this.runId = opts.runId;
    this.datasetId = opts.datasetId;
    this.researchConfigSha = opts.researchConfigSha;
    this.runtimeSha = opts.runtimeSha ?? null;
    this.captureStart = opts.captureStart;
    this.chunkRows = opts.chunkRows ?? 500;
    this.maxQueue = opts.maxQueue ?? 200;
    this.localDir =
      opts.localDir ??
      join(
        process.cwd(),
        ".gold-hunter-data",
        "fast-research-capture",
        this.runId
      );
    if (this.localDir.includes("live-shadow")) {
      throw new Error("RESEARCH_SINK_REFUSING_LIVE_SHADOW_LOCAL_PATH");
    }
    const envBucket = (
      process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET ??
      process.env.GOLD_HUNTER_FAST_GCS_BUCKET ??
      ""
    ).trim();
    this.gcsBucket = opts.gcsBucket ?? (envBucket || null);
    const date = new Date().toISOString().slice(0, 10);
    this.gcsPrefix = `${GH_FAST_RESEARCH_GCS_PREFIX_ROOT}/${this.runId}/${date}`;
    if (this.gcsPrefix.includes(GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX)) {
      throw new Error("RESEARCH_SINK_REFUSING_LIVE_SHADOW_GCS_PREFIX");
    }
    if (!this.gcsBucket) {
      this.healthWarning =
        "RESEARCH_SINK_LOCAL_ONLY — set GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET for Cloud Storage";
    }
  }

  getRunId(): string {
    return this.runId;
  }

  getDatasetId(): string {
    return this.datasetId;
  }

  getGcsPrefix(): string {
    return this.gcsPrefix;
  }

  getLocalDir(): string {
    return this.localDir;
  }

  enqueue(rec: ResearchCaptureRecord): void {
    this.buf.push(rec);
    if (this.buf.length >= this.chunkRows) this.sealChunk();
    void this.drain();
  }

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

  async writeDaySummary(summary: ResearchDaySummary): Promise<string> {
    await mkdir(this.localDir, { recursive: true });
    const path = join(this.localDir, "CAPTURE_DAY_SUMMARY.json");
    await writeFile(path, JSON.stringify(summary, null, 2));
    if (this.gcsBucket) {
      const objectPath = `${this.gcsPrefix}/CAPTURE_DAY_SUMMARY.json`;
      await tryUploadGcs(
        this.gcsBucket,
        objectPath,
        Buffer.from(JSON.stringify(summary, null, 2), "utf8")
      );
    }
    return path;
  }

  private sealChunk(): void {
    if (!this.buf.length) return;
    if (this.pending.length >= this.maxQueue) {
      this.healthWarning = "RESEARCH_PERSISTENCE_QUEUE_BACKPRESSURE";
      this.pending.shift();
      this.writeErrors += 1;
    }
    this.pending.push({ records: this.buf, enqueuedAtMs: Date.now() });
    this.buf = [];
  }

  private async drain(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.pending.length > 0) {
        const chunk = this.pending.shift()!;
        await this.writeChunk(chunk.records);
      }
    } finally {
      this.writing = false;
      if (this.pending.length > 0) void this.drain();
    }
  }

  private async writeChunk(records: ResearchCaptureRecord[]): Promise<void> {
    const startTs = records[0]?.t ?? Date.now();
    const endTs = records[records.length - 1]?.t ?? startTs;
    const sequenceStart = records[0]?.receiveSeq ?? 0;
    const sequenceEnd = records[records.length - 1]?.receiveSeq ?? sequenceStart;
    const body = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const gz = gzipSync(Buffer.from(body, "utf8"));
    const sha256 = createHash("sha256").update(gz).digest("hex");
    const name = `chunk-${String(this.chunkIdx).padStart(5, "0")}.ndjson.gz`;

    try {
      await mkdir(this.localDir, { recursive: true });
      const localPath = join(this.localDir, name);
      await writeFile(localPath, gz);
      const manifest: ResearchChunkManifest = {
        runId: this.runId,
        datasetId: this.datasetId,
        schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
        runtimeSha: this.runtimeSha,
        researchConfigSha: this.researchConfigSha,
        captureStart: this.captureStart,
        chunkIndex: this.chunkIdx,
        startTs,
        endTs,
        rowCount: records.length,
        sequenceStart,
        sequenceEnd,
        sha256,
        gcsObject: null,
        localPath,
        uploadedAt: null,
        storagePrefix: GH_FAST_RESEARCH_GCS_PREFIX_ROOT
      };
      if (this.gcsBucket) {
        const objectPath = `${this.gcsPrefix}/${name}`;
        const up = await tryUploadGcs(this.gcsBucket, objectPath, gz);
        if (up.ok) {
          manifest.gcsObject = `gs://${this.gcsBucket}/${objectPath}`;
          manifest.uploadedAt = new Date().toISOString();
          this.chunksUploaded += 1;
          const manBody = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
          await tryUploadGcs(
            this.gcsBucket,
            `${this.gcsPrefix}/${name}.manifest.json`,
            manBody
          );
        } else {
          this.uploadErrors += 1;
          this.healthWarning = `GCS_UPLOAD_FAILED — local buffer retained (${up.error})`;
        }
      }
      await appendFile(
        join(this.localDir, "checkpoint.jsonl"),
        JSON.stringify(manifest) + "\n"
      );
      await writeFile(
        join(this.localDir, `${name}.manifest.json`),
        JSON.stringify(manifest, null, 2)
      );
      this.manifests.push(manifest);
      this.chunksWritten += 1;
      this.chunkIdx += 1;
    } catch {
      this.writeErrors += 1;
      this.healthWarning = "LOCAL_PERSIST_FAILED";
    }
  }

  stats() {
    return {
      queueDepth: this.pending.length + (this.buf.length > 0 ? 1 : 0),
      chunksWritten: this.chunksWritten,
      chunksUploaded: this.chunksUploaded,
      writeErrors: this.writeErrors,
      uploadErrors: this.uploadErrors,
      healthWarning: this.healthWarning,
      durableMode: (this.gcsBucket ? "GCS" : "LOCAL_BUFFER_ONLY") as
        | "GCS"
        | "LOCAL_BUFFER_ONLY",
      gcsPrefix: this.gcsPrefix,
      localDir: this.localDir
    };
  }
}
