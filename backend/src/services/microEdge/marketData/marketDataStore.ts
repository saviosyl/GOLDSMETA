/**
 * Micro raw market-data storage under microEdge/shadow-v1/marketData/**
 * Rejects writes outside Micro namespace. Memory impl for tests / V1.1 API.
 */
import { getFirestore } from "firebase-admin/firestore";
import { MICRO_NAMESPACE } from "../config";
import { barDocumentId } from "./microCTraderProtocol";
import type {
  MicroBackfillCheckpoint,
  MicroRawBarRecord,
  MicroRawQuoteRecord,
  MicroSymbolMetadata,
  MicroTimeframe
} from "./types";
import type { MicroBoundaryQuote } from "./historicalTicks";
import {
  assertMicroStorageModeAllowed,
  resolveMicroStorageMode,
  type MicroStorageMode
} from "./storageMode";

export type UpsertBarResult = "created" | "skipped_identical" | "conflict";

export type MicroBoundaryCheckpoint = {
  kind: "BOUNDARY_QUOTES";
  cursorFromMs: number;
  cursorToMs: number;
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED";
  inserted: number;
  skipped: number;
  unscorable: number;
  attempts: number;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
};

export interface MicroMarketDataStore {
  upsertBar(bar: MicroRawBarRecord): Promise<UpsertBarResult>;
  getBar(id: string): Promise<MicroRawBarRecord | null>;
  countBars(timeframe: MicroTimeframe): Promise<number>;
  latestBar(timeframe: MicroTimeframe): Promise<MicroRawBarRecord | null>;
  listBarsCompletedAtOrBefore(
    timeframe: MicroTimeframe,
    cutoffCloseMs: number,
    limit: number
  ): Promise<MicroRawBarRecord[]>;
  saveQuoteSample(q: MicroRawQuoteRecord): Promise<"created" | "skipped">;
  countQuotes(): Promise<number>;
  latestQuote(): Promise<MicroRawQuoteRecord | null>;
  saveSymbolMetadata(m: MicroSymbolMetadata): Promise<void>;
  getSymbolMetadata(): Promise<MicroSymbolMetadata | null>;
  saveCheckpoint(c: MicroBackfillCheckpoint): Promise<void>;
  getCheckpoint(tf: MicroTimeframe): Promise<MicroBackfillCheckpoint | null>;
  saveCollectorHeartbeat(at: string, payload: Record<string, unknown>): Promise<void>;
  getCollectorHeartbeat(): Promise<{ at: string; payload: Record<string, unknown> } | null>;
  saveBoundaryQuote(q: MicroBoundaryQuote): Promise<"created" | "skipped">;
  getBoundaryQuote(id: string): Promise<MicroBoundaryQuote | null>;
  countBoundaryQuotes(): Promise<number>;
  listBoundaryQuotes(limit?: number): Promise<MicroBoundaryQuote[]>;
  saveBoundaryCheckpoint(c: MicroBoundaryCheckpoint): Promise<void>;
  getBoundaryCheckpoint(): Promise<MicroBoundaryCheckpoint | null>;
}

function assertMicroMarketPath(relative: string): void {
  const full = `${MICRO_NAMESPACE}/marketData/${relative}`;
  if (!full.startsWith(`${MICRO_NAMESPACE}/`)) {
    throw new Error(`MICRO_STORE_NAMESPACE_VIOLATION: ${full}`);
  }
}

function barsEqual(a: MicroRawBarRecord, b: MicroRawBarRecord): boolean {
  return (
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.tickVolume === b.tickVolume &&
    a.openTimeMs === b.openTimeMs &&
    a.closeTimeMs === b.closeTimeMs
  );
}

export class MemoryMicroMarketDataStore implements MicroMarketDataStore {
  bars = new Map<string, MicroRawBarRecord>();
  quotes = new Map<string, MicroRawQuoteRecord>();
  boundaryQuotes = new Map<string, MicroBoundaryQuote>();
  symbol: MicroSymbolMetadata | null = null;
  checkpoints = new Map<MicroTimeframe, MicroBackfillCheckpoint>();
  boundaryCheckpoint: MicroBoundaryCheckpoint | null = null;
  heartbeat: { at: string; payload: Record<string, unknown> } | null = null;
  conflicts: Array<{ id: string; existing: MicroRawBarRecord; incoming: MicroRawBarRecord }> =
    [];

