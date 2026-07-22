/**
 * Future streaming market-data interface.
 *
 * This SHADOW pilot intentionally does NOT require a permanently running
 * WebSocket inside short-lived Firebase Cloud Functions. REST snapshots and
 * historical bar requests remain the production path for serverless ticks.
 *
 * A future long-lived worker (Cloud Run / dedicated stream consumer) may
 * implement MarketDataStreamConsumer without changing MarketDataProvider callers.
 */

/* eslint-disable @typescript-eslint/require-await -- interface stub only */

export type StreamFeedId = "iex" | "sip";

export interface MarketDataStreamQuoteEvent {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number;
  asOf: string;
  feed: StreamFeedId;
}

export interface MarketDataStreamConsumer {
  readonly feedId: StreamFeedId;
  /** Subscribe to symbols. Must be idempotent. */
  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  onQuote(handler: (event: MarketDataStreamQuoteEvent) => void): () => void;
  close(): Promise<void>;
}

/**
 * Placeholder — not wired in this delivery.
 * Do not instantiate from Cloud Functions cold starts.
 */
export class UnsupportedAlpacaStreamConsumer implements MarketDataStreamConsumer {
  readonly feedId: StreamFeedId = "iex";

  async subscribe(): Promise<void> {
    throw new Error("ALPACA_STREAM_NOT_ENABLED_IN_SERVERLESS_SHADOW_PILOT");
  }

  async unsubscribe(): Promise<void> {
    throw new Error("ALPACA_STREAM_NOT_ENABLED_IN_SERVERLESS_SHADOW_PILOT");
  }

  onQuote(): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {
    return;
  }
}
