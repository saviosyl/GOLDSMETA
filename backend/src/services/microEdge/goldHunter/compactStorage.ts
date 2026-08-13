/**
 * Compact historical/model dataset storage — NOT millions of Firestore docs.
 * Uses compressed NDJSON chunks on local disk / optional GCS-like path.
 */
import { createHash } from "node:crypto";
import { createGzip, gunzipSync, gzipSync } from "node:zlib";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

export type ChunkMeta = {
  chunkId: string;
  fromMs: number;
  toMs: number;
  rowCount: number;
  sha256: string;
  path: string;
};

export type DatasetManifest = {
  datasetId: string;
  featureSchemaVersion: string;
  createdAt: string;
  chunks: ChunkMeta[];
  totalRows: number;
  datasetHash: string;
};

export function rowsToNdjson(rows: unknown[]): Buffer {
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  return gzipSync(Buffer.from(body, "utf8"));
}

export function ndjsonGzToRows<T>(buf: Buffer): T[] {
  const text = gunzipSync(buf).toString("utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length)
    .map((l) => JSON.parse(l) as T);
}

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Write one-minute (or arbitrary) chunk of second-level rows. */
export async function writeChunkFile(
  baseDir: string,
  chunkId: string,
  rows: unknown[]
): Promise<ChunkMeta> {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${chunkId}.ndjson.gz`);
  const buf = rowsToNdjson(rows);
  await writeFile(path, buf);
  const ts = rows
    .map((r) => (r as { timestampMs?: number }).timestampMs)
    .filter((x): x is number => typeof x === "number");
  return {
    chunkId,
    fromMs: ts.length ? Math.min(...ts) : 0,
    toMs: ts.length ? Math.max(...ts) : 0,
    rowCount: rows.length,
    sha256: hashBuffer(buf),
    path
  };
}

export async function writeManifest(
  baseDir: string,
  manifest: DatasetManifest
): Promise<string> {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, "manifest.json");
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
  return path;
}

export async function readManifest(
  baseDir: string
): Promise<DatasetManifest | null> {
  const path = join(baseDir, "manifest.json");
  try {
    await access(path);
    return JSON.parse(await readFile(path, "utf8")) as DatasetManifest;
  } catch {
    return null;
  }
}

export async function writeModelArtifactFile(
  baseDir: string,
  artifact: unknown
): Promise<string> {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, "model-artifact.json");
  await writeFile(path, JSON.stringify(artifact, null, 2), "utf8");
  return path;
}

export function defaultResearchDataDir(): string {
  return (
    process.env.GOLD_HUNTER_DATA_DIR ??
    join(process.cwd(), ".gold-hunter-data")
  );
}

/** Stream-write large NDJSON.gz without loading all rows as one string (optional). */
export async function appendNdjsonGzStream(
  filePath: string,
  rows: unknown[]
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const gzip = createGzip();
  const out = createWriteStream(filePath);
  const done = pipeline(gzip, out);
  for (const r of rows) {
    gzip.write(JSON.stringify(r) + "\n");
  }
  gzip.end();
  await done;
}

export async function readNdjsonGzFile<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return [];
  const buf = await readFile(filePath);
  return ndjsonGzToRows<T>(buf);
}

/** Checkpoint for historical download resume. */
export type HistoricalCheckpoint = {
  side: "BID" | "ASK";
  nextFromTimestampMs: number;
  pagesFetched: number;
  ticksAccepted: number;
};

export async function loadCheckpoint(
  baseDir: string
): Promise<HistoricalCheckpoint | null> {
  const path = join(baseDir, "checkpoint.json");
  try {
    return JSON.parse(await readFile(path, "utf8")) as HistoricalCheckpoint;
  } catch {
    return null;
  }
}

export async function saveCheckpoint(
  baseDir: string,
  cp: HistoricalCheckpoint
): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  await writeFile(
    join(baseDir, "checkpoint.json"),
    JSON.stringify(cp, null, 2),
    "utf8"
  );
}

// silence unused import lint for readline if unused
void createInterface;
void createReadStream;
