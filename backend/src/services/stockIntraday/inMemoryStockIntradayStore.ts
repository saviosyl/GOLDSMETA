/**
 * In-memory Stocks Intraday store for unit/integration tests.
 * Serializes transactional operations via an internal promise chain for in-process atomicity.
 */

/* eslint-disable @typescript-eslint/require-await -- sync Map-backed implementation of async port */

import { randomUUID } from "crypto";
import type {
  EntryReservationState,
  StockIntradayRiskState,
  StockManagedPosition,
  StockShadowTradeRecord,
  StockTradeIntent
} from "./types";
import type { StockSignalRecord } from "./signalIngestion";
import { isTerminalState } from "./stateMachine";
import { refreshRiskPeriod } from "./risk/riskEngine";
import { nowIso } from "../../utils/time";
import {
  type StockIntradayStorePort,
  type StockIntradaySettings,
  type StockIntradayActivityEntry,
  type StockIntradayAuditEntry,
  type StockIntradayJob,
  type StockJobState,
  type StockWebhookConnection,
  type StockCashReservation,
  type StockReconciliationRecord,
  type StockRestartGate,
  type StockDashboardSnapshot,
  type AtomicEntryReservationInput,
  type AtomicEntryReservationResult,
  type ReleaseEntryReservationInput,
  type FinalizeEntryFillInput,
  type CloseShadowPositionInput,
  type ReserveAlertResult,
  type ReserveIntentResult,
  defaultSettings,
  defaultRestartGate,
  emptyDashboardSnapshot,
  createDefaultRisk,
  sanitizeDocId,
  jobRetryBackoffMs,
  hashRoutingId,
  constantTimeEqualHex,
  isActiveReservationState,
  STOCK_JOB_LEASE_MS,
  STOCK_INTENT_LEASE_MS
} from "./stockIntradayStore";

