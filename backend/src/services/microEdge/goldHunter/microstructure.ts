import type { GhMicrostructureInterval } from "./types";

export function emptyMicrostructure(): GhMicrostructureInterval {
  return {
    spotEventCount: 0,
    bidUpdateCount: 0,
    askUpdateCount: 0,
    bidPriceChangeCount: 0,
    askPriceChangeCount: 0,
    upTickCount: 0,
    downTickCount: 0
  };
}

/**
 * Local counters from streamed spot events between evaluations.
 * No broker requests.
 */
export class GhMicrostructureTracker {
  private current = emptyMicrostructure();
  private lastBid: number | null = null;
  private lastAsk: number | null = null;
  private lastMid: number | null = null;

  onSpotEvent(args: { bid?: number | null; ask?: number | null }): void {
    this.current.spotEventCount += 1;
    if (args.bid != null && Number.isFinite(args.bid)) {
      this.current.bidUpdateCount += 1;
      if (this.lastBid != null && args.bid !== this.lastBid) {
        this.current.bidPriceChangeCount += 1;
      }
      this.lastBid = args.bid;
    }
    if (args.ask != null && Number.isFinite(args.ask)) {
      this.current.askUpdateCount += 1;
      if (this.lastAsk != null && args.ask !== this.lastAsk) {
        this.current.askPriceChangeCount += 1;
      }
      this.lastAsk = args.ask;
    }
    if (this.lastBid != null && this.lastAsk != null) {
      const mid = (this.lastBid + this.lastAsk) / 2;
      if (this.lastMid != null) {
        if (mid > this.lastMid) this.current.upTickCount += 1;
        else if (mid < this.lastMid) this.current.downTickCount += 1;
      }
      this.lastMid = mid;
    }
  }

  /** Snapshot and reset interval counters for the next evaluation second. */
  snapshotAndReset(): GhMicrostructureInterval {
    const snap = { ...this.current };
    this.current = emptyMicrostructure();
    return snap;
  }

  peek(): GhMicrostructureInterval {
    return { ...this.current };
  }
}
