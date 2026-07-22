/**
 * Shared helpers and extended port for Stocks Intraday persistence.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { nowIso } from "../../utils/time";
import { DEFAULT_STOCK_INTRADAY_LIMITS } from "./featureFlags";
import {
  DEFAULT_STOCK_UNIVERSE,
  type EntryReservationState,
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
  /**
   * Transient routing id hydrated only for in-process use after a request supplies it.
   * Never persisted to Firestore (root or mirror).
   */
  connectionId?: string;
  /** SHA-256 hex of routing id — Firestore document key; never log raw id. */
  routingIdHash: string;
  userId: string;
  label: string;
  enabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  rateCount: number;
  rateWindowStart: string;
  createdAt: string;
  updatedAt: string;
  /** Hash of previous routing id after rotation (never raw). */
  rotatedFromRoutingIdHash: string | null;
}

export type StockCashReservationState = EntryReservationState;

export interface StockCashReservation {
  reservationId: string;
  userId: string;
  intentId: string;
  amount: number;
  released: boolean;
  createdAt: string;
  /** Capacity reservation lifecycle for Paper pending / SHADOW. */
  state: EntryReservationState;
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
  /**
   * SHADOW: open a GoldMeta-managed position immediately (FILLED).
   * Paper pending: reserve capacity without a broker fill (RESERVED).
   */
  openShadowPosition: boolean;
  /** When true (Paper), reserve position/daily/exposure/cash slots before fill. */
  reservePendingCapacity?: boolean;
}

export type AtomicEntryReservationResult =
  | {
      ok: true;
      intent: import("./types").StockTradeIntent;
      position: import("./types").StockManagedPosition | null;
      reservationState: EntryReservationState;
    }
  | { ok: false; code: string };

export interface ReleaseEntryReservationInput {
  userId: string;
  intentId: string;
  /** Reverse daily trade + allocation counters reserved at entry. */
  reverseDailyCounters: boolean;
  nextState: "CANCELLED" | "RELEASED";
  blockReason?: string | null;
}

export interface FinalizeEntryFillInput {
  userId: string;
  intentId: string;
  position: import("./types").StockManagedPosition;
}

export interface CloseShadowPositionInput {
  userId: string;
  position: import("./types").StockManagedPosition;
  accounting: import("./exitRules").ShadowExitAccounting;
  limits: typeof DEFAULT_STOCK_INTRADAY_LIMITS;
  perSymbolCooldownUntil: string;
  lossCooldownUntil: string | null;
}

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
  /** Pending Paper reservations that still consume capacity. */
  listActiveEntryReservations(userId: string): Promise<StockTradeIntent[]>;
  reserveIntent(intent: StockTradeIntent, idempotencyKey: string): Promise<ReserveIntentResult>;
  reserveExit(userId: string, positionId: string, reason: string): Promise<boolean>;
  /** Release a failed exit reservation so the next monitor cycle can retry safely. */
  releaseExitReservation(userId: string, positionId: string): Promise<void>;

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

  listShadowTrades(userId: string): Promise<import("./types").StockShadowTradeRecord[]>;
  appendShadowTrade(
    userId: string,
    trade: Omit<import("./types").StockShadowTradeRecord, "id"> & { id?: string }
  ): Promise<void>;

  getRestartGate(userId: string): Promise<StockRestartGate>;
  saveRestartGate(gate: StockRestartGate): Promise<void>;

  saveReconciliation(record: StockReconciliationRecord): Promise<void>;
  listPendingReconciliation(userId: string): Promise<StockReconciliationRecord[]>;

  /** Lookup by routing id — implementation hashes before Firestore get. */
  getWebhookConnection(connectionId: string): Promise<StockWebhookConnection | null>;
  saveWebhookConnection(conn: StockWebhookConnection): Promise<void>;
  touchWebhookConnectionUse(connectionId: string): Promise<StockWebhookConnection | null>;
  revokeWebhookConnection(connectionId: string, userId: string): Promise<StockWebhookConnection | null>;
  listWebhookConnections(userId: string): Promise<StockWebhookConnection[]>;

  registerSchedulerUser(userId: string): Promise<void>;
  listSchedulerUserIds(): Promise<string[]>;

  reserveEntryAtomically(input: AtomicEntryReservationInput): Promise<AtomicEntryReservationResult>;
  releaseEntryReservationAtomically(input: ReleaseEntryReservationInput): Promise<boolean>;
  finalizeEntryFillAtomically(input: FinalizeEntryFillInput): Promise<boolean>;
  closeShadowPositionAtomically(input: CloseShadowPositionInput): Promise<boolean>;
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

/**
 * Shared explicit deployment generation for API, Firestore triggers, and schedulers.
 * Never falls back to K_REVISION — Cloud Run services may have different revisions.
 * Fail closed outside test / explicit local development.
 */
export function currentDeploymentGeneration(): string {
  const explicit = process.env.STOCK_INTRADAY_DEPLOYMENT_GENERATION?.trim();
  if (explicit) return explicit;

  const appEnv = process.env.APP_ENV?.trim();
  const nodeEnv = process.env.NODE_ENV?.trim();
  const allowLocal =
    appEnv === "test" ||
    nodeEnv === "test" ||
    process.env.STOCK_INTRADAY_ALLOW_LOCAL_GENERATION === "1" ||
    (process.env.STORAGE_BACKEND === "memory" && appEnv !== "production");

  if (allowLocal) {
    return "local-dev";
  }

  throw new Error(
    "STOCK_INTRADAY_DEPLOYMENT_GENERATION is required for Stock Intraday functions. " +
      "Set the same explicit value on API, job-trigger, and scheduler services. " +
      "Do not use K_REVISION."
  );
}

export function jobRetryBackoffMs(attemptCount: number): number {
  const base = 5_000;
  const capped = Math.min(10 * 60_000, base * 2 ** Math.max(0, attemptCount - 1));
  return capped;
}

/** Hash an externally supplied routing / capability path value before lookup. */
export function hashRoutingId(connectionId: string): string {
  return createHash("sha256").update(connectionId, "utf8").digest("hex");
}

/** Constant-time hex digest comparison. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function generateWebhookRoutingId(): string {
  return `gm_si_${randomBytes(24).toString("base64url")}`;
}

/** @deprecated Use hashRoutingId — retained name only for migration of call sites. */
export function hashWebhookSecret(secret: string): string {
  return hashRoutingId(secret);
}

/** @deprecated Prefer constantTimeEqualHex(hashRoutingId(a), expectedHash). */
export function verifyWebhookSecret(secret: string, secretHash: string): boolean {
  return constantTimeEqualHex(hashRoutingId(secret), secretHash);
}

export function generateWebhookSecret(): string {
  return generateWebhookRoutingId();
}

export function createDefaultRisk(userId: string): StockIntradayRiskState {
  return createDefaultRiskState(userId);
}

export function sanitizeDocId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 700);
}

export function isActiveReservationState(state: EntryReservationState | null | undefined): boolean {
  return state === "RESERVED" || state === "SUBMITTED";
}

export { InMemoryStockIntradayStore } from "./inMemoryStockIntradayStore";
export { FirestoreStockIntradayStore } from "./firestoreStockIntradayStore";
