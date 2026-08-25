/**
 * Shared live XAUUSD quote helpers for the dashboard shell.
 * Display uses mid; AutoTrade execution uses bid/ask on the backend.
 */

export type QuoteFreshness =
  | "LIVE"
  | "DELAYED"
  | "STALE"
  | "MARKET_CLOSED"
  | "UNAVAILABLE";

export type LiveQuotePayload = {
  symbolId: string;
  symbolName: string;
  digits: number | null;
  pipPosition: number | null;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  brokerTimestamp: string;
  receivedAt: string;
  quoteSequence: number;
  freshness: QuoteFreshness;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  ageMs: number;
  executable: boolean;
  environment: "DEMO" | "LIVE";
};

export const LIVE_QUOTE_POLL_MS = 1_000;
/** Throttle React display updates when quote activity is high. */
export const LIVE_QUOTE_DISPLAY_THROTTLE_MS = 300;
/** Always flush immediately when mid moves by at least this (USD). */
export const LIVE_QUOTE_MATERIAL_CHANGE = 0.05;

export function computeMid(bid: number, ask: number): number {
  return Number(((bid + ask) / 2).toFixed(6));
}

export function freshnessStatusLabel(freshness: QuoteFreshness | undefined): string {
  switch (freshness) {
    case "LIVE":
      return "Live";
    case "DELAYED":
      return "Delayed";
    case "STALE":
      return "Stale";
    case "MARKET_CLOSED":
      return "Market closed";
    case "UNAVAILABLE":
      return "Unavailable";
    default:
      return "—";
  }
}

export function isFreshDot(freshness: QuoteFreshness | undefined): boolean {
  return freshness === "LIVE";
}

export function isDelayedDot(freshness: QuoteFreshness | undefined): boolean {
  return freshness === "DELAYED";
}

export function shouldFlushQuoteDisplay(args: {
  previousMid: number | null;
  nextMid: number;
  lastFlushAt: number;
  nowMs: number;
  throttleMs?: number;
  materialChange?: number;
}): boolean {
  const throttle = args.throttleMs ?? LIVE_QUOTE_DISPLAY_THROTTLE_MS;
  const material = args.materialChange ?? LIVE_QUOTE_MATERIAL_CHANGE;
  if (args.previousMid == null) return true;
  if (Math.abs(args.nextMid - args.previousMid) >= material) return true;
  return args.nowMs - args.lastFlushAt >= throttle;
}
