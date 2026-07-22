/**
 * Shared helpers and extended port for Stocks Intraday persistence.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { nowIso } from "../../utils/time";
import { DEFAULT_STOCK_INTRADAY_LIMITS } from "./featureFlags";
import {
  DEFAULT_STOCK_UNIVERSE,
  type StockIntradayRiskState,
  type StockManagedPosition,
  type StockTradeIntent,
  type StockUniverseFilters
} from "./types";
import type { StockSignalRecord } from "./signalIngestion";
import { createDefaultRiskState } from "./risk/riskEngine";

export const STOCK_JOB_LEASE_MS = 5 * 60 * 1000;
export const STOCK_INTENT_LEASE_MS = 60_000;

export interface StockIntradaySettings {
  userId: string;
  limits: typeof DEFAULT_STOCK_INTRADAY_LIMITS;
  universe: StockUniverseFilters;
  allowedStrategyIds: string[];
  updatedAt: string;
}

export interface StockIntradayActivityEntry {
  id: string;
  at: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
}

export interface StockIntradayAuditEntry {
  id: string;
  userId: string;
  at: string;
  action: string;
  detail: Record<string, unknown>;
}

export type StockJobState =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "DEAD_LETTER";

export type StockJobKind =
  | "PROCESS_SIGNAL"
  | "SCHEDULED_SCAN"
  | "MONITOR_POSITIONS"
  | "RECONCILE"
  | "MARKET_CLOSE_SWEEP";

export interface StockIntradayJob {
  jobId: string;
  userId: string;
  kind: StockJobKind;
  state: StockJobState;
  signalId: string | null;
  alertId: string | null;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  payload: Record<string, unknown>;
}

export interface StockWebhookConnection {
  connectionId: string;
  userId: string;
  /** SHA-256 hex of secret — never store plaintext. */
  secretHash: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  failureCount: number;
  lockedUntil: string | null;
}

export interface StockCashReservation {
  reservationId: string;
  userId: string;
  intentId: string;
  amount: number;
  released: boolean;
  createdAt: string;
}

export interface StockReconciliationRecord {
  id: string;
  userId: string;
  symbol: string;
  status: "PENDING" | "MATCHED" | "AMBIGUOUS" | "RESOLVED";
  detail: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StockRestartGate {
  userId: string;
  entriesPaused: boolean;
  lastReconciledAt: string | null;
  deploymentGeneration: string | null;
  reconciledGeneration: string | null;
  updatedAt: string;
}

export interface StockDashboardSnapshot {
  userId: string;
  lastTradingViewAlert: import("./types").StockTradingViewSignal | null;
  lastRankedOpportunities: import("./types").RankedIntradayOpportunity[];
  rejectedRecently: Array<{ symbol: string; reason: string; at: string }>;
  lastMarketDataAt: string | null;
  updatedAt: string;
}

export interface AtomicEntryReservationInput {
  userId: string;
  idempotencyKey: string;
  intent: import("./types").StockTradeIntent;
  position: import("./types").StockManagedPosition | null;
  cashAmount: number;
  availableCashFromBroker: number;
  limits: typeof DEFAULT_STOCK_INTRADAY_LIMITS;
  /** When true, also open position + increment daily counters and set intent OPEN */
  openShadowPosition: boolean;
}

export type AtomicEntryReservationResult =
  | { ok: true; intent: import("./types").StockTradeIntent; position: import("./types").StockManagedPosition | null }
  | { ok: false; code: string };

export type ReserveAlertResult = "reserved" | "duplicate";
export type ReserveIntentResult = "reserved" | "duplicate" | "lease_held";

export interface StockIntradayStorePort {
  getRiskState(userId: string): Promise<StockIntradayRiskState>;
  saveRiskState(state: StockIntradayRiskState): Promise<StockIntradayRiskState>;
  /** Atomic risk patch inside a transaction-friendly API. */
  incrementDailyTradeCounters(
    userId: string,
    patch: { trades?: number; allocationUsed?: number; realisedPnl?: number }
  ): Promise<StockIntradayRiskState>;

  getSettings(userId: string): Promise<StockIntradaySettings>;
  saveSettings(settings: StockIntradaySettings): Promise<StockIntradaySettings>;

  listPositions(userId: string): Promise<StockManagedPosition[]>;
  savePosition(position: StockManagedPosition): Promise<void>;
  deletePosition(userId: string, positionId: string): Promise<void>;
  /** Atomic: fail if symbol already has a managed open position. */
  reservePositionSlot(position: StockManagedPosition): Promise<boolean>;

  getIntent(userId: string, intentId: string): Promise<StockTradeIntent | null>;
  saveIntent(intent: StockTradeIntent): Promise<void>;
  listOpenIntents(userId: string): Promise<StockTradeIntent[]>;
  listUnresolvedIntents(userId: string): Promise<StockTradeIntent[]>;
  reserveIntent(intent: StockTradeIntent, idempotencyKey: string): Promise<ReserveIntentResult>;
  reserveExit(userId: string, positionId: string, reason: string): Promise<boolean>;

