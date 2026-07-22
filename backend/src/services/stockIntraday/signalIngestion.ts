/**
 * TradingView stock-signal ingestion (separate from Gold CFD webhook decisions).
 * Webhook returns fast ACK; processing is queued asynchronously.
 * Never accepts broker credentials or calls broker adapters directly.
 */

import { z } from "zod";
import { nowIso } from "../../utils/time";
import type { StockTradingViewSignal } from "./types";
import { redactSecrets } from "./redact";

const stockSignalSchema = z
  .object({
    alertId: z.string().min(4).max(128),
    strategyId: z.string().min(1).max(128),
    symbol: z.string().min(1).max(32),
    exchange: z.string().max(32).nullable().optional(),
    timeframe: z.string().min(1).max(16),
    action: z.enum(["ENTRY_LONG", "EXIT_LONG", "REDUCE", "MOVE_STOP", "CANCEL", "WAIT"]),
    price: z.number().positive().nullable().optional(),
    timestamp: z.string().min(4),
    barTime: z.string().nullable().optional(),
    barClosed: z.boolean().optional(),
    volume: z.number().nullable().optional(),
    ema21: z.number().nullable().optional(),
    ema50: z.number().nullable().optional(),
    ema200: z.number().nullable().optional(),
    vwap: z.number().nullable().optional(),
    rsi: z.number().nullable().optional(),
    atr: z.number().nullable().optional(),
    relativeVolume: z.number().nullable().optional(),
    support: z.number().nullable().optional(),
    resistance: z.number().nullable().optional(),
    marketTrend: z.string().nullable().optional(),
    confidence: z.number().min(0).max(100).nullable().optional(),
    reasonCodes: z.array(z.string()).optional(),
    /** Explicitly rejected if present */
    apiKey: z.never().optional(),
    apiSecret: z.never().optional(),
    password: z.never().optional()
  })
  .strict();

export type StockSignalParseResult =
  | { ok: true; signal: StockTradingViewSignal }
  | { ok: false; code: string; message: string };

export function parseStockTradingViewSignal(body: unknown): StockSignalParseResult {
  const parsed = stockSignalSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, code: "MALFORMED_PAYLOAD", message: "Invalid stock signal payload" };
  }
  const data = parsed.data;
  const signal: StockTradingViewSignal = {
    alertId: data.alertId,
    strategyId: data.strategyId,
    symbol: data.symbol.toUpperCase(),
    exchange: data.exchange ?? null,
    timeframe: data.timeframe,
    action: data.action,
    price: data.price ?? null,
    timestamp: data.timestamp,
    barTime: data.barTime ?? null,
    barClosed: data.barClosed ?? true,
    volume: data.volume ?? null,
    ema21: data.ema21 ?? null,
    ema50: data.ema50 ?? null,
    ema200: data.ema200 ?? null,
    vwap: data.vwap ?? null,
    rsi: data.rsi ?? null,
    atr: data.atr ?? null,
    relativeVolume: data.relativeVolume ?? null,
    support: data.support ?? null,
    resistance: data.resistance ?? null,
    marketTrend: data.marketTrend ?? null,
    confidence: data.confidence ?? null,
    reasonCodes: data.reasonCodes ?? [],
    receivedAt: nowIso()
  };
  return { ok: true, signal: redactSecrets(signal) };
}

export function isStaleSignal(
  signal: StockTradingViewSignal,
  maxAgeMs: number,
  now = Date.now()
): boolean {
  const ts = Date.parse(signal.timestamp);
  if (!Number.isFinite(ts)) return true;
  return now - ts > maxAgeMs;
}

export function isUnsupportedStrategy(
  strategyId: string,
  allowed: string[]
): boolean {
  if (allowed.length === 0) return false;
  return !allowed.includes(strategyId);
}

export type SignalDeliveryStatus = "RECEIVED" | "REJECTED" | "QUEUED";
export type SignalProcessingStatus =
  | "PENDING"
  | "PROCESSING"
  | "PROCESSED"
  | "FAILED"
  | "DUPLICATE"
  | "STALE"
  | "UNSUPPORTED";
export type SignalDecisionStatus = "PENDING" | "BUY" | "WAIT" | "BLOCKED" | "EXIT" | "IGNORED";

export interface StockSignalRecord {
  id: string;
  userId: string;
  alertId: string;
  deliveryStatus: SignalDeliveryStatus;
  processingStatus: SignalProcessingStatus;
  decisionStatus: SignalDecisionStatus;
  signal: StockTradingViewSignal;
  createdAt: string;
  updatedAt: string;
}
