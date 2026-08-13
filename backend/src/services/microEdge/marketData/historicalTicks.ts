/**
 * Placeholder for historical Bid/Ask tick ingestion.
 * HISTORICAL_TICKS remains FEATURE_GATED in V1.1.
 */
export type MicroHistoricalTick = {
  side: "BID" | "ASK";
  price: number;
  brokerTimestampMs: number;
};

export type MicroHistoricalTickClient = {
  readonly capabilityState: "FEATURE_GATED";
  fetchHistoricalTicks(_args: {
    symbolId: string;
    fromMs: number;
    toMs: number;
  }): Promise<MicroHistoricalTick[]>;
};

export const microHistoricalTicksPlaceholder: MicroHistoricalTickClient = {
  capabilityState: "FEATURE_GATED",
  async fetchHistoricalTicks() {
    throw Object.assign(new Error("MICRO_HISTORICAL_TICKS_FEATURE_GATED"), {
      code: "FEATURE_GATED"
    });
  }
};