  async upsertBar(bar: MicroRawBarRecord): Promise<UpsertBarResult> {
    assertMicroMarketPath(`bars${bar.timeframe}/${bar.id}`);
    const existing = this.bars.get(bar.id);
    if (!existing) {
      this.bars.set(bar.id, bar);
      return "created";
    }
    if (barsEqual(existing, bar)) return "skipped_identical";
    // Do NOT silently overwrite — keep original, audit conflict.
    this.conflicts.push({ id: bar.id, existing, incoming: bar });
    return "conflict";
  }

  async getBar(id: string): Promise<MicroRawBarRecord | null> {
    return this.bars.get(id) ?? null;
  }

  async countBars(timeframe: MicroTimeframe): Promise<number> {
    let n = 0;
    for (const b of this.bars.values()) if (b.timeframe === timeframe) n++;
    return n;
  }

  async latestBar(timeframe: MicroTimeframe): Promise<MicroRawBarRecord | null> {
    let best: MicroRawBarRecord | null = null;
    for (const b of this.bars.values()) {
      if (b.timeframe !== timeframe) continue;
      if (!best || b.closeTimeMs > best.closeTimeMs) best = b;
    }
    return best;
  }

  async listBarsCompletedAtOrBefore(
    timeframe: MicroTimeframe,
    cutoffCloseMs: number,
    limit: number
  ): Promise<MicroRawBarRecord[]> {
    return [...this.bars.values()]
      .filter((b) => b.timeframe === timeframe && b.closeTimeMs <= cutoffCloseMs)
      .sort((a, b) => b.closeTimeMs - a.closeTimeMs)
      .slice(0, limit)
      .reverse();
  }

  async saveQuoteSample(q: MicroRawQuoteRecord): Promise<"created" | "skipped"> {
    assertMicroMarketPath(`quotes/${q.id}`);
    if (this.quotes.has(q.id)) return "skipped";
    this.quotes.set(q.id, q);
    return "created";
  }

  async countQuotes(): Promise<number> {
    return this.quotes.size;
  }

  async latestQuote(): Promise<MicroRawQuoteRecord | null> {
    let best: MicroRawQuoteRecord | null = null;
    for (const q of this.quotes.values()) {
      if (!best || q.brokerTimestamp > best.brokerTimestamp) best = q;
    }
    return best;
  }

  async saveSymbolMetadata(m: MicroSymbolMetadata): Promise<void> {
    assertMicroMarketPath("symbolMetadata/current");
    this.symbol = m;
  }

  async getSymbolMetadata(): Promise<MicroSymbolMetadata | null> {
    return this.symbol;
  }

  async saveCheckpoint(c: MicroBackfillCheckpoint): Promise<void> {
    assertMicroMarketPath(`checkpoints/${c.timeframe}`);
    this.checkpoints.set(c.timeframe, c);
  }

  async getCheckpoint(tf: MicroTimeframe): Promise<MicroBackfillCheckpoint | null> {
    return this.checkpoints.get(tf) ?? null;
  }

  async saveCollectorHeartbeat(
    at: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    assertMicroMarketPath("collectorStatus/heartbeat");
    this.heartbeat = { at, payload };
  }

  async getCollectorHeartbeat(): Promise<{
    at: string;
    payload: Record<string, unknown>;
  } | null> {
    return this.heartbeat;
  }

  async saveBoundaryQuote(q: MicroBoundaryQuote): Promise<"created" | "skipped"> {
    assertMicroMarketPath(`boundaryQuotes/${q.id}`);
    if (this.boundaryQuotes.has(q.id)) return "skipped";
    this.boundaryQuotes.set(q.id, q);
    return "created";
  }

  async getBoundaryQuote(id: string): Promise<MicroBoundaryQuote | null> {
    return this.boundaryQuotes.get(id) ?? null;
  }

  async countBoundaryQuotes(): Promise<number> {
    return this.boundaryQuotes.size;
  }

