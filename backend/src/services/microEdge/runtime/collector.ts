/**
 * Micro market-data collector abstraction.
 *
 * Prefer a separate persistent worker (not Core persistentQuoteWorker).
 * V1 default: polled completed M1/M5/M15 + Bid/Ask spot.
 * Continuous DOM/tick streaming is feature-gated until dedicated deployment exists.
 */
import type { MicroCTraderReadOnlyClient } from "../marketData/microCTraderClient";

export type MicroCollectorStatus = {
  mode: "POLLED_BARS" | "STREAMING_FEATURE_GATED";
  lastQuoteTs: string | null;
  lastM1CloseTs: string | null;
  domAvailable: boolean;
  tickStreamAvailable: boolean;
  healthy: boolean;
};

export function getCollectorStatus(
  client: MicroCTraderReadOnlyClient,
  meta: { lastQuoteTs: string | null; lastM1CloseTs: string | null }
): MicroCollectorStatus {
  return {
    mode: client.mode,
    lastQuoteTs: meta.lastQuoteTs,
    lastM1CloseTs: meta.lastM1CloseTs,
    domAvailable: client.capabilities().includes("DEPTH_OF_MARKET"),
    tickStreamAvailable: client.capabilities().includes("HISTORICAL_TICKS"),
    healthy: true
  };
}
