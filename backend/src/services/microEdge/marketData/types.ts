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
 * V1 does NOT claim live cTrader OpenAPI ingestion.
 */
export type MicroMarketDataConnectionState =
  | "INTERFACE_READY"
  | "MOCK_SEEDED"
  | "LIVE_NOT_CONNECTED"
  | "FEATURE_GATED";

export type MicroCollectorMode = "POLLED_BARS" | "STREAMING_FEATURE_GATED";
