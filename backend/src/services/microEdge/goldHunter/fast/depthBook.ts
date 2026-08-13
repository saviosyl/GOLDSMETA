/**
 * In-memory Level-II book from ProtoOADepthEvent newQuotes / deletedQuotes.
 * Deleted quotes = observed liquidity disappearance — NOT assumed executions.
 */
import type { GhFastDepthEvent, GhFastDepthQuote } from "./types";

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
  lastUpdateMs: number | null;
};

function sideOf(q: GhFastDepthQuote): DepthSide | null {
  if (q.type === "BID" || q.type === 1) return "BID";
  if (q.type === "ASK" || q.type === 2) return "ASK";
  return null;
}

function levelId(q: GhFastDepthQuote, side: DepthSide): string {
  if (q.id != null) return String(q.id);
  return `${side}:${q.price}`;
}

export class InMemoryDepthBook {
  private bids = new Map<string, DepthLevel>();
  private asks = new Map<string, DepthLevel>();
  private lastUpdateMs: number | null = null;
  private windowMs = 1000;
  private addedBid = 0;
  private addedAsk = 0;
  private removedBid = 0;
  private removedAsk = 0;
  private rateWindowStart = 0;

  constructor(opts?: { rateWindowMs?: number }) {
    this.windowMs = opts?.rateWindowMs ?? 1000;
  }

  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.lastUpdateMs = null;
    this.resetRates(0);
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
      if ("price" in d && typeof (d as GhFastDepthQuote).price === "number") {
        const q = d as GhFastDepthQuote;
        const side = sideOf(q);
        if (!side) continue;
        const id = levelId(q, side);
        const map = side === "BID" ? this.bids : this.asks;
        const prev = map.get(id);
        if (prev) {
          map.delete(id);
          if (side === "BID") this.removedBid += prev.size;
          else this.removedAsk += prev.size;
        }
      } else if ("id" in d && d.id != null) {
        const id = String(d.id);
        const b = this.bids.get(id);
        const a = this.asks.get(id);
        if (b) {
          this.bids.delete(id);
          this.removedBid += b.size;
        }
        if (a) {
          this.asks.delete(id);
          this.removedAsk += a.size;
        }
      }
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
    const elapsed = Math.max(1, this.windowMs);
    return {
      available,
      topBidDepth: bids[0]?.size ?? 0,
      topAskDepth: asks[0]?.size ?? 0,
      bidDepthN,
      askDepthN,
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
      lastUpdateMs: this.lastUpdateMs
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
