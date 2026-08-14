/**
 * In-memory Level-II book from ProtoOADepthEvent newQuotes / deletedQuotes.
 * Deleted quotes = observed liquidity disappearance — NOT assumed executions.
 */
import { normalizeQuoteId } from "./depthProtocol";
import type { GhFastDepthEvent, GhFastDepthQuote, GhFastDeletedQuoteRef } from "./types";

export type DepthSide = "BID" | "ASK";

export type DepthLevel = {
  id: string;
  price: number;
  size: number;
};

export type DepthBookStats = {
  available: boolean;
  topBidDepth: number;
  topAskDepth: number;
  bidDepthN: number;
  askDepthN: number;
  bidLevels: number;
  askLevels: number;
  depthRatio: number;
  depthImbalance: number;
  weightedImbalance: number;
  liquidityAddedBid: number;
  liquidityAddedAsk: number;
  liquidityRemovedBid: number;
  liquidityRemovedAsk: number;
  addRateBid: number;
  addRateAsk: number;
  removeRateBid: number;
  removeRateAsk: number;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  crossed: boolean;
  lastUpdateMs: number | null;
  /** Last time stats() saw a non-crossed two-sided book. */
  lastValidBookMs: number | null;
  /** Consecutive applyDepthEvent cycles where available remained false. */
  consecutiveInvalidSnapshots: number;
  bookGeneration: number;
  resyncCount: number;
  deleteHits: number;
  deleteMisses: number;
  deleteHitRate: number;
};

function sideOf(q: GhFastDepthQuote): DepthSide | null {
  if (q.type === "BID" || q.type === 1) return "BID";
  if (q.type === "ASK" || q.type === 2) return "ASK";
  return null;
}

function levelId(q: GhFastDepthQuote, side: DepthSide): string {
  const nid = normalizeQuoteId(q.id);
  if (nid != null) return nid;
  return `${side}:${q.price}`;
}

function deletedIdOf(d: GhFastDeletedQuoteRef): string | null {
  if (typeof d === "number" || typeof d === "string" || typeof d === "bigint") {
    return normalizeQuoteId(d);
  }
  if (d != null && typeof d === "object") {
    return normalizeQuoteId((d as { id?: unknown }).id);
  }
  return null;
}

export class InMemoryDepthBook {
  private bids = new Map<string, DepthLevel>();
  private asks = new Map<string, DepthLevel>();
  private lastUpdateMs: number | null = null;
  private lastValidBookMs: number | null = null;
  private consecutiveInvalidSnapshots = 0;
  private bookGeneration = 0;
  private resyncCount = 0;
  private windowMs = 1000;
  private addedBid = 0;
  private addedAsk = 0;
  private removedBid = 0;
  private removedAsk = 0;
  private rateWindowStart = 0;
  private deleteHits = 0;
  private deleteMisses = 0;

  constructor(opts?: { rateWindowMs?: number }) {
    this.windowMs = opts?.rateWindowMs ?? 1000;
  }

  /**
   * Hard market-data reset for transport reconnect / book resync.
   * Drops all quote IDs so a stale pre-reconnect Level-II book cannot
   * contaminate a newly subscribed depth stream.
   * Preserves cumulative deleteHits/Misses for monitor diagnostics.
   */
  clearForResync(): void {
    this.bids.clear();
    this.asks.clear();
    this.lastUpdateMs = null;
    this.lastValidBookMs = null;
    this.consecutiveInvalidSnapshots = 0;
    this.resetRates(0);
    this.bookGeneration += 1;
    this.resyncCount += 1;
  }

  clear(): void {
    this.clearMaps();
    this.bookGeneration += 1;
  }

  private clearMaps(): void {
    this.bids.clear();
    this.asks.clear();
    this.lastUpdateMs = null;
    this.lastValidBookMs = null;
    this.consecutiveInvalidSnapshots = 0;
    this.resetRates(0);
    this.deleteHits = 0;
    this.deleteMisses = 0;
  }

  generation(): number {
    return this.bookGeneration;
  }

  resyncs(): number {
    return this.resyncCount;
  }

  hasQuoteId(id: string): boolean {
    return this.bids.has(id) || this.asks.has(id);
  }

  deleteHitRate(): number {
    const n = this.deleteHits + this.deleteMisses;
    return n > 0 ? this.deleteHits / n : 0;
  }

  deleteMissCount(): number {
    return this.deleteMisses;
  }

  private resetRates(nowMs: number): void {
    this.addedBid = 0;
    this.addedAsk = 0;
    this.removedBid = 0;
    this.removedAsk = 0;
    this.rateWindowStart = nowMs;
  }

  private rollRates(nowMs: number): void {
    if (!this.rateWindowStart) this.rateWindowStart = nowMs;
    if (nowMs - this.rateWindowStart >= this.windowMs) {
      this.resetRates(nowMs);
    }
  }

