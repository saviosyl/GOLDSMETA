export type MicroReadOnlyCapability =
  | "M1_TRENDBARS"
  | "M5_TRENDBARS"
  | "M15_TRENDBARS"
  | "BID_ASK_SPOT"
  | "HISTORICAL_TICKS"
  | "DEPTH_OF_MARKET"
  | "LIVE_TRENDBAR_SUB";

export type MicroCollectorMode = "POLLED_BARS" | "STREAMING_FEATURE_GATED";
