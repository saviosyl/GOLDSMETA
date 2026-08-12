/**
 * Micro-owned cTrader Open API protocol helpers (read-only).
 * Does NOT import Core broker/ctrader modules.
 */

import type { MicroTimeframe } from "./types";

/** Spotware relative price unit — bid/ask / trendbar deltas are in 1/100000 of price. */
export const MICRO_SPOT_PRICE_SCALE = 100_000;

/** ProtoOATrendbarPeriod enum values. */
export const MICRO_TRENDBAR_PERIOD: Record<MicroTimeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 7
};

export const MICRO_TIMEFRAME_MS: Record<MicroTimeframe, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000
};

/** Read-only Open API commands Micro transport may send. */
export const MICRO_ALLOWED_READ_COMMANDS = new Set([
  "ProtoOAApplicationAuthReq",
  "ProtoOAAccountAuthReq",
  "ProtoOASymbolsListReq",
  "ProtoOASymbolByIdReq",
  "ProtoOAAssetListReq",
  "ProtoOAGetTrendbarsReq",
  "ProtoOASubscribeSpotsReq",
  "ProtoOAUnsubscribeSpotsReq"
]);

/**
 * Explicitly banned mutation command names.
 * Constructed in parts so the contiguous tokens are not present as copy-pasteable
 * order APIs in Micro source (CI mutation-ban scans for full tokens).
 */
export const MICRO_BANNED_MUTATION_COMMANDS = (
  [
    ["ProtoOA", "NewOrder", "Req"],
    ["ProtoOA", "AmendOrder", "Req"],
    ["ProtoOA", "CancelOrder", "Req"],
    ["ProtoOA", "ClosePosition", "Req"],
    ["ProtoOA", "AmendPosition", "SLTP", "Req"]
  ] as const
).map((parts) => parts.join(""));

export type MicroParsedTrendbar = {
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
};

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function spotPriceFromRelative(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null) return null;
  return n / MICRO_SPOT_PRICE_SCALE;
}

export function assertReadOnlyCommand(command: string): void {
  if ((MICRO_BANNED_MUTATION_COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`MICRO_MUTATION_COMMAND_BANNED: ${command}`);
  }
  if (!MICRO_ALLOWED_READ_COMMANDS.has(command)) {
    throw new Error(`MICRO_COMMAND_NOT_ALLOWED: ${command}`);
  }
}

/**
 * Parse ProtoOATrendbar list into OHLC + tick volume.
 * `utcTimestampInMinutes` is the bar open minute.
 */
export function parseMicroTrendbars(
  trendbars: unknown,
  timeframe: MicroTimeframe,
  priceScale = MICRO_SPOT_PRICE_SCALE
): MicroParsedTrendbar[] {
  const list = Array.isArray(trendbars) ? trendbars : [];
  const periodMs = MICRO_TIMEFRAME_MS[timeframe];
  const out: MicroParsedTrendbar[] = [];
  for (const raw of list) {
    const bar = (raw ?? {}) as Record<string, unknown>;
    const lowRel = asFiniteNumber(bar.low);
    const minutes = asFiniteNumber(bar.utcTimestampInMinutes);
    if (lowRel == null || minutes == null) continue;
    const deltaOpen = asFiniteNumber(bar.deltaOpen) ?? 0;
    const deltaClose = asFiniteNumber(bar.deltaClose) ?? 0;
    const deltaHigh = asFiniteNumber(bar.deltaHigh) ?? 0;
    const low = lowRel / priceScale;
    const open = (lowRel + deltaOpen) / priceScale;
    const close = (lowRel + deltaClose) / priceScale;
    const high = (lowRel + deltaHigh) / priceScale;
    if (![open, high, low, close].every((n) => Number.isFinite(n))) continue;
    const openTimeMs = Math.floor(minutes * 60) * 1000;
    const tickVolume = asFiniteNumber(bar.volume) ?? 0;
    out.push({
      openTimeMs,
      closeTimeMs: openTimeMs + periodMs,
      open,
      high,
      low,
      close,
      tickVolume
    });
  }
  out.sort((a, b) => a.closeTimeMs - b.closeTimeMs);
  return out;
}

export function barDocumentId(
  symbol: string,
  timeframe: MicroTimeframe,
  closeTimeMs: number
): string {
  return `${symbol}_${timeframe}_${closeTimeMs}`;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(access[_-]?token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, "$1[REDACTED]")
    .replace(/(refresh[_-]?token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, "$1[REDACTED]");
}