  applyDepthEvent(ev: GhFastDepthEvent): void {
    const now = ev.receivedAtMs;
    this.rollRates(now);
    this.lastUpdateMs = now;

    for (const q of ev.newQuotes ?? []) {
      const side = sideOf(q);
      if (!side || !(q.price > 0) || !(q.size >= 0)) continue;
      const id = levelId(q, side);
      const map = side === "BID" ? this.bids : this.asks;
      // Remove from opposite side if id migrates (shouldn't, but safe).
      const other = side === "BID" ? this.asks : this.bids;
      if (other.has(id)) other.delete(id);
      const prev = map.get(id);
      const next: DepthLevel = { id, price: q.price, size: q.size };
      map.set(id, next);
      const delta = q.size - (prev?.size ?? 0);
      if (delta > 0) {
        if (side === "BID") this.addedBid += delta;
        else this.addedAsk += delta;
      } else if (delta < 0) {
        if (side === "BID") this.removedBid += -delta;
        else this.removedAsk += -delta;
      } else if (!prev) {
        if (side === "BID") this.addedBid += q.size;
        else this.addedAsk += q.size;
      }
    }

    for (const d of ev.deletedQuotes ?? []) {
      const id = deletedIdOf(d);
      if (id == null) continue;
      const b = this.bids.get(id);
      const a = this.asks.get(id);
      let hit = false;
      if (b) {
        this.bids.delete(id);
        this.removedBid += b.size;
        hit = true;
      }
      if (a) {
        this.asks.delete(id);
        this.removedAsk += a.size;
        hit = true;
      }
      if (hit) this.deleteHits += 1;
      else this.deleteMisses += 1;
    }

    // Track sustained invalid books while events keep arriving.
    const bids = this.sortedBids();
    const asks = this.sortedAsks();
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const crossed =
      bestBid != null && bestAsk != null ? bestBid >= bestAsk : false;
    const available = bids.length > 0 && asks.length > 0 && !crossed;
    if (available) {
      this.lastValidBookMs = now;
      this.consecutiveInvalidSnapshots = 0;
    } else {
      this.consecutiveInvalidSnapshots += 1;
    }
  }

  private sortedBids(): DepthLevel[] {
    return [...this.bids.values()].sort((a, b) => b.price - a.price);
  }

  private sortedAsks(): DepthLevel[] {
    return [...this.asks.values()].sort((a, b) => a.price - b.price);
  }

  stats(topN = 5): DepthBookStats {
    const bids = this.sortedBids();
    const asks = this.sortedAsks();
    const available = bids.length > 0 && asks.length > 0;
    const bidN = bids.slice(0, topN);
    const askN = asks.slice(0, topN);
    const bidDepthN = bidN.reduce((s, l) => s + l.size, 0);
    const askDepthN = askN.reduce((s, l) => s + l.size, 0);
    const den = bidDepthN + askDepthN;
    const depthImbalance = den > 0 ? (bidDepthN - askDepthN) / den : 0;
    const depthRatio = askDepthN > 0 ? bidDepthN / askDepthN : bidDepthN > 0 ? 99 : 1;
    let wBid = 0;
    let wAsk = 0;
    for (const l of bidN) wBid += l.price * l.size;
    for (const l of askN) wAsk += l.price * l.size;
    const wDen = wBid + wAsk;
    const weightedImbalance = wDen > 0 ? (wBid - wAsk) / wDen : 0;
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const crossed =
      bestBid != null && bestAsk != null ? bestBid >= bestAsk : false;
    const elapsed = Math.max(1, this.windowMs);
    const bookAvailable = available && !crossed;
    if (bookAvailable && this.lastUpdateMs != null) {
      this.lastValidBookMs = this.lastUpdateMs;
    }
    return {
      available: bookAvailable,
      topBidDepth: bids[0]?.size ?? 0,
      topAskDepth: asks[0]?.size ?? 0,
      bidDepthN,
      askDepthN,
      bidLevels: bids.length,
      askLevels: asks.length,
      depthRatio,
      depthImbalance,
      weightedImbalance,
      liquidityAddedBid: this.addedBid,
      liquidityAddedAsk: this.addedAsk,
      liquidityRemovedBid: this.removedBid,
      liquidityRemovedAsk: this.removedAsk,
      addRateBid: this.addedBid / (elapsed / 1000),
      addRateAsk: this.addedAsk / (elapsed / 1000),
      removeRateBid: this.removedBid / (elapsed / 1000),
      removeRateAsk: this.removedAsk / (elapsed / 1000),
      bestBid,
      bestAsk,
      spread:
        bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
      crossed,
      lastUpdateMs: this.lastUpdateMs,
      lastValidBookMs: this.lastValidBookMs,
      consecutiveInvalidSnapshots: this.consecutiveInvalidSnapshots,
      bookGeneration: this.bookGeneration,
      resyncCount: this.resyncCount,
      deleteHits: this.deleteHits,
      deleteMisses: this.deleteMisses,
      deleteHitRate: this.deleteHitRate()
    };
  }

  /** Snapshot for persistence/replay (compact). */
  snapshot(topN = 10): {
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  } {
    return {
      bids: this.sortedBids()
        .slice(0, topN)
        .map((l) => ({ price: l.price, size: l.size })),
      asks: this.sortedAsks()
        .slice(0, topN)
        .map((l) => ({ price: l.price, size: l.size }))
    };
  }
}
