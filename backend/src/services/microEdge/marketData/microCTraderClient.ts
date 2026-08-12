/**
 * Micro Edge read-only cTrader adapter.
 *
 * SHADOW ONLY — no order / amend / close / preview methods exist.
 * Does NOT import the Core mixed cTrader client module.
 *
 * V1 default mode uses polled/historical trendbars + Bid/Ask spot reads.
 * Continuous DOM/tick streaming is feature-gated until a dedicated
 * persistent Micro collector deployment is available.
 */

import type { MicroBar, MicroDepthSnapshot, MicroQuote } from "../types";
import type { MicroCollectorMode, MicroReadOnlyCapability } from "./types";

export type MicroCTraderClientConfig = {
  /** When true, continuous DOM/tick streaming APIs are enabled (still read-only). */
  streamingEnabled?: boolean;
};

export class MicroCTraderReadOnlyClient {
  readonly mode: MicroCollectorMode;
  private readonly bars = new Map<string, MicroBar[]>();
  private quote: MicroQuote | null = null;
  private depth: MicroDepthSnapshot = {
    at: new Date(0).toISOString(),
    bids: [],
    asks: [],
    available: false
  };

  constructor(private readonly cfg: MicroCTraderClientConfig = {}) {
    this.mode = cfg.streamingEnabled ? "STREAMING_FEATURE_GATED" : "POLLED_BARS";
  }

  capabilities(): MicroReadOnlyCapability[] {
    const base: MicroReadOnlyCapability[] = [
      "M1_TRENDBARS",
      "M5_TRENDBARS",
      "M15_TRENDBARS",
      "BID_ASK_SPOT"
    ];
    if (this.cfg.streamingEnabled) {
      base.push("HISTORICAL_TICKS", "DEPTH_OF_MARKET", "LIVE_TRENDBAR_SUB");
    }
    return base;
  }

  /** Inject historical/polled bars for tests and offline collection. */
  seedBars(tf: "M1" | "M5" | "M15", bars: MicroBar[]): void {
    this.bars.set(tf, [...bars].sort((a, b) => a.closeTimeMs - b.closeTimeMs));
  }

  seedQuote(quote: MicroQuote): void {
    this.quote = quote;
  }

  seedDepth(depth: MicroDepthSnapshot): void {
    this.depth = depth;
  }

  async getTrendbars(tf: "M1" | "M5" | "M15", limit = 500): Promise<MicroBar[]> {
    const all = this.bars.get(tf) ?? [];
    return all.slice(Math.max(0, all.length - limit));
  }

  async getSpotQuote(): Promise<MicroQuote | null> {
    return this.quote;
  }

  async getDepthSnapshot(): Promise<MicroDepthSnapshot> {
    if (!this.cfg.streamingEnabled) {
      return { ...this.depth, available: false };
    }
    return this.depth;
  }

  /**
   * Intentionally absent mutation surface — compile-time / API absence is the control.
   * There is no createOrder / amend / close / preview method on this class.
   */
  get mutationSurface(): "NONE" {
    return "NONE";
  }
}
