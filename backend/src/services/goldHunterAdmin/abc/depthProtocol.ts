/**
 * Official ProtoOADepthQuote / ProtoOADepthEvent parsing.
 *
 * Real Open API shape (ctrader-layer / Spotware):
 *   newQuotes[]: { id, size, bid? } OR { id, size, ask? }
 *   deletedQuotes[]: uint64 quote IDs (numbers), NOT objects
 *
 * Prices are relative (÷ 100000). Depth size is ÷ 100 → sizeUnits.
 * Never invent side. Never default unknown → BID.
 */
import {
  asFiniteNumber,
  spotPriceFromRelative
} from "../../microEdge/marketData/microCTraderProtocol";
import type { GhFastDepthQuote } from "./types";

/** Official Open API depth size scale → volume units. */
export const MICRO_DEPTH_SIZE_SCALE = 100;

export type ParsedProtoOADepthQuote = {
  id: string;
  type: "BID" | "ASK";
  price: number;
  size: number;
  rawSize: number;
};

export type DepthParseStats = {
  decodedBid: number;
  decodedAsk: number;
  invalid: number;
  deletedIds: number;
};

export function normalizeQuoteId(id: unknown): string | null {
  if (typeof id === "bigint") return id.toString();
  if (typeof id === "number" && Number.isFinite(id)) return String(Math.trunc(id));
  if (typeof id === "string" && id.trim() !== "") return id.trim();
  return null;
}

function sizeUnitsFromRaw(raw: unknown): number | null {
  const n = asFiniteNumber(raw);
  if (n == null || n < 0) return null;
  return n / MICRO_DEPTH_SIZE_SCALE;
}

/**
 * Parse one official ProtoOADepthQuote.
 * Rejects malformed quotes (neither valid bid nor ask; or both).
 */
export function parseProtoOADepthQuote(
  raw: unknown
): ParsedProtoOADepthQuote | null {
  if (raw == null || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const id = normalizeQuoteId(q.id);
  if (id == null) return null;

  const hasBid = q.bid != null && q.bid !== "";
  const hasAsk = q.ask != null && q.ask !== "";
  if (hasBid === hasAsk) {
    // neither or both → reject (do not invent direction)
    return null;
  }

  const side: "BID" | "ASK" = hasBid ? "BID" : "ASK";
  const price = spotPriceFromRelative(hasBid ? q.bid : q.ask);
  if (price == null || !(price > 0)) return null;

  const size = sizeUnitsFromRaw(q.size);
  if (size == null) return null;

  return {
    id,
    type: side,
    price,
    size,
    rawSize: asFiniteNumber(q.size) ?? 0
  };
}

/**
 * Internal normalized replay format: { id?, type: BID|ASK|1|2, price, size }
 * price/size already in absolute units (not relative).
 */
export function parseNormalizedDepthQuote(
  raw: unknown
): ParsedProtoOADepthQuote | null {
  if (raw == null || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  // Official fields take precedence — never treat bid/ask as normalized.
  if (q.bid != null || q.ask != null) return parseProtoOADepthQuote(raw);

  const typeRaw = q.type;
  let type: "BID" | "ASK" | null = null;
  if (typeRaw === "BID" || typeRaw === 1) type = "BID";
  else if (typeRaw === "ASK" || typeRaw === 2) type = "ASK";
  if (!type) return null;

  const price = asFiniteNumber(q.price);
  const size = asFiniteNumber(q.size);
  if (price == null || !(price > 0) || size == null || size < 0) return null;
  const id = normalizeQuoteId(q.id) ?? `${type}:${price}`;
  return { id, type, price, size, rawSize: size };
}

/** Prefer official ProtoOA shape; fall back to normalized replay shape. */
export function parseDepthQuoteFlexible(
  raw: unknown
): ParsedProtoOADepthQuote | null {
  if (raw == null || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  if (q.bid != null || q.ask != null) return parseProtoOADepthQuote(raw);
  return parseNormalizedDepthQuote(raw);
}

/**
 * Normalize deletedQuotes: uint64 IDs, strings, or { id }.
 * Never uses `in` on primitives.
 */
export function parseProtoOADeletedQuotes(
  raw: unknown
): Array<{ id: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string }> = [];
  for (const item of raw) {
    if (typeof item === "number" || typeof item === "string" || typeof item === "bigint") {
      const id = normalizeQuoteId(item);
      if (id != null) out.push({ id });
      continue;
    }
    if (item != null && typeof item === "object") {
      const id = normalizeQuoteId((item as { id?: unknown }).id);
      if (id != null) out.push({ id });
    }
  }
  return out;
}

export function parseProtoOADepthEventPayload(payload: Record<string, unknown>): {
  newQuotes: GhFastDepthQuote[];
  deletedQuotes: Array<{ id: string }>;
  stats: DepthParseStats;
} {
  const stats: DepthParseStats = {
    decodedBid: 0,
    decodedAsk: 0,
    invalid: 0,
    deletedIds: 0
  };
  const newQuotes: GhFastDepthQuote[] = [];
  const list = Array.isArray(payload.newQuotes) ? payload.newQuotes : [];
  for (const raw of list) {
    const parsed = parseDepthQuoteFlexible(raw);
    if (!parsed) {
      stats.invalid += 1;
      continue;
    }
    if (parsed.type === "BID") stats.decodedBid += 1;
    else stats.decodedAsk += 1;
    newQuotes.push({
      id: parsed.id,
      type: parsed.type,
      price: parsed.price,
      size: parsed.size
    });
  }
  const deletedQuotes = parseProtoOADeletedQuotes(payload.deletedQuotes);
  stats.deletedIds = deletedQuotes.length;
  return { newQuotes, deletedQuotes, stats };
}

export function toGhFastDepthQuotes(
  parsed: ParsedProtoOADepthQuote[]
): GhFastDepthQuote[] {
  return parsed.map((p) => ({
    id: p.id,
    type: p.type,
    price: p.price,
    size: p.size
  }));
}
