import type { MicroQuote } from "../types";
import type { MicroCTraderReadOnlyClient } from "./microCTraderClient";

export async function loadSpotQuote(
  client: MicroCTraderReadOnlyClient
): Promise<MicroQuote | null> {
  return client.getSpotQuote();
}

export function buildQuote(args: {
  bid: number;
  ask: number;
  brokerTimestamp: string;
  nowMs?: number;
  freshness?: MicroQuote["freshness"];
}): MicroQuote {
  const nowMs = args.nowMs ?? Date.now();
  const mid = (args.bid + args.ask) / 2;
  const spread = args.ask - args.bid;
  const ageMs = Math.max(0, nowMs - new Date(args.brokerTimestamp).getTime());
  return {
    bid: args.bid,
    ask: args.ask,
    mid,
    spread,
    brokerTimestamp: args.brokerTimestamp,
    receivedAt: new Date(nowMs).toISOString(),
    ageMs,
    freshness: args.freshness ?? (ageMs <= 5_000 ? "LIVE" : ageMs <= 30_000 ? "DELAYED" : "STALE")
  };
}
