export type MicroReadOnlyCapability =
  | "M1_TRENDBARS"
  | "M5_TRENDBARS"
  | "M15_TRENDBARS"
  | "BID_ASK_SPOT"
  | "HISTORICAL_TICKS"
  | "DEPTH_OF_MARKET"
  | "LIVE_TRENDBAR_SUB";

/**
 * Honest connection / capability states for the Micro read-only adapter.
 */
export type MicroMarketDataConnectionState =
  | "INTERFACE_READY"
  | "MOCK_SEEDED"
  | "LIVE_CONNECTED"
  | "LIVE_NOT_CONNECTED"
  | "FEATURE_GATED";

export type MicroCollectorMode = "POLLED_BARS" | "STREAMING_FEATURE_GATED" | "LIVE_OPENAPI";

export type MicroTimeframe = "M1" | "M5" | "M15";

export type MicroBarSource = "CTRADER_OPEN_API" | "MOCK_SEEDED";

export type MicroRawBarRecord = {
  id: string;
  symbol: string;
  symbolId: string;
  timeframe: MicroTimeframe;
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** cTrader tick volume — not exchange traded volume. */
  tickVolume: number;
  source: MicroBarSource;
  environment: "DEMO" | "LIVE";
  collectedAt: string;
};

export type MicroRawQuoteRecord = {
  id: string;
  symbol: string;
  symbolId: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  brokerTimestamp: string;
  receivedAt: string;
  ageMs: number;
  freshness: string;
  source: MicroBarSource;
  environment: "DEMO" | "LIVE";
};

export type MicroSymbolMetadata = {
  symbol: string;
  symbolId: string;
  symbolName: string;
  digits: number | null;
  pipPosition: number | null;
  environment: "DEMO" | "LIVE";
  resolvedAt: string;
};

export type MicroBackfillCheckpoint = {
  timeframe: MicroTimeframe;
  cursorFromMs: number;
  cursorToMs: number;
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED";
  inserted: number;
  skipped: number;
  conflicts: number;
  failed: number;
  lastErrorCode: string | null;
  updatedAt: string;
};

export type MicroMarketDataHealthReason =
  | "oauth_missing"
  | "oauth_expired"
  | "account_not_authorized"
  | "xauusd_not_found"
  | "quote_missing"
  | "quote_stale"
  | "quote_invalid"
  | "m1_missing"
  | "m1_stale"
  | "transport_disconnected"
  | "collector_heartbeat_stale"
  | "rate_limited"
  | "market_feed_not_connected"
  | "missing_bid_ask_quote"
  | "invalid_bid_ask"
  | "quote_timestamp_unparseable"
  | "missing_completed_m1"
  | "m1_timestamp_invalid";
