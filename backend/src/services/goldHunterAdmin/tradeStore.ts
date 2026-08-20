/**
 * Gold Hunter Demo trade persistence.
 * Attribution: strategy=GOLD_HUNTER, environment=DEMO only.
 *
 * CLOSED is terminal: no stale writer may regress a persisted CLOSED
 * document to FILLED / PROTECTED / CLOSE_REQUESTED / pending.
 * Firestore writes use a transaction; memory uses the same merge rules.
 */

import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "../firebaseAdmin";
import { isValidGoldHunterEntryPrice } from "./entryValidity";
import {
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "./types";

type StoredGoldHunterTrade = GoldHunterDemoTrade & Record<string, unknown>;

const memoryTrades = new Map<string, Map<string, StoredGoldHunterTrade>>();

/** Test-only Firestore injection (emulator). */
let testDbOverride: Firestore | null = null;

type TradeStoreHooks = {
  /** Fires once per outer upsert, before merge. Used for CLOSED-race tests. */
  beforeCommit?: (incoming: GoldHunterDemoTrade) => Promise<void> | void;
};

let persistHooks: TradeStoreHooks = {};
let persistDepth = 0;

export function setGoldHunterTradeStoreHooksForTests(
  h: TradeStoreHooks
): void {
  persistHooks = h;
}

export function resetGoldHunterTradeStoreHooksForTests(): void {
  persistHooks = {};
  persistDepth = 0;
}

export function setGoldHunterTradeStoreDbForTests(
  db: Firestore | null
): void {
  testDbOverride = db;
}

export function resetGoldHunterTradeMemory(): void {
  memoryTrades.clear();
  persistHooks = {};
  persistDepth = 0;
}

/**
 * Firestore rejects `undefined` field values. Strip them recursively before
 * any trade document write so optional evidence / diagnostic keys cannot
 * abort entry PENDING_RECONCILIATION persistence.
 */
export function stripUndefinedForFirestore<T>(value: T): T {
  if (Array.isArray(value)) {
    const items = value as unknown[];
    return items.map((item) => stripUndefinedForFirestore(item)) as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (nested === undefined) continue;
      out[key] = stripUndefinedForFirestore(nested);
    }
    return out as T;
  }
  return value;
}

function resolveDb(): Firestore | null {
  return testDbOverride ?? getFirestoreDb();
}

function tradesCol(ownerUid: string) {
  const db = resolveDb();
  if (!db) return null;
  return db.collection("users").doc(ownerUid).collection("goldHunterDemoTrades");
}

export function isGoldHunterClosedTerminal(
  trade: Pick<GoldHunterDemoTrade, "status"> | null | undefined
): boolean {
  return trade?.status === "CLOSED";
}

function keepFinite(
  preferred: number | null | undefined,
  fallback: number | null | undefined
): number | null {
  if (preferred != null && Number.isFinite(preferred)) return preferred;
  if (fallback != null && Number.isFinite(fallback)) return fallback;
  return preferred ?? fallback ?? null;
}

function keepText(
  preferred: string | null | undefined,
  fallback: string | null | undefined
): string | null {
  if (preferred != null && String(preferred).trim().length > 0) {
    return preferred;
  }
  if (fallback != null && String(fallback).trim().length > 0) {
    return fallback;
  }
  return preferred ?? fallback ?? null;
}

/**
 * CLOSED enrichment: later writers may add diagnostics but must preserve
 * status, result, entry, exit, closeTs, netP/L, deal id, settlement fields.
 */
export function mergeClosedGoldHunterTrade(
  existing: GoldHunterDemoTrade,
  incoming: GoldHunterDemoTrade
): GoldHunterDemoTrade {
  const next: GoldHunterDemoTrade = {
    ...existing,
    ...incoming,
    status: "CLOSED",
    result: existing.result ?? incoming.result,
    entry: isValidGoldHunterEntryPrice(existing.entry)
      ? existing.entry
      : incoming.entry,
    exit: keepFinite(existing.exit, incoming.exit),
    closeTs: keepText(existing.closeTs, incoming.closeTs),
    netPnlEur: keepFinite(existing.netPnlEur, incoming.netPnlEur),
    grossPnlEur: keepFinite(existing.grossPnlEur, incoming.grossPnlEur),
    brokerDealId: keepText(existing.brokerDealId, incoming.brokerDealId),
    brokerSettlementTs: keepText(
      existing.brokerSettlementTs,
      incoming.brokerSettlementTs
    ),
    closeAcceptedTs: keepText(existing.closeAcceptedTs, incoming.closeAcceptedTs),
    commissionEur: keepFinite(existing.commissionEur, incoming.commissionEur),
    swapEur: keepFinite(existing.swapEur, incoming.swapEur),
    fillTs: keepText(existing.fillTs, incoming.fillTs),
    initialRiskPrice: keepFinite(
      existing.initialRiskPrice,
      incoming.initialRiskPrice
    )
  };
  return next;
}

