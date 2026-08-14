/**
 * Shared cTrader market normalization for GOLD_HUNTER FAST.
 * Live-shadow (GoldHunterFastLiveBridge) and research capture MUST use these
 * helpers — never invent a second relative→absolute conversion.
 */
import {
  asFiniteNumber,
  spotPriceFromRelative
} from "../../marketData/microCTraderProtocol";
import { parseProtoOADepthEventPayload } from "./depthProtocol";
import type { GhFastDepthQuote } from "./types";

/** Identity for forensic / replay qualification. */
export const GH_FAST_MARKET_DATA_NORMALIZATION_VERSION =
  "CTRADER_NORMALIZED_V1" as const;

export type GhFastMarketDataNormalizationVersion =
  typeof GH_FAST_MARKET_DATA_NORMALIZATION_VERSION;

export type NormalizedCTraderSpot = {
  bid: number | null;
  ask: number | null;
  spread: number | null;
  bidRelative: number | null;
  askRelative: number | null;
  brokerTimestampMs: number | null;
  symbolId: string | number | undefined;
  normalizationVersion: GhFastMarketDataNormalizationVersion;
  inputNormalizationVerified: true;
};

export type NormalizedCTraderDepth = {
  newQuotes: GhFastDepthQuote[];
  deletedQuotes: Array<{ id: string }>;
  stats: {
    decodedBid: number;
    decodedAsk: number;
    invalid: number;
    deletedIds: number;
  };
  brokerTimestampMs: number | null;
  symbolId: string | number | undefined;
  /** Raw ProtoOA quote objects preserved for forensic replay. */
  rawNewQuotes: unknown[];
  rawDeletedQuotes: unknown;
  normalizationVersion: GhFastMarketDataNormalizationVersion;
  inputNormalizationVerified: true;
};

/**
 * Same Spot semantics as GoldHunterFastLiveBridge.processOrdered.
 */
export function normalizeCTraderSpotPayload(
  payload: Record<string, unknown>
): NormalizedCTraderSpot {
  const bidRelative = asFiniteNumber(payload.bid);
  const askRelative = asFiniteNumber(payload.ask);
  const bid =
    payload.bid != null ? spotPriceFromRelative(payload.bid) : null;
  const ask =
    payload.ask != null ? spotPriceFromRelative(payload.ask) : null;
  const brokerTimestampMs =
    typeof payload.timestamp === "number"
      ? payload.timestamp
      : typeof payload.brokerTimestampMs === "number"
        ? payload.brokerTimestampMs
        : asFiniteNumber(payload.timestamp ?? payload.brokerTimestampMs);
  return {
    bid,
    ask,
    spread: bid != null && ask != null ? ask - bid : null,
    bidRelative,
    askRelative,
    brokerTimestampMs,
    symbolId: payload.symbolId as string | number | undefined,
    normalizationVersion: GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
    inputNormalizationVerified: true
  };
}

/**
 * Same Depth semantics as GoldHunterFastLiveBridge.processOrdered.
 */
export function normalizeCTraderDepthPayload(
  payload: Record<string, unknown>
): NormalizedCTraderDepth {
  const parsed = parseProtoOADepthEventPayload(payload);
  const brokerTimestampMs =
    typeof payload.timestamp === "number"
      ? payload.timestamp
      : typeof payload.brokerTimestampMs === "number"
        ? payload.brokerTimestampMs
        : asFiniteNumber(payload.timestamp ?? payload.brokerTimestampMs);
  return {
    newQuotes: parsed.newQuotes,
    deletedQuotes: parsed.deletedQuotes,
    stats: parsed.stats,
    brokerTimestampMs,
    symbolId: payload.symbolId as string | number | undefined,
    rawNewQuotes: Array.isArray(payload.newQuotes) ? payload.newQuotes : [],
    rawDeletedQuotes: payload.deletedQuotes ?? null,
    normalizationVersion: GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
    inputNormalizationVerified: true
  };
}
