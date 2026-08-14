/**
 * Durable research-capture sink.
 * Prefix: gold-hunter-fast/research-capture/<runId>/<YYYY-MM-DD>/  (NEVER live-shadow)
 *
 * Multi-day continuous capture: UTC date is derived from record timestamps.
 * Chunks never span two UTC dates. On date change: seal prior day → write
 * CAPTURE_DAY_SUMMARY → open new daily partition. Existing GCS objects are
 * never deleted or rewritten.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX,
  GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
  GH_FAST_RESEARCH_MODE,
  GH_FAST_RESEARCH_SCHEMA_VERSION,
  type ResearchCaptureRecord,
  type ResearchChunkManifest,
  type ResearchDataIntegrityStatus,
  type ResearchDaySummary
} from "./researchTypes";
import { assertNoExecutionAdapterArgument } from "./nullExecutionGuard";

export function utcDateFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 1-based calendar day index from campaign start UTC date to capture UTC date. */
export function captureDayIndexFromDates(
  campaignStartUtcDate: string,
  captureUtcDate: string
): number {
  const a = Date.parse(`${campaignStartUtcDate}T00:00:00.000Z`);
  const b = Date.parse(`${captureUtcDate}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.floor((b - a) / 86_400_000) + 1;
}

async function tryUploadGcs(
  bucket: string,
  objectPath: string,
  body: Buffer,
  contentType = "application/gzip"
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (objectPath.includes(GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX)) {
    return { ok: false, error: "REFUSING_LIVE_SHADOW_PREFIX" };
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
      contentType,
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
  utcDate: string;
  enqueuedAtMs: number;
};

type DayAccumulator = {
  date: string;
  captureDayIndex: number;
  captureStartMs: number;
  captureEndMs: number;
  eventsReceived: number;
  spotEventCount: number;
  depthEventCount: number;
  heartbeatCount: number;
  sessionTransitionCount: number;
  resyncMarkerCount: number;
  candidateA: number;
  candidateB: number;
  candidateC: number;
  feedGapCount: number;
  reconnectCount: number;
  resyncCount: number;
  bookCrossedCount: number;
  chunksWritten: number;
  chunksUploaded: number;
  persistenceDroppedRows: number;
  persistenceDroppedChunks: number;
  writeErrors: number;
  uploadErrors: number;
  eventsDropped: number;
  dataIntegrityStatus: ResearchDataIntegrityStatus;
};

function emptyDayAcc(date: string, captureDayIndex: number, t0: number): DayAccumulator {
  return {
    date,
    captureDayIndex,
    captureStartMs: t0,
    captureEndMs: t0,
    eventsReceived: 0,
    spotEventCount: 0,
    depthEventCount: 0,
    heartbeatCount: 0,
    sessionTransitionCount: 0,
    resyncMarkerCount: 0,
    candidateA: 0,
    candidateB: 0,
    candidateC: 0,
    feedGapCount: 0,
    reconnectCount: 0,
    resyncCount: 0,
    bookCrossedCount: 0,
    chunksWritten: 0,
    chunksUploaded: 0,
    persistenceDroppedRows: 0,
    persistenceDroppedChunks: 0,
    writeErrors: 0,
    uploadErrors: 0,
    eventsDropped: 0,
    dataIntegrityStatus: "CLEAN"
  };
}

export class ResearchDurableSink {
  private pending: PendingChunk[] = [];
  private buf: ResearchCaptureRecord[] = [];
  private bufUtcDate: string | null = null;
  private dayChunkIdx = 0;
  private writing = false;
  private chunksWritten = 0;
  private chunksUploaded = 0;
  private writeErrors = 0;
  private uploadErrors = 0;
  private persistenceDroppedChunks = 0;
  private persistenceDroppedRows = 0;
  private accepting = true;
  private fatalPersistenceError = false;
  private healthWarning: string | null = null;
  private readonly chunkRows: number;
  private readonly maxQueue: number;
  private readonly runId: string;
  private readonly datasetId: string;
  private readonly researchConfigSha: string;
  private readonly runtimeSha: string | null;
  private readonly captureStart: string;
  private readonly localDirRoot: string;
  private readonly gcsBucket: string | null;
  private readonly gcsPrefixRoot: string;
  private readonly campaignMode: boolean;
  private currentUtcDate: string | null = null;
  private readonly days = new Map<string, DayAccumulator>();
  private readonly pendingDayFinalize = new Set<string>();
  private readonly finalizedDays = new Set<string>();
  private campaignStartUtcDate: string;
  private onCaptureDateObserved:
    | ((date: string, dayIndex: number) => void)
    | null = null;
  readonly manifests: ResearchChunkManifest[] = [];
  readonly daySummaries: ResearchDaySummary[] = [];

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
    campaignMode?: boolean;
    campaignStartUtcDate?: string;
    onCaptureDateObserved?: (date: string, dayIndex: number) => void;
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
    this.campaignMode = opts.campaignMode === true;
    this.campaignStartUtcDate =
      (opts.campaignStartUtcDate ?? "").trim() ||
      (process.env.GOLD_HUNTER_FAST_CAMPAIGN_START_DATE ?? "").trim() ||
      utcDateFromMs(Date.parse(opts.captureStart) || Date.now());
    this.onCaptureDateObserved = opts.onCaptureDateObserved ?? null;
    this.localDirRoot =
      opts.localDir ??
      join(
        process.cwd(),
        ".gold-hunter-data",
        "fast-research-capture",
        this.runId
      );
    if (this.localDirRoot.includes("live-shadow")) {
      throw new Error("RESEARCH_SINK_REFUSING_LIVE_SHADOW_LOCAL_PATH");
    }
    const envBucket = (
      process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET ??
      process.env.GOLD_HUNTER_FAST_GCS_BUCKET ??
      ""
    ).trim();
    if (opts.gcsBucket === undefined) {
      this.gcsBucket = envBucket || null;
    } else {
      const explicit = (opts.gcsBucket ?? "").trim();
      this.gcsBucket = explicit || null;
    }
    this.gcsPrefixRoot = `${GH_FAST_RESEARCH_GCS_PREFIX_ROOT}/${this.runId}`;
    if (this.gcsPrefixRoot.includes(GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX)) {
      throw new Error("RESEARCH_SINK_REFUSING_LIVE_SHADOW_GCS_PREFIX");
    }
    if (!this.gcsBucket) {
      this.healthWarning =
        "RESEARCH_SINK_LOCAL_ONLY — set GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET for Cloud Storage";
      if (this.campaignMode) {
        this.healthWarning =
          "CAMPAIGN_GCS_REQUIRED — LOCAL_BUFFER_ONLY is not a valid campaign day";
      }
    }
  }

  getRunId(): string {
    return this.runId;
  }

  getDatasetId(): string {
    return this.datasetId;
  }

  getCampaignStartUtcDate(): string {
    return this.campaignStartUtcDate;
  }

  getCurrentUtcDate(): string | null {
    return this.currentUtcDate;
  }

  /** Current daily partition prefix (changes across UTC midnight). */
  getGcsPrefix(): string {
    const date = this.currentUtcDate ?? utcDateFromMs(Date.now());
    return `${this.gcsPrefixRoot}/${date}`;
  }

  getLocalDir(): string {
    const date = this.currentUtcDate ?? utcDateFromMs(Date.now());
    return join(this.localDirRoot, date);
  }

  setOnCaptureDateObserved(
    cb: ((date: string, dayIndex: number) => void) | null
  ): void {
    this.onCaptureDateObserved = cb;
  }

  enqueue(rec: ResearchCaptureRecord): boolean {
    if (!this.accepting) {
      this.persistenceDroppedRows += 1;
      const d = this.currentUtcDate ? this.days.get(this.currentUtcDate) : null;
      if (d) d.persistenceDroppedRows += 1;
      return false;
    }
    const date = utcDateFromMs(rec.t);
    if (this.currentUtcDate == null) {
      this.openDay(date, rec.t);
    } else if (date !== this.currentUtcDate) {
      // Do not mix UTC dates in one chunk — seal & finalize prior day first.
      this.sealChunk();
      this.pendingDayFinalize.add(this.currentUtcDate);
      this.openDay(date, rec.t);
    }
    this.noteRecord(rec);
    this.buf.push(rec);
    this.bufUtcDate = date;
    if (this.buf.length >= this.chunkRows) this.sealChunk();
    void this.drain();
    return true;
  }

  failIntegrity(reason: string): void {
    this.fatalPersistenceError = true;
    this.accepting = false;
    this.healthWarning = `DATA_INTEGRITY_FAILED: ${reason}`;
    if (this.currentUtcDate) {
      const d = this.days.get(this.currentUtcDate);
      if (d) d.dataIntegrityStatus = "FAILED";
    }
  }

  isAccepting(): boolean {
    return this.accepting;
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

  /** Finalize the current open UTC day (shutdown / explicit). */
  async finalizeCurrentDay(): Promise<string | null> {
    if (!this.currentUtcDate) return null;
    this.sealChunk();
    this.pendingDayFinalize.add(this.currentUtcDate);
    await this.flushAndWait();
    await this.finalizePendingDays();
    const last = this.daySummaries[this.daySummaries.length - 1];
    return last ? join(this.localDirRoot, last.date, "CAPTURE_DAY_SUMMARY.json") : null;
  }

  /** @deprecated prefer finalizeCurrentDay — kept for bridge compatibility */
  async writeDaySummary(summary?: ResearchDaySummary): Promise<string> {
    if (summary) {
      // Explicit override path (tests / legacy): write provided summary for its date.
      return this.persistSummary(summary);
    }
    const path = await this.finalizeCurrentDay();
    return path ?? join(this.localDirRoot, "CAPTURE_DAY_SUMMARY.json");
  }

  private openDay(date: string, t0: number): void {
    this.currentUtcDate = date;
    this.dayChunkIdx = 0;
    this.bufUtcDate = date;
    if (!this.days.has(date)) {
      const idx = captureDayIndexFromDates(this.campaignStartUtcDate, date);
      this.days.set(date, emptyDayAcc(date, idx, t0));
      this.onCaptureDateObserved?.(date, idx);
    }
  }

  private noteRecord(rec: ResearchCaptureRecord): void {
    const date = utcDateFromMs(rec.t);
    const day = this.days.get(date);
    if (!day) return;
    day.captureEndMs = Math.max(day.captureEndMs, rec.t);
    day.captureStartMs = Math.min(day.captureStartMs, rec.t);
    if (rec.eventKind === "SPOT") {
      day.spotEventCount += 1;
      day.eventsReceived += 1;
    } else if (rec.eventKind === "DEPTH") {
      day.depthEventCount += 1;
      day.eventsReceived += 1;
    } else if (rec.eventKind === "HEARTBEAT") {
      day.heartbeatCount += 1;
    } else if (rec.eventKind === "SESSION_TRANSITION") {
      day.sessionTransitionCount += 1;
    } else if (rec.eventKind === "RESYNC_MARKER") {
      day.resyncMarkerCount += 1;
      day.resyncCount += 1;
    }
    if (Array.isArray(rec.specialists)) {
      for (const s of rec.specialists) {
        if (!s.selectedCandidate && s.rawQuality == null && !s.eligible) continue;
        if (s.setup === "A_MOMENTUM_IGNITION") day.candidateA += 1;
        else if (s.setup === "B_FAST_BREAKOUT") day.candidateB += 1;
        else if (s.setup === "C_PULLBACK_REACCEL") day.candidateC += 1;
      }
    }
    if (rec.eventKind === "DEPTH" && rec.market.kind === "DEPTH" && rec.market.crossed) {
      day.bookCrossedCount += 1;
    }
  }

  private sealChunk(): void {
    if (!this.buf.length || !this.bufUtcDate) return;
    // Safety: refuse mixed-date buffers (should not occur).
    const dates = new Set(this.buf.map((r) => utcDateFromMs(r.t)));
    if (dates.size > 1) {
      this.failIntegrity("CHUNK_MIXED_UTC_DATES");
      this.persistenceDroppedChunks += 1;
      this.persistenceDroppedRows += this.buf.length;
      this.buf = [];
      this.bufUtcDate = null;
      return;
    }
    if (this.pending.length >= this.maxQueue) {
      this.failIntegrity("PERSISTENCE_QUEUE_BACKPRESSURE");
      this.persistenceDroppedChunks += 1;
      this.persistenceDroppedRows += this.buf.length;
      const d = this.days.get(this.bufUtcDate);
      if (d) {
        d.persistenceDroppedChunks += 1;
        d.persistenceDroppedRows += this.buf.length;
        d.dataIntegrityStatus = "FAILED";
      }
      this.buf = [];
      this.bufUtcDate = null;
      return;
    }
    this.pending.push({
      records: this.buf,
      utcDate: this.bufUtcDate,
      enqueuedAtMs: Date.now()
    });
    this.buf = [];
    this.bufUtcDate = this.currentUtcDate;
  }

  private async drain(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.pending.length > 0) {
        const chunk = this.pending.shift()!;
        await this.writeChunk(chunk.records, chunk.utcDate);
      }
      await this.finalizePendingDays();
    } finally {
      this.writing = false;
      if (this.pending.length > 0) void this.drain();
    }
  }

  private stillHasWorkForDate(date: string): boolean {
    if (this.bufUtcDate === date && this.buf.length > 0) return true;
    return this.pending.some((p) => p.utcDate === date);
  }

  private async finalizePendingDays(): Promise<void> {
    for (const date of [...this.pendingDayFinalize]) {
      if (this.stillHasWorkForDate(date)) continue;
      if (this.finalizedDays.has(date)) {
        this.pendingDayFinalize.delete(date);
        continue;
      }
      const summary = this.buildDaySummary(date);
      if (summary) {
        await this.persistSummary(summary);
        this.daySummaries.push(summary);
        this.finalizedDays.add(date);
      }
      this.pendingDayFinalize.delete(date);
    }
  }

  private buildDaySummary(date: string): ResearchDaySummary | null {
    const day = this.days.get(date);
    if (!day) return null;
    const eligible =
      day.dataIntegrityStatus === "CLEAN" &&
      day.persistenceDroppedRows === 0 &&
      day.persistenceDroppedChunks === 0 &&
      day.eventsDropped === 0 &&
      day.writeErrors === 0 &&
      (!this.campaignMode || this.gcsBucket != null);
    return {
      date,
      runId: this.runId,
      datasetId: this.datasetId,
      schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
      captureDayIndex: day.captureDayIndex,
      captureStart: new Date(day.captureStartMs).toISOString(),
      captureEnd: new Date(day.captureEndMs).toISOString(),
      eventsReceived: day.eventsReceived,
      eventsDropped: day.eventsDropped,
      spotEventCount: day.spotEventCount,
      depthEventCount: day.depthEventCount,
      heartbeatCount: day.heartbeatCount,
      sessionTransitionCount: day.sessionTransitionCount,
      candidateA: day.candidateA,
      candidateB: day.candidateB,
      candidateC: day.candidateC,
      feedGapCount: day.feedGapCount,
      reconnectCount: day.reconnectCount,
      resyncCount: day.resyncCount,
      bookCrossedCount: day.bookCrossedCount,
      chunksWritten: day.chunksWritten,
      chunksUploaded: day.chunksUploaded,
      persistenceDroppedRows: day.persistenceDroppedRows,
      persistenceDroppedChunks: day.persistenceDroppedChunks,
      writeErrors: day.writeErrors,
      uploadErrors: day.uploadErrors,
      dataIntegrityStatus: day.dataIntegrityStatus,
      brokerRequests: 0,
      brokerOrders: 0,
      shadowOrders: 0,
      executionAdapter: "NONE",
      mode: GH_FAST_RESEARCH_MODE,
      campaignValid: eligible && this.campaignMode ? this.gcsBucket != null : eligible,
      contaminated: !eligible,
      durableMode: this.gcsBucket ? "GCS" : "LOCAL_BUFFER_ONLY",
      scopeVerified: true,
      heartbeatsPersisted: day.heartbeatCount,
      sessionTransitionsPersisted: day.sessionTransitionCount,
      campaignDayEligibleForLaterValidation: eligible,
      validatedIndependentDays: 0,
      note: "campaignDayEligibleForLaterValidation means technically clean for later analysis — not profitable and not independently validated."
    };
  }

  private async persistSummary(summary: ResearchDaySummary): Promise<string> {
    const dayDir = join(this.localDirRoot, summary.date);
    await mkdir(dayDir, { recursive: true });
    const path = join(dayDir, "CAPTURE_DAY_SUMMARY.json");
    const body = Buffer.from(JSON.stringify(summary, null, 2), "utf8");
    await writeFile(path, body);
    if (this.gcsBucket) {
      const objectPath = `${this.gcsPrefixRoot}/${summary.date}/CAPTURE_DAY_SUMMARY.json`;
      await tryUploadGcs(this.gcsBucket, objectPath, body, "application/json");
    }
    return path;
  }

  private async writeChunk(
    records: ResearchCaptureRecord[],
    utcDate: string
  ): Promise<void> {
    const startTs = records[0]?.t ?? Date.now();
    const endTs = records[records.length - 1]?.t ?? startTs;
    const sequenceStart = records[0]?.receiveSeq ?? 0;
    const sequenceEnd = records[records.length - 1]?.receiveSeq ?? sequenceStart;
    const body = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const gz = gzipSync(Buffer.from(body, "utf8"));
    const sha256 = createHash("sha256").update(gz).digest("hex");
    const name = `chunk-${String(this.dayChunkIdx).padStart(5, "0")}.ndjson.gz`;
    const dayDir = join(this.localDirRoot, utcDate);
    const gcsPrefix = `${this.gcsPrefixRoot}/${utcDate}`;
    const day = this.days.get(utcDate);

    try {
      await mkdir(dayDir, { recursive: true });
      const localPath = join(dayDir, name);
      await writeFile(localPath, gz);
      const manifest: ResearchChunkManifest = {
        runId: this.runId,
        datasetId: this.datasetId,
        schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
        runtimeSha: this.runtimeSha,
        researchConfigSha: this.researchConfigSha,
        captureStart: this.captureStart,
        chunkIndex: this.dayChunkIdx,
        startTs,
        endTs,
        rowCount: records.length,
        sequenceStart,
        sequenceEnd,
        sha256,
        gcsObject: null,
        localPath,
        uploadedAt: null,
        storagePrefix: GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
        captureUtcDate: utcDate
      };
      if (this.gcsBucket) {
        const objectPath = `${gcsPrefix}/${name}`;
        const up = await tryUploadGcs(this.gcsBucket, objectPath, gz);
        if (up.ok) {
          manifest.gcsObject = `gs://${this.gcsBucket}/${objectPath}`;
          manifest.uploadedAt = new Date().toISOString();
          this.chunksUploaded += 1;
          if (day) day.chunksUploaded += 1;
          const manBody = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
          await tryUploadGcs(
            this.gcsBucket,
            `${gcsPrefix}/${name}.manifest.json`,
            manBody,
            "application/json"
          );
        } else {
          this.uploadErrors += 1;
          if (day) {
            day.uploadErrors += 1;
            if (day.dataIntegrityStatus === "CLEAN") {
              day.dataIntegrityStatus = "DEGRADED";
            }
          }
          this.healthWarning = `GCS_UPLOAD_FAILED — local buffer retained (${up.error})`;
        }
      }
      await appendFile(
        join(dayDir, "checkpoint.jsonl"),
        JSON.stringify(manifest) + "\n"
      );
      await writeFile(
        join(dayDir, `${name}.manifest.json`),
        JSON.stringify(manifest, null, 2)
      );
      this.manifests.push(manifest);
      this.chunksWritten += 1;
      this.dayChunkIdx += 1;
      if (day) day.chunksWritten += 1;
    } catch {
      this.writeErrors += 1;
      this.persistenceDroppedChunks += 1;
      this.persistenceDroppedRows += records.length;
      if (day) {
        day.writeErrors += 1;
        day.persistenceDroppedChunks += 1;
        day.persistenceDroppedRows += records.length;
        day.dataIntegrityStatus = "FAILED";
      }
      this.failIntegrity("LOCAL_PERSIST_FAILED");
    }
  }

  stats() {
    return {
      queueDepth: this.pending.length + (this.buf.length > 0 ? 1 : 0),
      persistenceQueueDepth: this.pending.length + (this.buf.length > 0 ? 1 : 0),
      chunksWritten: this.chunksWritten,
      chunksUploaded: this.chunksUploaded,
      writeErrors: this.writeErrors,
      uploadErrors: this.uploadErrors,
      persistenceDroppedChunks: this.persistenceDroppedChunks,
      persistenceDroppedRows: this.persistenceDroppedRows,
      fatalPersistenceError: this.fatalPersistenceError,
      accepting: this.accepting,
      healthWarning: this.healthWarning,
      durableMode: (this.gcsBucket ? "GCS" : "LOCAL_BUFFER_ONLY") as
        | "GCS"
        | "LOCAL_BUFFER_ONLY",
      campaignMode: this.campaignMode,
      gcsPrefix: this.getGcsPrefix(),
      gcsPrefixRoot: this.gcsPrefixRoot,
      currentUtcDate: this.currentUtcDate,
      campaignStartUtcDate: this.campaignStartUtcDate,
      localDir: this.getLocalDir()
    };
  }
}