function applyPersistMerge(
  existing: GoldHunterDemoTrade | null,
  incoming: GoldHunterDemoTrade
): { trade: GoldHunterDemoTrade; rejectedRegression: boolean } {
  if (existing && isGoldHunterClosedTerminal(existing)) {
    if (incoming.status !== "CLOSED") {
      return { trade: existing, rejectedRegression: true };
    }
    return {
      trade: mergeClosedGoldHunterTrade(existing, incoming),
      rejectedRegression: false
    };
  }
  return { trade: incoming, rejectedRegression: false };
}

/**
 * Trades that still occupy the maxOpenTrades slot.
 * ACCEPTED_PENDING_FILL / uncertain PENDING_RECONCILIATION count (fail closed).
 * CLOSE_ACCEPTED_PENDING_SETTLEMENT does not — close already accepted at broker.
 */
export function countsTowardGoldHunterMaxOpen(
  trade: GoldHunterDemoTrade
): boolean {
  if (trade.strategy !== GH_ADMIN_STRATEGY_ID || trade.environment !== "DEMO") {
    return false;
  }
  if (trade.status === "CLOSED") return false;
  if (trade.status === "BROKER_REJECTED" || trade.status === "BROKER_SUBMIT_ERROR") {
    return false;
  }
  if (trade.status === "CLOSE_ACCEPTED_PENDING_SETTLEMENT") return false;
  if (trade.result === "OPEN") return true;
  if (trade.status === "FILLED" || trade.status === "PROTECTED") return true;
  if (trade.status === "ACCEPTED_PENDING_FILL") return true;
  if (trade.status === "PENDING_RECONCILIATION") return true;
  if (trade.status === "CLOSE_REQUESTED") return true;
  if (trade.status === "ORDER_CREATED" || trade.status === "SENT") return true;
  return false;
}

export async function listGoldHunterDemoTrades(
  ownerUid: string,
  opts?: { limit?: number; openOnly?: boolean }
): Promise<GoldHunterDemoTrade[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const col = tradesCol(ownerUid);
  if (!col) {
    const mem = [...(memoryTrades.get(ownerUid)?.values() ?? [])];
    let rows = mem.filter(
      (r) => r.strategy === GH_ADMIN_STRATEGY_ID && r.environment === "DEMO"
    );
    if (opts?.openOnly) {
      rows = rows.filter((r) => countsTowardGoldHunterMaxOpen(r));
    }
    return rows
      .sort((a, b) => (b.orderTs ?? "").localeCompare(a.orderTs ?? ""))
      .slice(0, limit);
  }
  try {
    const snap = await col.orderBy("orderTs", "desc").limit(limit).get();
    let rows = snap.docs.map((d) => d.data() as GoldHunterDemoTrade);
    rows = rows.filter(
      (r) => r.strategy === GH_ADMIN_STRATEGY_ID && r.environment === "DEMO"
    );
    if (opts?.openOnly) {
      rows = rows.filter((r) => countsTowardGoldHunterMaxOpen(r));
    }
    return rows;
  } catch {
    const snap = await col.limit(limit).get();
    let rows = snap.docs
      .map((d) => d.data() as GoldHunterDemoTrade)
      .filter((r) => r.strategy === GH_ADMIN_STRATEGY_ID && r.environment === "DEMO");
    if (opts?.openOnly) {
      rows = rows.filter((r) => countsTowardGoldHunterMaxOpen(r));
    }
    return rows;
  }
}

export async function getGoldHunterDemoTrade(
  ownerUid: string,
  goldHunterTradeId: string
): Promise<GoldHunterDemoTrade | null> {
  const id = String(goldHunterTradeId ?? "").trim();
  if (!id) return null;
  const col = tradesCol(ownerUid);
  if (!col) {
    return memoryTrades.get(ownerUid)?.get(id) ?? null;
  }
  const snap = await col.doc(id).get();
  return snap.exists ? (snap.data() as GoldHunterDemoTrade) : null;
}

export type PersistGoldHunterDemoTradeResult = {
  trade: GoldHunterDemoTrade;
  rejectedRegression: boolean;
};