interface IdempotencyEntry {
  intentId: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

interface ExitReservation {
  userId: string;
  positionId: string;
  reason: string;
  createdAt: string;
}

function isLeaseExpired(leaseExpiresAt: string | null): boolean {
  if (!leaseExpiresAt) return true;
  return Date.now() > new Date(leaseExpiresAt).getTime();
}

function leaseExpiresFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export class InMemoryStockIntradayStore implements StockIntradayStorePort {
  private risk = new Map<string, StockIntradayRiskState>();
  private settings = new Map<string, StockIntradaySettings>();
  private positions = new Map<string, StockManagedPosition[]>();
  private intents = new Map<string, StockTradeIntent[]>();
  private alertIds = new Map<string, Set<string>>();
  private signals = new Map<string, StockSignalRecord[]>();
  private idempotency = new Map<string, IdempotencyEntry>();
  private exitReservations = new Map<string, ExitReservation>();
  private jobs = new Map<string, StockIntradayJob[]>();
  private cashReservations = new Map<string, StockCashReservation[]>();
  private activity = new Map<string, StockIntradayActivityEntry[]>();
  private audit = new Map<string, StockIntradayAuditEntry[]>();
  private cooldowns = new Map<string, Map<string, string>>();
  private shadowTrades = new Map<string, StockShadowTradeRecord[]>();
  private shadowDecisions = new Map<
    string,
    import("./shadowPerformance").ShadowDecisionRecord[]
  >();
  private restartGates = new Map<string, StockRestartGate>();
  private dashboardSnapshots = new Map<string, StockDashboardSnapshot>();
  private reconciliation = new Map<string, StockReconciliationRecord[]>();
  /** Keyed by routingIdHash */
  private webhookConnections = new Map<string, StockWebhookConnection>();
  private schedulerUsers = new Set<string>();
  private txChain: Promise<unknown> = Promise.resolve();

  private runAtomic<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.txChain.then(fn, fn);
    this.txChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private userKey(userId: string, suffix: string): string {
    return `${userId}:${suffix}`;
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  async getRiskState(userId: string): Promise<StockIntradayRiskState> {
    const existing = this.risk.get(userId);
    if (existing) {
      const refreshed = refreshRiskPeriod(this.clone(existing));
      if (refreshed.dayKey !== existing.dayKey) {
        this.risk.set(userId, refreshed);
      }
      return this.clone(refreshed);
    }
    const created = refreshRiskPeriod(createDefaultRisk(userId));
    this.risk.set(userId, created);
    return this.clone(created);
  }

  async saveRiskState(state: StockIntradayRiskState): Promise<StockIntradayRiskState> {
    const next = { ...state, updatedAt: nowIso() };
    this.risk.set(state.userId, next);
    return this.clone(next);
  }

  async incrementDailyTradeCounters(
    userId: string,
    patch: { trades?: number; allocationUsed?: number; realisedPnl?: number }
  ): Promise<StockIntradayRiskState> {
    return this.runAtomic(async () => {
      let state = refreshRiskPeriod(await this.getRiskState(userId));
      if (patch.trades) state.tradesUsedToday += patch.trades;
      if (patch.allocationUsed) state.dailyAllocationUsed += patch.allocationUsed;
      if (patch.realisedPnl) state.dailyRealisedPnl += patch.realisedPnl;
      state.updatedAt = nowIso();
      return this.saveRiskState(state);
    });
  }

  async getSettings(userId: string): Promise<StockIntradaySettings> {
    const existing = this.settings.get(userId);
    if (existing) return this.clone(existing);
    const created = defaultSettings(userId);
    this.settings.set(userId, created);
    return this.clone(created);
  }

  async saveSettings(settings: StockIntradaySettings): Promise<StockIntradaySettings> {
    const next = { ...settings, updatedAt: nowIso() };
    this.settings.set(settings.userId, next);
    return this.clone(next);
  }

  async listPositions(userId: string): Promise<StockManagedPosition[]> {
    return this.clone(this.positions.get(userId) ?? []);
  }

  async savePosition(position: StockManagedPosition): Promise<void> {
    const list = this.positions.get(position.userId) ?? [];
    const idx = list.findIndex((p) => p.positionId === position.positionId);
    if (idx >= 0) list[idx] = this.clone(position);
    else list.push(this.clone(position));
    this.positions.set(position.userId, list);
  }

  async deletePosition(userId: string, positionId: string): Promise<void> {
    const list = this.positions.get(userId) ?? [];
    this.positions.set(
      userId,
      list.filter((p) => p.positionId !== positionId)
    );
    this.exitReservations.delete(positionId);
  }

  async reservePositionSlot(position: StockManagedPosition): Promise<boolean> {
    return this.runAtomic(async () => {
      const list = this.positions.get(position.userId) ?? [];
      if (list.some((p) => p.symbol === position.symbol)) {
        return false;
      }
      list.push(this.clone(position));
      this.positions.set(position.userId, list);
      return true;
    });
  }

  async getIntent(userId: string, intentId: string): Promise<StockTradeIntent | null> {
    const found = (this.intents.get(userId) ?? []).find((i) => i.intentId === intentId);
    return found ? this.clone(found) : null;
  }

  async saveIntent(intent: StockTradeIntent): Promise<void> {
    const list = this.intents.get(intent.userId) ?? [];
    const idx = list.findIndex((i) => i.intentId === intent.intentId);
    const next = { ...intent, updatedAt: nowIso() };
    if (idx >= 0) list[idx] = next;
    else list.unshift(next);
    this.intents.set(intent.userId, list);
  }

  private filterNonTerminalIntents(userId: string): StockTradeIntent[] {
    return (this.intents.get(userId) ?? []).filter((i) => !isTerminalState(i.state));
  }

  async listOpenIntents(userId: string): Promise<StockTradeIntent[]> {
    return this.clone(this.filterNonTerminalIntents(userId));
  }

  async listUnresolvedIntents(userId: string): Promise<StockTradeIntent[]> {
    return this.clone(this.filterNonTerminalIntents(userId));
  }

  async listActiveEntryReservations(userId: string): Promise<StockTradeIntent[]> {
    return this.clone(
      (this.intents.get(userId) ?? []).filter((i) => isActiveReservationState(i.entryReservationState))
    );
  }

  async reserveIntent(intent: StockTradeIntent, idempotencyKey: string): Promise<ReserveIntentResult> {
    return this.runAtomic(async () => {
      const key = this.userKey(intent.userId, sanitizeDocId(idempotencyKey));
      const existing = this.idempotency.get(key);
      if (existing) {
        const owner = intent.leaseOwner;
        if (
          existing.leaseOwner &&
          existing.leaseOwner !== owner &&
          !isLeaseExpired(existing.leaseExpiresAt)
        ) {
          return "lease_held";
        }
        return "duplicate";
      }

      const leaseOwner = intent.leaseOwner;
      const leaseExpiresAt =
        intent.leaseExpiresAt ??
        (leaseOwner ? leaseExpiresFromNow(STOCK_INTENT_LEASE_MS) : null);

      const toSave = {
        ...intent,
        leaseOwner,
        leaseExpiresAt,
        updatedAt: nowIso()
      };
      await this.saveIntent(toSave);
      this.idempotency.set(key, {
        intentId: intent.intentId,
        leaseOwner,
        leaseExpiresAt
      });
      return "reserved";
    });
  }

  async reserveAlert(
    userId: string,
    alertId: string,
    signal: StockSignalRecord
  ): Promise<ReserveAlertResult> {
    return this.runAtomic(async () => {
      if (await this.hasAlertId(userId, alertId)) {
        return "duplicate";
      }
      const ids = this.alertIds.get(userId) ?? new Set<string>();
      ids.add(alertId);
      this.alertIds.set(userId, ids);
      await this.saveSignal(signal);
      return "reserved";
    });
  }

  async reserveExit(userId: string, positionId: string, reason: string): Promise<boolean> {
    return this.runAtomic(async () => {
      if (this.exitReservations.has(positionId)) {
        return false;
      }
      this.exitReservations.set(positionId, {
        userId,
        positionId,
        reason,
        createdAt: nowIso()
      });
      return true;
    });
  }

  async releaseExitReservation(_userId: string, positionId: string): Promise<void> {
    this.exitReservations.delete(positionId);
  }

  async saveSignal(record: StockSignalRecord): Promise<void> {
    const list = this.signals.get(record.userId) ?? [];
    const idx = list.findIndex((s) => s.alertId === record.alertId || s.id === record.id);
    const next = { ...record, updatedAt: nowIso() };
    if (idx >= 0) list[idx] = next;
    else list.unshift(next);
    this.signals.set(record.userId, list);
    const ids = this.alertIds.get(record.userId) ?? new Set<string>();
    ids.add(record.alertId);
    this.alertIds.set(record.userId, ids);
  }

  async getSignalByAlertId(userId: string, alertId: string): Promise<StockSignalRecord | null> {
    const found = (this.signals.get(userId) ?? []).find((s) => s.alertId === alertId);
    return found ? this.clone(found) : null;
  }

  async hasAlertId(userId: string, alertId: string): Promise<boolean> {
    if ((this.alertIds.get(userId) ?? new Set()).has(alertId)) return true;
    return (this.signals.get(userId) ?? []).some((s) => s.alertId === alertId);
  }

  async createJob(
    job: Omit<
      StockIntradayJob,
      | "createdAt"
      | "updatedAt"
      | "completedAt"
      | "attemptCount"
      | "leaseOwner"
      | "leaseExpiresAt"
      | "nextAttemptAt"
      | "lastError"
      | "state"
    > & { state?: StockJobState; maxAttempts?: number }
  ): Promise<StockIntradayJob> {
    const ts = nowIso();
    const created: StockIntradayJob = {
      ...job,
      state: job.state ?? "QUEUED",
      maxAttempts: job.maxAttempts ?? 5,
      attemptCount: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      lastError: null,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null
    };
    const list = this.jobs.get(job.userId) ?? [];
    list.unshift(created);
    this.jobs.set(job.userId, list);
    return this.clone(created);
  }

  async getJob(userId: string, jobId: string): Promise<StockIntradayJob | null> {
    const found = (this.jobs.get(userId) ?? []).find((j) => j.jobId === jobId);
    return found ? this.clone(found) : null;
  }

  private updateJob(userId: string, jobId: string, patch: Partial<StockIntradayJob>): StockIntradayJob | null {
    const list = this.jobs.get(userId) ?? [];
    const idx = list.findIndex((j) => j.jobId === jobId);
    if (idx < 0) return null;
    const current = list[idx]!;
    const next: StockIntradayJob = { ...current, ...patch, updatedAt: nowIso() };
    list[idx] = next;
    this.jobs.set(userId, list);
    return this.clone(next);
  }

  async claimJob(
    userId: string,
    jobId: string,
    ownerId: string,
    leaseMs = STOCK_JOB_LEASE_MS
  ): Promise<StockIntradayJob | null> {
    return this.runAtomic(async () => {
      const job = await this.getJob(userId, jobId);
      if (!job) return null;
      if (job.state === "COMPLETED") return null;
      if (
        job.state === "QUEUED" &&
        job.nextAttemptAt &&
        Date.parse(job.nextAttemptAt) > Date.now()
      ) {
        return null;
      }
      if (
        job.state === "PROCESSING" &&
        job.leaseOwner &&
        job.leaseOwner !== ownerId &&
        !isLeaseExpired(job.leaseExpiresAt)
      ) {
        return null;
      }
      return this.updateJob(userId, jobId, {
        state: "PROCESSING",
        leaseOwner: ownerId,
        leaseExpiresAt: leaseExpiresFromNow(leaseMs),
        attemptCount: job.attemptCount + 1
      });
    });
  }

  async completeJob(userId: string, jobId: string): Promise<StockIntradayJob | null> {
    return this.runAtomic(async () => {
      const job = await this.getJob(userId, jobId);
      if (!job) return null;
      return this.updateJob(userId, jobId, {
        state: "COMPLETED",
        completedAt: nowIso(),
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastError: null
      });
    });
  }

  async failJob(userId: string, jobId: string, error: string): Promise<StockIntradayJob | null> {
    return this.runAtomic(async () => {
      const job = await this.getJob(userId, jobId);
      if (!job) return null;
      const exhausted = job.attemptCount >= job.maxAttempts;
      const nextAttemptAt = exhausted
        ? null
        : new Date(Date.now() + jobRetryBackoffMs(job.attemptCount)).toISOString();
      return this.updateJob(userId, jobId, {
        state: exhausted ? "DEAD_LETTER" : "QUEUED",
        lastError: error,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt
      });
    });
  }

  async reserveCash(userId: string, intentId: string, amount: number): Promise<boolean> {
    return this.runAtomic(async () => {
      const list = this.cashReservations.get(userId) ?? [];
      if (list.some((r) => r.intentId === intentId && !r.released)) {
        return false;
      }
      list.push({
        reservationId: randomUUID(),
        userId,
        intentId,
        amount,
        released: false,
        createdAt: nowIso(),
        state: "RESERVED"
      });
      this.cashReservations.set(userId, list);
      return true;
    });
  }

  async releaseCash(userId: string, intentId: string): Promise<void> {
    const list = this.cashReservations.get(userId) ?? [];
    for (const reservation of list) {
      if (reservation.intentId === intentId && !reservation.released) {
        reservation.released = true;
      }
    }
    this.cashReservations.set(userId, list);
  }

  async getReservedCashTotal(userId: string): Promise<number> {
    return (this.cashReservations.get(userId) ?? [])
      .filter((r) => !r.released)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  async appendActivity(
    userId: string,
    entry: Omit<StockIntradayActivityEntry, "id"> & { id?: string }
  ): Promise<void> {
    const list = this.activity.get(userId) ?? [];
    list.unshift({
      id: entry.id ?? randomUUID(),
      at: entry.at,
      message: entry.message,
      level: entry.level
    });
    this.activity.set(userId, list.slice(0, 200));
  }

  async listActivity(userId: string, limit = 50): Promise<StockIntradayActivityEntry[]> {
    return this.clone((this.activity.get(userId) ?? []).slice(0, limit));
  }

  async appendAudit(
    entry: Omit<StockIntradayAuditEntry, "id" | "at"> & { id?: string; at?: string }
  ): Promise<void> {
    const list = this.audit.get(entry.userId) ?? [];
    list.unshift({
      id: entry.id ?? randomUUID(),
      userId: entry.userId,
      at: entry.at ?? nowIso(),
      action: entry.action,
      detail: this.clone(entry.detail)
    });
    this.audit.set(entry.userId, list.slice(0, 500));
  }

  async getSymbolCooldown(userId: string, symbol: string): Promise<string | null> {
    return this.cooldowns.get(userId)?.get(symbol.toUpperCase()) ?? null;
  }

  async setSymbolCooldown(userId: string, symbol: string, untilIso: string): Promise<void> {
    const map = this.cooldowns.get(userId) ?? new Map<string, string>();
    map.set(symbol.toUpperCase(), untilIso);
    this.cooldowns.set(userId, map);
  }

  async listShadowTrades(userId: string): Promise<StockShadowTradeRecord[]> {
    return this.clone(this.shadowTrades.get(userId) ?? []);
  }

  async appendShadowTrade(
    userId: string,
    trade: Omit<StockShadowTradeRecord, "id"> & { id?: string }
  ): Promise<void> {
    const list = this.shadowTrades.get(userId) ?? [];
    list.unshift({
      id: trade.id ?? randomUUID(),
      ...trade,
      at: trade.at ?? nowIso()
    });
    this.shadowTrades.set(userId, list.slice(0, 200));
  }

  async appendShadowDecision(
    userId: string,
    decision: Omit<import("./shadowPerformance").ShadowDecisionRecord, "id" | "userId" | "createdAt"> & {
      id?: string;
    }
  ): Promise<import("./shadowPerformance").ShadowDecisionRecord> {
    const record = {
      ...decision,
      id: decision.id ?? randomUUID(),
      userId,
      createdAt: nowIso()
    };
    const list = this.shadowDecisions.get(userId) ?? [];
    list.unshift(record);
    this.shadowDecisions.set(userId, list.slice(0, 500));
    return this.clone(record);
  }

  async listShadowDecisions(
    userId: string,
    limit = 200
  ): Promise<import("./shadowPerformance").ShadowDecisionRecord[]> {
    return this.clone((this.shadowDecisions.get(userId) ?? []).slice(0, limit));
  }

  async completeShadowDecisionExit(
    userId: string,
    symbol: string,
    exit: {
      hypotheticalExit: number;
      exitReason: import("./featureFlags").StockExitReason;
      grossPnl: number;
      estimatedSlippage: number;
      netPnl: number;
      holdingDurationMinutes: number;
      highestFavourableMovement: number | null;
      maximumAdverseMovement: number | null;
    }
  ): Promise<import("./shadowPerformance").ShadowDecisionRecord | null> {
    const list = this.shadowDecisions.get(userId) ?? [];
    const idx = list.findIndex(
      (d) =>
        d.symbol.toUpperCase() === symbol.toUpperCase() &&
        d.outcome === "BUY" &&
        d.hypotheticalExit == null
    );
    if (idx < 0) return null;
    const updated: import("./shadowPerformance").ShadowDecisionRecord = {
      ...list[idx]!,
      ...exit
    };
    list[idx] = updated;
    this.shadowDecisions.set(userId, list);
    return this.clone(updated);
  }

  async getRestartGate(userId: string): Promise<StockRestartGate> {
    const existing = this.restartGates.get(userId);
    if (existing) return this.clone(existing);
    const created = defaultRestartGate(userId);
    this.restartGates.set(userId, created);
    return this.clone(created);
  }

  async saveRestartGate(gate: StockRestartGate): Promise<void> {
    this.restartGates.set(gate.userId, { ...gate, updatedAt: nowIso() });
  }

  async saveReconciliation(record: StockReconciliationRecord): Promise<void> {
    const list = this.reconciliation.get(record.userId) ?? [];
    const idx = list.findIndex((r) => r.id === record.id);
    const next = { ...record, updatedAt: nowIso() };
    if (idx >= 0) list[idx] = next;
    else list.unshift(next);
    this.reconciliation.set(record.userId, list);
  }

  async listPendingReconciliation(userId: string): Promise<StockReconciliationRecord[]> {
    return this.clone((this.reconciliation.get(userId) ?? []).filter((r) => r.status === "PENDING"));
  }

  async getWebhookConnection(connectionId: string): Promise<StockWebhookConnection | null> {
    const hash = hashRoutingId(connectionId);
    for (const conn of this.webhookConnections.values()) {
      if (constantTimeEqualHex(conn.routingIdHash, hash)) {
        return this.clone({ ...conn, connectionId });
      }
    }
    return null;
  }

  async saveWebhookConnection(conn: StockWebhookConnection): Promise<void> {
    const hash = conn.routingIdHash || (conn.connectionId ? hashRoutingId(conn.connectionId) : "");
    if (!hash) {
      throw new Error("WEBHOOK_ROUTING_HASH_REQUIRED");
    }
    const { connectionId: _omit, ...persistable } = conn;
    void _omit;
    this.webhookConnections.set(hash, this.clone({ ...persistable, routingIdHash: hash }));
  }

  async touchWebhookConnectionUse(connectionId: string): Promise<StockWebhookConnection | null> {
    return this.runAtomic(async () => {
      const existing = await this.getWebhookConnection(connectionId);
      if (!existing) return null;
      const now = nowIso();
      const windowMs = existing.rateLimitWindowMs || 60_000;
      const windowStartMs = Date.parse(existing.rateWindowStart);
      let rateCount = existing.rateCount;
      let rateWindowStart = existing.rateWindowStart;
      if (!Number.isFinite(windowStartMs) || Date.now() - windowStartMs >= windowMs) {
        rateCount = 1;
        rateWindowStart = now;
      } else {
        rateCount += 1;
      }
      const updated: StockWebhookConnection = {
        ...existing,
        lastUsedAt: now,
        rateCount,
        rateWindowStart,
        updatedAt: now
      };
      await this.saveWebhookConnection(updated);
      return this.clone({ ...updated, connectionId });
    });
  }

  async revokeWebhookConnection(
    connectionId: string,
    userId: string
  ): Promise<StockWebhookConnection | null> {
    const existing = await this.getWebhookConnection(connectionId);
    if (!existing || existing.userId !== userId) return null;
    const updated: StockWebhookConnection = {
      ...existing,
      enabled: false,
      revokedAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.saveWebhookConnection(updated);
    return this.clone({ ...updated, connectionId });
  }

  async listWebhookConnections(userId: string): Promise<StockWebhookConnection[]> {
    return this.clone(
      [...this.webhookConnections.values()].filter((c) => c.userId === userId)
    );
  }

  async registerSchedulerUser(userId: string): Promise<void> {
    this.schedulerUsers.add(userId);
  }

  async listSchedulerUserIds(): Promise<string[]> {
    return [...this.schedulerUsers];
  }

  async reserveEntryAtomically(input: AtomicEntryReservationInput): Promise<AtomicEntryReservationResult> {
    return this.runAtomic(async () => {
      const {
        userId,
        idempotencyKey,
        intent,
        position,
        cashAmount,
        availableCashFromBroker,
        limits,
        openShadowPosition,
        reservePendingCapacity
      } = input;

      const idemKey = this.userKey(userId, sanitizeDocId(idempotencyKey));
      if (this.idempotency.has(idemKey)) {
        return { ok: false, code: "DUPLICATE_INTENT" };
      }

      const positions = this.positions.get(userId) ?? [];
      const pending = (this.intents.get(userId) ?? []).filter((i) =>
        isActiveReservationState(i.entryReservationState)
      );
      const reservedSlotCount = positions.length + pending.length;

      if (positions.some((p) => p.symbol === intent.symbol) || pending.some((p) => p.symbol === intent.symbol)) {
        return { ok: false, code: "SYMBOL_POSITION_EXISTS" };
      }

      if (reservedSlotCount >= limits.maxSimultaneousPositions) {
        return { ok: false, code: "MAX_POSITIONS" };
      }

      let risk = refreshRiskPeriod(await this.getRiskState(userId));
      if (risk.tradesUsedToday >= limits.maxTradesPerDay) {
        return { ok: false, code: "DAILY_TRADE_LIMIT" };
      }

      const dailyAllocationRemaining = limits.dailyCapitalAllocation - risk.dailyAllocationUsed;
      if (dailyAllocationRemaining < cashAmount) {
        return { ok: false, code: "DAILY_ALLOCATION_EXCEEDED" };
      }

      const currentReservedCash = (this.cashReservations.get(userId) ?? [])
        .filter((r) => !r.released)
        .reduce((sum, r) => sum + r.amount, 0);
      if (availableCashFromBroker - currentReservedCash - cashAmount < limits.minCashReserve) {
        return { ok: false, code: "CASH_RESERVE" };
      }

      const pendingExposure = pending.reduce((s, i) => s + i.reservedCash, 0);
      const portfolioExposure =
        positions.reduce((s, p) => s + p.quantity * p.entryPrice, 0) + pendingExposure;
      if (portfolioExposure + cashAmount > limits.maxPortfolioExposure) {
        return { ok: false, code: "PORTFOLIO_EXPOSURE" };
      }

      const symbolExposure =
        positions
          .filter((p) => p.symbol === intent.symbol)
          .reduce((s, p) => s + p.quantity * p.entryPrice, 0) +
        pending
          .filter((p) => p.symbol === intent.symbol)
          .reduce((s, i) => s + i.reservedCash, 0);
      if (symbolExposure + cashAmount > limits.maxExposurePerSymbol) {
        return { ok: false, code: "SYMBOL_EXPOSURE" };
      }

      const shouldOpen = openShadowPosition && position != null;
      const shouldReservePending = Boolean(reservePendingCapacity) && !shouldOpen;
      if (!shouldOpen && !shouldReservePending && !openShadowPosition) {
        // legacy path still reserves cash/idempotency without counting daily slots
      }

      const reservationState: EntryReservationState = shouldOpen
        ? "FILLED"
        : shouldReservePending
          ? "RESERVED"
          : "RESERVED";

      const finalIntent: StockTradeIntent = {
        ...intent,
        state: shouldOpen ? "OPEN" : intent.state,
        entryReservationState: reservationState,
        updatedAt: nowIso()
      };

      const intentList = this.intents.get(userId) ?? [];
      intentList.unshift(finalIntent);
      this.intents.set(userId, intentList);

      const leaseOwner = intent.leaseOwner;
      const leaseExpiresAt =
        intent.leaseExpiresAt ??
        (leaseOwner ? leaseExpiresFromNow(STOCK_INTENT_LEASE_MS) : null);
      this.idempotency.set(idemKey, {
        intentId: intent.intentId,
        leaseOwner,
        leaseExpiresAt
      });

      const cashList = this.cashReservations.get(userId) ?? [];
      cashList.push({
        reservationId: randomUUID(),
        userId,
        intentId: intent.intentId,
        amount: cashAmount,
        released: false,
        createdAt: nowIso(),
        state: reservationState
      });
      this.cashReservations.set(userId, cashList);

      let savedPosition: StockManagedPosition | null = null;
      if (shouldOpen && position) {
        const positionList = this.positions.get(userId) ?? [];
        positionList.push(this.clone(position));
        this.positions.set(userId, positionList);
        savedPosition = this.clone(position);
      }

      if (shouldOpen || shouldReservePending) {
        risk.tradesUsedToday += 1;
        risk.dailyAllocationUsed += cashAmount;
        risk.updatedAt = nowIso();
        this.risk.set(userId, risk);
      }

      return {
        ok: true,
        intent: this.clone(finalIntent),
        position: savedPosition,
        reservationState
      };
    });
  }

  async releaseEntryReservationAtomically(input: ReleaseEntryReservationInput): Promise<boolean> {
    return this.runAtomic(async () => {
      const { userId, intentId, reverseDailyCounters, nextState, blockReason } = input;
      const intentList = this.intents.get(userId) ?? [];
      const idx = intentList.findIndex((i) => i.intentId === intentId);
      if (idx < 0) return false;
      const intent = intentList[idx]!;
      if (
        intent.entryReservationState === "RELEASED" ||
        intent.entryReservationState === "CANCELLED" ||
        intent.entryReservationState === "FILLED"
      ) {
        if (intent.entryReservationState === "FILLED") return false;
      }
      const wasActive = isActiveReservationState(intent.entryReservationState);
      const cashAmount = intent.reservedCash;
      intentList[idx] = {
        ...intent,
        state: nextState === "CANCELLED" ? "CANCELLED" : intent.state,
        entryReservationState: nextState,
        blockReason: blockReason ?? intent.blockReason,
        updatedAt: nowIso()
      };
      this.intents.set(userId, intentList);

      const cashList = this.cashReservations.get(userId) ?? [];
      for (const reservation of cashList) {
        if (reservation.intentId === intentId && !reservation.released) {
          reservation.released = true;
          reservation.state = nextState;
        }
      }
      this.cashReservations.set(userId, cashList);

      if (reverseDailyCounters && wasActive) {
        let risk = refreshRiskPeriod(await this.getRiskState(userId));
        risk.tradesUsedToday = Math.max(0, risk.tradesUsedToday - 1);
        risk.dailyAllocationUsed = Math.max(0, risk.dailyAllocationUsed - cashAmount);
        risk.updatedAt = nowIso();
        this.risk.set(userId, risk);
      }
      return true;
    });
  }

  async finalizeEntryFillAtomically(input: FinalizeEntryFillInput): Promise<boolean> {
    return this.runAtomic(async () => {
      const { userId, intentId, position } = input;
      const intentList = this.intents.get(userId) ?? [];
      const idx = intentList.findIndex((i) => i.intentId === intentId);
      if (idx < 0) return false;
      const intent = intentList[idx]!;
      if (intent.entryReservationState === "FILLED") {
        return true;
      }
      if (!isActiveReservationState(intent.entryReservationState)) {
        return false;
      }
      intentList[idx] = {
        ...intent,
        state: "OPEN",
        entryReservationState: "FILLED",
        filledQuantity: position.quantity,
        averageFillPrice: position.entryPrice,
        updatedAt: nowIso()
      };
      this.intents.set(userId, intentList);

      const positions = this.positions.get(userId) ?? [];
      if (!positions.some((p) => p.positionId === position.positionId || p.symbol === position.symbol)) {
        positions.push(this.clone(position));
        this.positions.set(userId, positions);
      }

      const cashList = this.cashReservations.get(userId) ?? [];
      for (const reservation of cashList) {
        if (reservation.intentId === intentId) {
          reservation.state = "FILLED";
        }
      }
      this.cashReservations.set(userId, cashList);
      return true;
    });
  }

  async closeShadowPositionAtomically(input: CloseShadowPositionInput): Promise<boolean> {
    return this.runAtomic(async () => {
      const { userId, position, accounting, limits, perSymbolCooldownUntil, lossCooldownUntil } =
        input;
      const positions = this.positions.get(userId) ?? [];
      if (!positions.some((p) => p.positionId === position.positionId)) {
        return false;
      }

      const intentList = this.intents.get(userId) ?? [];
      const intentIdx = intentList.findIndex((i) => i.intentId === position.intentId);
      if (intentIdx >= 0) {
        const intent = intentList[intentIdx]!;
        intentList[intentIdx] = {
          ...intent,
          state: "CLOSED",
          exitReason: accounting.exitReason,
          entryReservationState: "RELEASED",
          updatedAt: nowIso()
        };
        this.intents.set(userId, intentList);
      }

      this.positions.set(
        userId,
        positions.filter((p) => p.positionId !== position.positionId)
      );

      const cashList = this.cashReservations.get(userId) ?? [];
      for (const reservation of cashList) {
        if (reservation.intentId === position.intentId && !reservation.released) {
          reservation.released = true;
          reservation.state = "RELEASED";
        }
      }
      this.cashReservations.set(userId, cashList);

      await this.appendShadowTrade(userId, {
        symbol: position.symbol,
        side: "SELL",
        quantity: position.quantity,
        at: accounting.exitAt,
        note: `SHADOW exit: ${accounting.exitReason}`,
        entryPrice: accounting.entryPrice,
        exitPrice: accounting.exitPrice,
        exitAt: accounting.exitAt,
        grossPnl: accounting.grossPnl,
        estimatedSpreadSlippage: accounting.estimatedSpreadSlippage,
        estimatedFxImpact: accounting.estimatedFxImpact,
        netRealizedPnl: accounting.netRealizedPnl,
        exitReason: accounting.exitReason,
        holdingDurationMinutes: accounting.holdingDurationMinutes,
        strategy: accounting.strategy,
        confidenceAtEntry: accounting.confidenceAtEntry
      });

      let risk = refreshRiskPeriod(await this.getRiskState(userId));
      risk.dailyRealisedPnl += accounting.netRealizedPnl;
      risk.dailyUnrealisedPnl = 0;
      if (accounting.netRealizedPnl < 0) {
        risk.losingTradesToday += 1;
      }
      const hitLosing = risk.losingTradesToday >= limits.maxLosingTradesPerDay;
      const hitDailyLoss = risk.dailyRealisedPnl <= -Math.abs(limits.maxDailyLoss);
      if (hitLosing || hitDailyLoss) {
        risk.paused = true;
        risk.locked = true;
        risk.lockReason = hitDailyLoss ? "MAX_DAILY_LOSS" : "MAX_LOSING_TRADES";
      }
      risk.updatedAt = nowIso();
      this.risk.set(userId, risk);

      await this.setSymbolCooldown(userId, position.symbol, perSymbolCooldownUntil);
      if (lossCooldownUntil) {
        await this.setSymbolCooldown(userId, "__LOSS__", lossCooldownUntil);
      }
      this.exitReservations.delete(position.positionId);
      return true;
    });
  }

  async getDashboardSnapshot(userId: string): Promise<StockDashboardSnapshot> {
    const existing = this.dashboardSnapshots.get(userId);
    if (existing) return this.clone(existing);
    const created = emptyDashboardSnapshot(userId);
    this.dashboardSnapshots.set(userId, created);
    return this.clone(created);
  }

  async saveDashboardSnapshot(snapshot: StockDashboardSnapshot): Promise<void> {
    this.dashboardSnapshots.set(snapshot.userId, {
      ...this.clone(snapshot),
      updatedAt: nowIso()
    });
  }

  async listDueRetryJobs(nowMs = Date.now()): Promise<Array<{ userId: string; jobId: string }>> {
    const due: Array<{ userId: string; jobId: string }> = [];
    for (const [userId, jobs] of this.jobs.entries()) {
      for (const job of jobs) {
        if (
          job.state === "QUEUED" &&
          job.nextAttemptAt &&
          Date.parse(job.nextAttemptAt) <= nowMs
        ) {
          due.push({ userId, jobId: job.jobId });
        }
      }
    }
    return due;
  }
}
