/**
 * Micro Edge read-only cTrader high-level client.
 *
 * SHADOW ONLY — no order / amend / close / preview methods exist.
 * Does NOT import the Core mixed cTrader client module.
 *
 * Modes:
 * - MOCK_SEEDED: deterministic in-memory seed (tests)
 * - LIVE_CONNECTED / LIVE_NOT_CONNECTED: via MicroLiveMarketSession + OpenAPI transport
 * - FEATURE_GATED: historical ticks / DOM / live trendbar subs
 */

import type { MicroBar, MicroDepthSnapshot, MicroQuote } from "../types";
import type { MicroLiveMarketSession } from "./liveSession";
import type {
  MicroCollectorMode,
  MicroMarketDataConnectionState,
  MicroReadOnlyCapability,
  MicroTimeframe
} from "./types";

export type MicroCTraderClientConfig = {
  /** When true, continuous DOM/tick streaming APIs are enabled (still read-only). */
  streamingEnabled?: boolean;
  /** Optional live session — never silently falls back to mock when live is requested. */
  liveSession?: MicroLiveMarketSession | null;
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
  private liveSession: MicroLiveMarketSession | null;

  constructor(private readonly cfg: MicroCTraderClientConfig = {}) {
    this.liveSession = cfg.liveSession ?? null;
    this.mode = this.liveSession
      ? "LIVE_OPENAPI"
      : cfg.streamingEnabled
        ? "STREAMING_FEATURE_GATED"
        : "POLLED_BARS";
  }

  attachLiveSession(session: MicroLiveMarketSession | null): void {
    this.liveSession = session;
  }

  /** Scaffold / live methods exist; not the same as a live feed. */
  isInterfaceReady(): boolean {
    return true;
  }

  connectionState(): MicroMarketDataConnectionState {
    if (this.liveSession) {
      return this.liveSession.isLiveConnected()
        ? "LIVE_CONNECTED"
        : "LIVE_NOT_CONNECTED";
    }
    if (this.seeded || this.bars.size > 0 || this.quote) return "MOCK_SEEDED";
    return "LIVE_NOT_CONNECTED";
  }

  isLiveMarketFeedConnected(): boolean {
    return this.liveSession?.isLiveConnected() === true;
  }

  marketFeedStatusMessage(): string {
    if (this.isLiveMarketFeedConnected()) return "Market feed connected";
    return "Market feed not connected";
  }

  capabilities(): MicroReadOnlyCapability[] {
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
    const live = this.connectionState();
    const barState =
      live === "LIVE_CONNECTED"
        ? "LIVE_CONNECTED"
        : live === "MOCK_SEEDED"
          ? "MOCK_SEEDED"
          : "LIVE_NOT_CONNECTED";
    return {
      M1_TRENDBARS: barState,
      M5_TRENDBARS: barState,
      M15_TRENDBARS: barState,
      BID_ASK_SPOT: barState,
      HISTORICAL_TICKS: "FEATURE_GATED",
      DEPTH_OF_MARKET: "FEATURE_GATED",
      LIVE_TRENDBAR_SUB: "FEATURE_GATED"
    };
  }

  /** Inject historical/polled bars for tests — NOT live feed. */
  seedBars(tf: MicroTimeframe, bars: MicroBar[]): void {
    if (this.liveSession) {
      throw new Error("MICRO_MOCK_SEED_FORBIDDEN_WHILE_LIVE");
    }
    this.seeded = true;
    this.bars.set(tf, [...bars].sort((a, b) => a.closeTimeMs - b.closeTimeMs));
  }

  seedQuote(quote: MicroQuote): void {
    if (this.liveSession) {
      throw new Error("MICRO_MOCK_SEED_FORBIDDEN_WHILE_LIVE");
    }
    this.seeded = true;
    this.quote = quote;
  }

  seedDepth(depth: MicroDepthSnapshot): void {
    if (this.liveSession) {
      throw new Error("MICRO_MOCK_SEED_FORBIDDEN_WHILE_LIVE");
    }
    this.seeded = true;
    this.depth = depth;
  }

  async getTrendbars(tf: MicroTimeframe, limit = 500): Promise<MicroBar[]> {
    if (this.liveSession) {
      // Live path reads from session store via poll; client cache filled by collector.
      const all = this.bars.get(tf) ?? [];
      return all.slice(Math.max(0, all.length - limit));
    }
    const all = this.bars.get(tf) ?? [];
    return all.slice(Math.max(0, all.length - limit));
  }

  /** Allow live collector to publish completed bars into the client cache. */
  publishLiveBars(tf: MicroTimeframe, bars: MicroBar[]): void {
    this.bars.set(tf, [...bars].sort((a, b) => a.closeTimeMs - b.closeTimeMs));
  }

  publishLiveQuote(quote: MicroQuote): void {
    this.quote = quote;
  }

  async getSpotQuote(): Promise<MicroQuote | null> {
    if (this.liveSession) {
      const state = await this.liveSession.getState();
      return state.lastQuote;
    }
    return this.quote;
  }

  async getDepthSnapshot(): Promise<MicroDepthSnapshot> {
    return { ...this.depth, available: false };
  }

  get mutationSurface(): "NONE" {
    return "NONE";
  }
}