/**
 * Transaction-safe persist. If the durable row is already CLOSED, incoming
 * writes cannot regress status. A read-then-write outside this function
 * is not sufficient.
 */
export async function upsertGoldHunterDemoTrade(
  ownerUid: string,
  trade: StoredGoldHunterTrade
): Promise<PersistGoldHunterDemoTradeResult> {
  if (trade.strategy !== GH_ADMIN_STRATEGY_ID || trade.environment !== "DEMO") {
    throw new Error("REFUSE: only GOLD_HUNTER DEMO trades may be persisted");
  }
  persistDepth += 1;
  try {
    if (persistDepth === 1 && persistHooks.beforeCommit) {
      await persistHooks.beforeCommit(trade);
    }
    const col = tradesCol(ownerUid);
    if (!col) {
      let map = memoryTrades.get(ownerUid);
      if (!map) {
        map = new Map<string, StoredGoldHunterTrade>();
        memoryTrades.set(ownerUid, map);
      }
      const existing = map.get(trade.goldHunterTradeId) ?? null;
      const merged = applyPersistMerge(existing, trade);
      if (merged.rejectedRegression && existing) {
        return merged;
      }
      map.set(trade.goldHunterTradeId, merged.trade);
      return merged;
    }
    const db = resolveDb()!;
    const ref = col.doc(trade.goldHunterTradeId);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists
        ? (snap.data() as GoldHunterDemoTrade)
        : null;
      const merged = applyPersistMerge(existing, trade);
      if (merged.rejectedRegression && existing) {
        return merged;
      }
      tx.set(ref, stripUndefinedForFirestore(merged.trade), { merge: true });
      return merged;
    });
  } finally {
    persistDepth -= 1;
  }
}

export type PerformanceBucket = {
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null;
  maxDrawdown: number | null;
};

export function computeDemoPerformance(
  trades: GoldHunterDemoTrade[],
  range: "today" | "week" | "month" | "all",
  now = new Date()
): PerformanceBucket {
  const start = rangeStart(range, now);
  const closed = trades.filter((t) => {
    if (t.status !== "CLOSED" || t.netPnlEur == null) return false;
    if (!start) return true;
    const ts = t.closeTs || t.orderTs;
    return ts ? new Date(ts).getTime() >= start.getTime() : false;
  });
  const wins = closed.filter((t) => (t.netPnlEur ?? 0) > 0);
  const losses = closed.filter((t) => (t.netPnlEur ?? 0) < 0);
  const netPnl = closed.reduce((s, t) => s + (t.netPnlEur ?? 0), 0);
  const winSum = wins.reduce((s, t) => s + (t.netPnlEur ?? 0), 0);
  const lossSumAbs = Math.abs(losses.reduce((s, t) => s + (t.netPnlEur ?? 0), 0));
  const avgWin = wins.length ? winSum / wins.length : null;
  const avgLoss = losses.length ? -lossSumAbs / losses.length : null;
  const winRate = closed.length ? wins.length / closed.length : null;
  const profitFactor = lossSumAbs > 0 ? winSum / lossSumAbs : null;
  const expectancy =
    closed.length && avgWin != null && avgLoss != null && winRate != null
      ? winRate * avgWin + (1 - winRate) * avgLoss
      : null;

  // Max drawdown from equity curve of closed trades (chronological).
  let maxDrawdown: number | null = null;
  if (closed.length) {
    const chrono = [...closed].sort((a, b) =>
      (a.closeTs ?? "").localeCompare(b.closeTs ?? "")
    );
    let peak = 0;
    let equity = 0;
    let dd = 0;
    for (const t of chrono) {
      equity += t.netPnlEur ?? 0;
      if (equity > peak) peak = equity;
      const cur = peak - equity;
      if (cur > dd) dd = cur;
    }
    maxDrawdown = dd;
  }

  return {
    netPnl,
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    expectancy,
    maxDrawdown
  };
}

function rangeStart(
  range: "today" | "week" | "month" | "all",
  now: Date
): Date | null {
  if (range === "all") return null;
  const d = new Date(now);
  if (range === "today") {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (range === "week") {
    d.setUTCDate(d.getUTCDate() - 7);
    return d;
  }
  d.setUTCDate(d.getUTCDate() - 30);
  return d;
}

/** Today's closed net P/L for dashboard. */
export function todayNetPnlEur(
  trades: GoldHunterDemoTrade[],
  now = new Date()
): number {
  return computeDemoPerformance(trades, "today", now).netPnl;
}
