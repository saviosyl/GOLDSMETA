/**
 * Micro Edge read-only cTrader adapter scaffold.
 *
 * SHADOW ONLY — no order / amend / close / preview methods exist.
 * Does NOT import the Core mixed cTrader client module.
 *
 * V1 truth:
 * - Interface/scaffold = INTERFACE_READY
 * - In-memory seed helpers = MOCK_SEEDED (tests / offline only)
 * - Genuine live OpenAPI ingestion = LIVE_NOT_CONNECTED (not wired)
 * - DOM/tick streaming = FEATURE_GATED until a dedicated Micro collector exists
 *
 * Do NOT claim this class is a live cTrader integration until real reads exist.
 */

import type { MicroBar, MicroDepthSnapshot, MicroQuote } from "../types";
import type {
  MicroCollectorMode,
  MicroMarketDataConnectionState,
  MicroReadOnlyCapability
} from "./types";

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
  private seeded = false;

  constructor(private readonly cfg: MicroCTraderClientConfig = {}) {
    this.mode = cfg.streamingEnabled ? "STREAMING_FEATURE_GATED" : "POLLED_BARS";
  }

  /** Scaffold methods exist; not the same as a live feed. */
  isInterfaceReady(): boolean {
    return true;
  }

  /**
   * Honest connection state. Live OpenAPI is never reported as connected in V1.
   * MOCK_SEEDED = in-memory test/offline injection only.
   */
  connectionState(): MicroMarketDataConnectionState {
    if (this.seeded || this.bars.size > 0 || this.quote) return "MOCK_SEEDED";
    return "LIVE_NOT_CONNECTED";
  }

  /** True only when a genuine live feed is wired (never in V1). */
  isLiveMarketFeedConnected(): boolean {
    return false;
  }

  marketFeedStatusMessage(): string {
    if (this.isLiveMarketFeedConnected()) return "Market feed connected";
    return "Market feed not connected";
  }

  capabilities(): MicroReadOnlyCapability[] {
    // Declared interface surface only — not proof of live connectivity.
    return [
      "M1_TRENDBARS",
      "M5_TRENDBARS",
      "M15_TRENDBARS",
      "BID_ASK_SPOT",
      "HISTORICAL_TICKS",
      "DEPTH_OF_MARKET",
      "LIVE_TRENDBAR_SUB"
    ];
  }

  capabilityStates(): Record<MicroReadOnlyCapability, MicroMarketDataConnectionState> {
    const seeded = this.connectionState() === "MOCK_SEEDED";
    return {
      M1_TRENDBARS: seeded ? "MOCK_SEEDED" : "LIVE_NOT_CONNECTED",
      M5_TRENDBARS: seeded ? "MOCK_SEEDED" : "LIVE_NOT_CONNECTED",
      M15_TRENDBARS: seeded ? "MOCK_SEEDED" : "LIVE_NOT_CONNECTED",
      BID_ASK_SPOT: seeded ? "MOCK_SEEDED" : "LIVE_NOT_CONNECTED",
      // Streaming microstructure remains feature-gated until a Micro collector ships.
      HISTORICAL_TICKS: this.cfg.streamingEnabled ? "FEATURE_GATED" : "FEATURE_GATED",
      DEPTH_OF_MARKET: "FEATURE_GATED",
      LIVE_TRENDBAR_SUB: "FEATURE_GATED"
    };
  }

  /** Inject historical/polled bars for tests and offline collection — NOT live feed. */
  seedBars(tf: "M1" | "M5" | "M15", bars: MicroBar[]): void {
    this.seeded = true;
    this.bars.set(tf, [...bars].sort((a, b) => a.closeTimeMs - b.closeTimeMs));
  }

  seedQuote(quote: MicroQuote): void {
    this.seeded = true;
    this.quote = quote;
  }

  seedDepth(depth: MicroDepthSnapshot): void {
    this.seeded = true;
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
