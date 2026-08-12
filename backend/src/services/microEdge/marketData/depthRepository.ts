import type { MicroDepthSnapshot } from "../types";
import type { MicroCTraderReadOnlyClient } from "./microCTraderClient";

export async function loadDepth(
  client: MicroCTraderReadOnlyClient
): Promise<MicroDepthSnapshot> {
  return client.getDepthSnapshot();
}

export function depthImbalance(depth: MicroDepthSnapshot, topN: number): number | null {
  if (!depth.available) return null;
  const bidDepth = depth.bids.slice(0, topN).reduce((s, l) => s + l.size, 0);
  const askDepth = depth.asks.slice(0, topN).reduce((s, l) => s + l.size, 0);
  const den = bidDepth + askDepth;
  if (den <= 0) return null;
  return (bidDepth - askDepth) / den;
}

export function microprice(depth: MicroDepthSnapshot): number | null {
  const bid = depth.bids[0];
  const ask = depth.asks[0];
  if (!bid || !ask || bid.size <= 0 || ask.size <= 0) return null;
  return (ask.price * bid.size + bid.price * ask.size) / (bid.size + ask.size);
}