  async listBoundaryQuotes(limit = 10_000): Promise<MicroBoundaryQuote[]> {
    return [...this.boundaryQuotes.values()]
      .sort((a, b) => a.boundaryTimestampMs - b.boundaryTimestampMs)
      .slice(0, limit);
  }

  async saveBoundaryCheckpoint(c: MicroBoundaryCheckpoint): Promise<void> {
    assertMicroMarketPath("checkpoints/BOUNDARY_QUOTES");
    this.boundaryCheckpoint = c;
  }

  async getBoundaryCheckpoint(): Promise<MicroBoundaryCheckpoint | null> {
    return this.boundaryCheckpoint;
  }
}

export class FirestoreMicroMarketDataStore implements MicroMarketDataStore {
  private col(name: string) {
    assertMicroMarketPath(`${name}/x`);
    const [root, docId] = MICRO_NAMESPACE.split("/");
    return getFirestore()
      .collection(root!)
      .doc(docId!)
      .collection("marketData")
      .doc("_")
      .collection(name);
  }

  async upsertBar(bar: MicroRawBarRecord): Promise<UpsertBarResult> {
    const ref = this.col(`bars${bar.timeframe}`).doc(bar.id);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.create(ref, bar);
        return "created";
      }
      const existing = snap.data() as MicroRawBarRecord;
      if (barsEqual(existing, bar)) return "skipped_identical";
      tx.set(
        this.col("barConflicts").doc(`${bar.id}_${Date.now()}`),
        { existing, incoming: bar, at: new Date().toISOString() },
        { merge: true }
      );
      return "conflict";
    });
  }

  async getBar(id: string): Promise<MicroRawBarRecord | null> {
    for (const tf of ["M1", "M5", "M15"] as MicroTimeframe[]) {
      const snap = await this.col(`bars${tf}`).doc(id).get();
      if (snap.exists) return snap.data() as MicroRawBarRecord;
    }
    return null;
  }

  async countBars(timeframe: MicroTimeframe): Promise<number> {
    const snap = await this.col(`bars${timeframe}`).count().get();
    return snap.data().count;
  }

  async latestBar(timeframe: MicroTimeframe): Promise<MicroRawBarRecord | null> {
    const snap = await this.col(`bars${timeframe}`)
      .orderBy("closeTimeMs", "desc")
      .limit(1)
      .get();
    return snap.docs[0]?.data() as MicroRawBarRecord | undefined ?? null;
  }

  async listBarsCompletedAtOrBefore(
    timeframe: MicroTimeframe,
    cutoffCloseMs: number,
    limit: number
  ): Promise<MicroRawBarRecord[]> {
    const snap = await this.col(`bars${timeframe}`)
      .where("closeTimeMs", "<=", cutoffCloseMs)
      .orderBy("closeTimeMs", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as MicroRawBarRecord).reverse();
  }

  async saveQuoteSample(q: MicroRawQuoteRecord): Promise<"created" | "skipped"> {
    const ref = this.col("quotes").doc(q.id);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return "skipped";
      tx.create(ref, q);
      return "created";
    });
  }

  async countQuotes(): Promise<number> {
    const snap = await this.col("quotes").count().get();
    return snap.data().count;
  }

  async latestQuote(): Promise<MicroRawQuoteRecord | null> {
    const snap = await this.col("quotes").orderBy("brokerTimestamp", "desc").limit(1).get();
    return snap.docs[0]?.data() as MicroRawQuoteRecord | undefined ?? null;
  }

  async saveSymbolMetadata(m: MicroSymbolMetadata): Promise<void> {
    await this.col("symbolMetadata").doc("current").set(m, { merge: true });
  }

  async getSymbolMetadata(): Promise<MicroSymbolMetadata | null> {
    const snap = await this.col("symbolMetadata").doc("current").get();
    return snap.exists ? (snap.data() as MicroSymbolMetadata) : null;
  }

  async saveCheckpoint(c: MicroBackfillCheckpoint): Promise<void> {
    await this.col("checkpoints").doc(c.timeframe).set(c, { merge: true });
  }

  async getCheckpoint(tf: MicroTimeframe): Promise<MicroBackfillCheckpoint | null> {
    const snap = await this.col("checkpoints").doc(tf).get();
    return snap.exists ? (snap.data() as MicroBackfillCheckpoint) : null;
  }

  async saveCollectorHeartbeat(
    at: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.col("collectorStatus").doc("heartbeat").set({ at, payload }, { merge: true });
  }

  async getCollectorHeartbeat(): Promise<{
    at: string;
    payload: Record<string, unknown>;
  } | null> {
    const snap = await this.col("collectorStatus").doc("heartbeat").get();
    return snap.exists
      ? (snap.data() as { at: string; payload: Record<string, unknown> })
      : null;
  }

  async saveBoundaryQuote(q: MicroBoundaryQuote): Promise<"created" | "skipped"> {
    const ref = this.col("boundaryQuotes").doc(q.id);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return "skipped";
      tx.create(ref, q);
      return "created";
    });
  }

  async getBoundaryQuote(id: string): Promise<MicroBoundaryQuote | null> {
    const snap = await this.col("boundaryQuotes").doc(id).get();
    return snap.exists ? (snap.data() as MicroBoundaryQuote) : null;
  }

  async countBoundaryQuotes(): Promise<number> {
    const snap = await this.col("boundaryQuotes").count().get();
    return snap.data().count;
  }

  async listBoundaryQuotes(limit = 10_000): Promise<MicroBoundaryQuote[]> {
    const snap = await this.col("boundaryQuotes")
      .orderBy("boundaryTimestampMs", "asc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as MicroBoundaryQuote);
  }

  async saveBoundaryCheckpoint(c: MicroBoundaryCheckpoint): Promise<void> {
    await this.col("checkpoints").doc("BOUNDARY_QUOTES").set(c, { merge: true });
  }

  async getBoundaryCheckpoint(): Promise<MicroBoundaryCheckpoint | null> {
    const snap = await this.col("checkpoints").doc("BOUNDARY_QUOTES").get();
    return snap.exists ? (snap.data() as MicroBoundaryCheckpoint) : null;
  }
}