  hasAlertId(userId: string, alertId: string): Promise<boolean>;
  /** Atomic alert dedupe + signal persist. */
  reserveAlert(
    userId: string,
    alertId: string,
    signal: StockSignalRecord
  ): Promise<ReserveAlertResult>;
  saveSignal(record: StockSignalRecord): Promise<void>;
  getSignalByAlertId(userId: string, alertId: string): Promise<StockSignalRecord | null>;

  createJob(job: Omit<StockIntradayJob, "createdAt" | "updatedAt" | "completedAt" | "attemptCount" | "leaseOwner" | "leaseExpiresAt" | "nextAttemptAt" | "lastError" | "state"> & {
    state?: StockJobState;
    maxAttempts?: number;
  }): Promise<StockIntradayJob>;
  getJob(userId: string, jobId: string): Promise<StockIntradayJob | null>;
  claimJob(userId: string, jobId: string, ownerId: string, leaseMs?: number): Promise<StockIntradayJob | null>;
  completeJob(userId: string, jobId: string): Promise<StockIntradayJob | null>;
  failJob(userId: string, jobId: string, error: string): Promise<StockIntradayJob | null>;

  reserveCash(userId: string, intentId: string, amount: number): Promise<boolean>;
  releaseCash(userId: string, intentId: string): Promise<void>;
  getReservedCashTotal(userId: string): Promise<number>;

  appendActivity(userId: string, entry: Omit<StockIntradayActivityEntry, "id"> & { id?: string }): Promise<void>;
  listActivity(userId: string, limit?: number): Promise<StockIntradayActivityEntry[]>;
  appendAudit(entry: Omit<StockIntradayAuditEntry, "id" | "at"> & { id?: string; at?: string }): Promise<void>;

  getSymbolCooldown(userId: string, symbol: string): Promise<string | null>;
  setSymbolCooldown(userId: string, symbol: string, untilIso: string): Promise<void>;

  listShadowTrades(userId: string): Promise<
    Array<{ id: string; symbol: string; side: "BUY" | "SELL"; quantity: number; at: string; note: string }>
  >;
  appendShadowTrade(
    userId: string,
    trade: { symbol: string; side: "BUY" | "SELL"; quantity: number; note: string }
  ): Promise<void>;

  getRestartGate(userId: string): Promise<StockRestartGate>;
  saveRestartGate(gate: StockRestartGate): Promise<void>;

  saveReconciliation(record: StockReconciliationRecord): Promise<void>;
  listPendingReconciliation(userId: string): Promise<StockReconciliationRecord[]>;

  getWebhookConnection(connectionId: string): Promise<StockWebhookConnection | null>;
  saveWebhookConnection(conn: StockWebhookConnection): Promise<void>;
  recordWebhookAuthFailure(connectionId: string): Promise<StockWebhookConnection | null>;
  clearWebhookAuthFailures(connectionId: string): Promise<void>;

  registerSchedulerUser(userId: string): Promise<void>;
  listSchedulerUserIds(): Promise<string[]>;

  reserveEntryAtomically(input: AtomicEntryReservationInput): Promise<AtomicEntryReservationResult>;
  getDashboardSnapshot(userId: string): Promise<StockDashboardSnapshot>;
  saveDashboardSnapshot(snapshot: StockDashboardSnapshot): Promise<void>;
  listDueRetryJobs(nowMs?: number): Promise<Array<{ userId: string; jobId: string }>>;
}

export function defaultSettings(userId: string): StockIntradaySettings {
  return {
    userId,
    limits: { ...DEFAULT_STOCK_INTRADAY_LIMITS },
    universe: { ...DEFAULT_STOCK_UNIVERSE, allowlist: [...DEFAULT_STOCK_UNIVERSE.allowlist] },
    allowedStrategyIds: [],
    updatedAt: nowIso()
  };
}

export function defaultRestartGate(userId: string): StockRestartGate {
  return {
    userId,
    entriesPaused: true,
    lastReconciledAt: null,
    deploymentGeneration: null,
    reconciledGeneration: null,
    updatedAt: nowIso()
  };
}

export function emptyDashboardSnapshot(userId: string): StockDashboardSnapshot {
  return {
    userId,
    lastTradingViewAlert: null,
    lastRankedOpportunities: [],
    rejectedRecently: [],
    lastMarketDataAt: null,
    updatedAt: nowIso()
  };
}

export function currentDeploymentGeneration(): string {
  return (
    process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION?.trim() ||
    process.env.K_REVISION?.trim() ||
    "default"
  );
}

export function jobRetryBackoffMs(attemptCount: number): number {
  const base = 5_000;
  const capped = Math.min(10 * 60_000, base * 2 ** Math.max(0, attemptCount - 1));
  return capped;
}

export function hashWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyWebhookSecret(secret: string, secretHash: string): boolean {
  const computed = Buffer.from(hashWebhookSecret(secret), "hex");
  const expected = Buffer.from(secretHash, "hex");
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

export function generateWebhookSecret(): string {
  return `gm_stock_${randomBytes(24).toString("base64url")}`;
}

export function createDefaultRisk(userId: string): StockIntradayRiskState {
  return createDefaultRiskState(userId);
}

export function sanitizeDocId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 700);
}

export { InMemoryStockIntradayStore } from "./inMemoryStockIntradayStore";
export { FirestoreStockIntradayStore } from "./firestoreStockIntradayStore";
