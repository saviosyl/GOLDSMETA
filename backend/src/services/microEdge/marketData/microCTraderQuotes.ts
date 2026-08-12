import type { MicroQuote } from "../types";
import type { MicroOpenApiTransport } from "./microCTraderTransport";
import { asFiniteNumber, spotPriceFromRelative } from "./microCTraderProtocol";
import { buildQuote } from "./quoteRepository";

export type ValidatedSpot = {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  brokerTimestampMs: number;
  symbolId: string;
};

export function validateSpotPayload(
  payload: Record<string, unknown>,
  expectedSymbolId?: string
): ValidatedSpot | { error: string } {
  const symbolIdNum = asFiniteNumber(payload.symbolId);
  if (
    expectedSymbolId &&
    symbolIdNum != null &&
    String(symbolIdNum) !== String(expectedSymbolId)
  ) {
    return { error: "symbol_mismatch" };
  }
  const bid = spotPriceFromRelative(payload.bid);
  const ask = spotPriceFromRelative(payload.ask);
  if (bid == null || ask == null) return { error: "quote_missing" };
  if (!(bid > 0) || !(ask > 0)) return { error: "quote_invalid" };
  if (!(ask >= bid)) return { error: "quote_invalid" };
  const ts = asFiniteNumber(payload.timestamp) ?? Date.now();
  return {
    bid,
    ask,
    mid: (bid + ask) / 2,
    spread: ask - bid,
    brokerTimestampMs: ts,
    symbolId: symbolIdNum != null ? String(symbolIdNum) : expectedSymbolId ?? ""
  };
}

export async function fetchOneShotQuote(args: {
  transport: MicroOpenApiTransport;
  symbolId: string;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<MicroQuote> {
  const timeoutMs = args.timeoutMs ?? 8_000;
  const nowMs = args.nowMs ?? Date.now();
  const spot = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error("MICRO_QUOTE_TIMEOUT"), { code: "quote_missing" })),
      timeoutMs
    );
    const handler = (_name: string, payload: Record<string, unknown>) => {
      const v = validateSpotPayload(payload, args.symbolId);
      if ("error" in v) return;
      clearTimeout(timer);
      args.transport.off("ProtoOASpotEvent", handler);
      resolve(payload);
    };
    args.transport.on("ProtoOASpotEvent", handler);
    void args.transport.subscribeSpots(args.symbolId).catch((e: unknown) => {
      clearTimeout(timer);
      args.transport.off("ProtoOASpotEvent", handler);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
  const v = validateSpotPayload(spot, args.symbolId);
  if ("error" in v) {
    throw Object.assign(new Error("MICRO_QUOTE_INVALID"), { code: v.error });
  }
  return buildQuote({
    bid: v.bid,
    ask: v.ask,
    brokerTimestamp: new Date(v.brokerTimestampMs).toISOString(),
    nowMs,
    freshness: "LIVE"
  });
}