export function makeRawBar(args: {
  symbol: string;
  symbolId: string;
  timeframe: MicroTimeframe;
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  environment: "DEMO" | "LIVE";
  source?: MicroRawBarRecord["source"];
  collectedAt?: string;
}): MicroRawBarRecord {
  return {
    id: barDocumentId(args.symbol, args.timeframe, args.closeTimeMs),
    symbol: args.symbol,
    symbolId: args.symbolId,
    timeframe: args.timeframe,
    openTimeMs: args.openTimeMs,
    closeTimeMs: args.closeTimeMs,
    open: args.open,
    high: args.high,
    low: args.low,
    close: args.close,
    tickVolume: args.tickVolume,
    source: args.source ?? "CTRADER_OPEN_API",
    environment: args.environment,
    collectedAt: args.collectedAt ?? new Date().toISOString()
  };
}

let defaultMarketStore: MicroMarketDataStore | null = null;
/** Shared memory singleton for cross-instance memory-mode tests. */
let sharedMemoryMarketStore: MemoryMicroMarketDataStore | null = null;

export function createMicroMarketDataStore(args?: {
  mode?: MicroStorageMode;
  sharedMemory?: MemoryMicroMarketDataStore;
}): MicroMarketDataStore {
  const mode = args?.mode ?? resolveMicroStorageMode();
  assertMicroStorageModeAllowed(mode);
  if (mode === "firestore") return new FirestoreMicroMarketDataStore();
  if (args?.sharedMemory) return args.sharedMemory;
  if (!sharedMemoryMarketStore) {
    sharedMemoryMarketStore = new MemoryMicroMarketDataStore();
  }
  return sharedMemoryMarketStore;
}

export function getMicroMarketDataStore(): MicroMarketDataStore {
  if (!defaultMarketStore) defaultMarketStore = createMicroMarketDataStore();
  return defaultMarketStore;
}

export function resetMicroMarketDataStoreForTests(
  shared?: MemoryMicroMarketDataStore
): MemoryMicroMarketDataStore {
  sharedMemoryMarketStore = shared ?? new MemoryMicroMarketDataStore();
  defaultMarketStore = sharedMemoryMarketStore;
  return sharedMemoryMarketStore;
}
