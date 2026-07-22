/**
 * Firestore-backed Stocks Intraday store (Firebase Admin SDK only).
 */

import type { Firestore, Transaction } from "firebase-admin/firestore";
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
  isActiveReservationState,
  STOCK_JOB_LEASE_MS,
  STOCK_INTENT_LEASE_MS
} from "./stockIntradayStore";
import { randomUUID } from "crypto";

const stripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    );
  }
  return value;
};

function isLeaseExpired(leaseExpiresAt: string | null): boolean {
  if (!leaseExpiresAt) return true;
  return Date.now() > new Date(leaseExpiresAt).getTime();
}

function leaseExpiresFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

interface IdempotencyDoc {
  intentId: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export class FirestoreStockIntradayStore implements StockIntradayStorePort {
  constructor(private readonly db: Firestore) {}

  private userRoot(userId: string) {
    return this.db.collection("users").doc(userId).collection("stockIntraday");
  }

  private col(userId: string, name: string) {
    return this.userRoot(userId).doc("data").collection(name);
  }

  private settingsRef(userId: string) {
    return this.col(userId, "settings").doc("current");
  }

  private riskRef(userId: string) {
    return this.col(userId, "riskState").doc("current");
  }

  private restartGateRef(userId: string) {
    return this.col(userId, "restartGate").doc("current");
  }

  private dashboardRef(userId: string) {
    return this.col(userId, "dashboard").doc("current");
  }

  private retryIndexRef(userId: string, jobId: string) {
    return this.db.collection("stockIntradayRetryIndex").doc(sanitizeDocId(`${userId}_${jobId}`));
  }

  private intentRef(userId: string, intentId: string) {
    return this.col(userId, "intents").doc(intentId);
  }

  private idempotencyRef(userId: string, key: string) {
    return this.col(userId, "idempotency").doc(sanitizeDocId(key));
  }

  private alertIdRef(userId: string, alertId: string) {
    return this.col(userId, "alertIds").doc(alertId);
  }

  private signalRef(userId: string, alertId: string) {
    return this.col(userId, "signals").doc(alertId);
  }

  private positionRef(userId: string, positionId: string) {
    return this.col(userId, "positions").doc(positionId);
  }

  private jobRef(userId: string, jobId: string) {
    return this.col(userId, "jobs").doc(jobId);
  }

  private cashReservationRef(userId: string, intentId: string) {
    return this.col(userId, "reservations").doc(intentId);
  }

  private exitReservationRef(userId: string, positionId: string) {
    return this.col(userId, "exitReservations").doc(positionId);
  }

  private webhookRootRef(routingIdHash: string) {
    return this.db.collection("stockIntradayWebhookConnections").doc(routingIdHash);
  }

  private webhookMirrorRef(userId: string, routingIdHash: string) {
    return this.col(userId, "webhookConnections").doc(routingIdHash);
  }

  async getRiskState(userId: string): Promise<StockIntradayRiskState> {
    const snap = await this.riskRef(userId).get();
    if (!snap.exists) {
      const created = refreshRiskPeriod(createDefaultRisk(userId));
      await this.riskRef(userId).set(stripUndefined(created) as FirebaseFirestore.DocumentData);
      return created;
    }
    const state = refreshRiskPeriod(snap.data() as StockIntradayRiskState);
    if (state.dayKey !== (snap.data() as StockIntradayRiskState).dayKey) {
      await this.riskRef(userId).set(stripUndefined(state) as FirebaseFirestore.DocumentData, {
        merge: true
      });
    }
    return state;
  }

  async saveRiskState(state: StockIntradayRiskState): Promise<StockIntradayRiskState> {
    const next = { ...state, updatedAt: nowIso() };
    await this.riskRef(state.userId).set(stripUndefined(next) as FirebaseFirestore.DocumentData, {
      merge: true
    });
    return next;
  }

  async incrementDailyTradeCounters(
    userId: string,
    patch: { trades?: number; allocationUsed?: number; realisedPnl?: number }
  ): Promise<StockIntradayRiskState> {
    return this.db.runTransaction(async (tx: Transaction) => {
      const ref = this.riskRef(userId);
      const snap = await tx.get(ref);
      let state = snap.exists
        ? refreshRiskPeriod(snap.data() as StockIntradayRiskState)
        : refreshRiskPeriod(createDefaultRisk(userId));
      if (patch.trades) state.tradesUsedToday += patch.trades;
      if (patch.allocationUsed) state.dailyAllocationUsed += patch.allocationUsed;
      if (patch.realisedPnl) state.dailyRealisedPnl += patch.realisedPnl;
      state.updatedAt = nowIso();
      tx.set(ref, stripUndefined(state) as FirebaseFirestore.DocumentData, { merge: true });
      return state;
    });
  }

  async getSettings(userId: string): Promise<StockIntradaySettings> {
    const snap = await this.settingsRef(userId).get();
    if (!snap.exists) {
      const created = defaultSettings(userId);
      await this.settingsRef(userId).set(stripUndefined(created) as FirebaseFirestore.DocumentData);
      return created;
    }
    return snap.data() as StockIntradaySettings;
  }

  async saveSettings(settings: StockIntradaySettings): Promise<StockIntradaySettings> {
    const next = { ...settings, updatedAt: nowIso() };
    await this.settingsRef(settings.userId).set(
      stripUndefined(next) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
    return next;
  }

  async listPositions(userId: string): Promise<StockManagedPosition[]> {
    const snap = await this.col(userId, "positions").get();
    return snap.docs.map((d) => d.data() as StockManagedPosition);
  }

  async savePosition(position: StockManagedPosition): Promise<void> {
    await this.positionRef(position.userId, position.positionId).set(
      stripUndefined(position) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
  }

  async deletePosition(userId: string, positionId: string): Promise<void> {
    await Promise.all([
      this.positionRef(userId, positionId).delete(),
      this.exitReservationRef(userId, positionId).delete()
    ]);
  }

  async reservePositionSlot(position: StockManagedPosition): Promise<boolean> {
    return this.db.runTransaction(async (tx: Transaction) => {
      const positionsSnap = await tx.get(this.col(position.userId, "positions"));
      const hasSymbol = positionsSnap.docs.some(
        (d) => (d.data() as StockManagedPosition).symbol === position.symbol
      );
      if (hasSymbol) return false;
      tx.set(
        this.positionRef(position.userId, position.positionId),
        stripUndefined(position) as FirebaseFirestore.DocumentData
      );
      return true;
    });
  }

  async getIntent(userId: string, intentId: string): Promise<StockTradeIntent | null> {
    const snap = await this.intentRef(userId, intentId).get();
    return snap.exists ? (snap.data() as StockTradeIntent) : null;
  }

  async saveIntent(intent: StockTradeIntent): Promise<void> {
    const next = { ...intent, updatedAt: nowIso() };
    await this.intentRef(intent.userId, intent.intentId).set(
      stripUndefined(next) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
  }

  async listOpenIntents(userId: string): Promise<StockTradeIntent[]> {
    const snap = await this.col(userId, "intents").get();
    return snap.docs
      .map((d) => d.data() as StockTradeIntent)
      .filter((intent) => !isTerminalState(intent.state));
  }

  async listUnresolvedIntents(userId: string): Promise<StockTradeIntent[]> {
    return this.listOpenIntents(userId);
  }

  async listActiveEntryReservations(userId: string): Promise<StockTradeIntent[]> {
    const snap = await this.col(userId, "intents").get();
    return snap.docs
      .map((d) => d.data() as StockTradeIntent)
      .filter((intent) => isActiveReservationState(intent.entryReservationState));
  }

  async reserveIntent(intent: StockTradeIntent, idempotencyKey: string): Promise<ReserveIntentResult> {
    const idemRef = this.idempotencyRef(intent.userId, idempotencyKey);
    const intentRef = this.intentRef(intent.userId, intent.intentId);

    return this.db.runTransaction(async (tx: Transaction) => {
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) {
        const existing = idemSnap.data() as IdempotencyDoc;
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

      const toSave: StockTradeIntent = {
        ...intent,
        leaseOwner,
        leaseExpiresAt,
        updatedAt: nowIso()
      };

      tx.set(intentRef, stripUndefined(toSave) as FirebaseFirestore.DocumentData);
      tx.set(idemRef, {
        intentId: intent.intentId,
        leaseOwner,
        leaseExpiresAt,
        updatedAt: nowIso()
      });
      return "reserved";
    });
  }

  async reserveExit(userId: string, positionId: string, reason: string): Promise<boolean> {
    const ref = this.exitReservationRef(userId, positionId);
    return this.db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, {
        userId,
        positionId,
        reason,
        createdAt: nowIso()
      });
      return true;
    });
  }

  async releaseExitReservation(userId: string, positionId: string): Promise<void> {
    await this.exitReservationRef(userId, positionId).delete();
  }

  async hasAlertId(userId: string, alertId: string): Promise<boolean> {
    const alertSnap = await this.alertIdRef(userId, alertId).get();
    if (alertSnap.exists) return true;
    const signalSnap = await this.signalRef(userId, alertId).get();
    return signalSnap.exists;
  }

  async reserveAlert(
    userId: string,
    alertId: string,
    signal: StockSignalRecord
  ): Promise<ReserveAlertResult> {
    const alertRef = this.alertIdRef(userId, alertId);
    const signalDocRef = this.signalRef(userId, alertId);

    return this.db.runTransaction(async (tx: Transaction) => {
      const alertSnap = await tx.get(alertRef);
      const signalSnap = await tx.get(signalDocRef);
      if (alertSnap.exists || signalSnap.exists) return "duplicate";
      tx.set(alertRef, { alertId, userId, createdAt: nowIso() });
      tx.set(signalDocRef, stripUndefined({ ...signal, updatedAt: nowIso() }) as FirebaseFirestore.DocumentData);
      return "reserved";
    });
  }

  async saveSignal(record: StockSignalRecord): Promise<void> {
    await this.signalRef(record.userId, record.alertId).set(
      stripUndefined({ ...record, updatedAt: nowIso() }) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
    await this.alertIdRef(record.userId, record.alertId).set(
      { alertId: record.alertId, userId: record.userId, createdAt: nowIso() },
      { merge: true }
    );
  }

  async getSignalByAlertId(userId: string, alertId: string): Promise<StockSignalRecord | null> {
    const snap = await this.signalRef(userId, alertId).get();
    return snap.exists ? (snap.data() as StockSignalRecord) : null;
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
    await this.jobRef(job.userId, job.jobId).set(
      stripUndefined(created) as FirebaseFirestore.DocumentData
    );
    return created;
  }

  async getJob(userId: string, jobId: string): Promise<StockIntradayJob | null> {
    const snap = await this.jobRef(userId, jobId).get();
    return snap.exists ? (snap.data() as StockIntradayJob) : null;
  }

  async claimJob(
    userId: string,
    jobId: string,
    ownerId: string,
    leaseMs = STOCK_JOB_LEASE_MS
  ): Promise<StockIntradayJob | null> {
    const ref = this.jobRef(userId, jobId);
    return this.db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const job = snap.data() as StockIntradayJob;
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
      const next: StockIntradayJob = {
        ...job,
        state: "PROCESSING",
        leaseOwner: ownerId,
        leaseExpiresAt: leaseExpiresFromNow(leaseMs),
        attemptCount: job.attemptCount + 1,
        updatedAt: nowIso()
      };
      tx.set(ref, stripUndefined(next) as FirebaseFirestore.DocumentData, { merge: true });
      tx.delete(this.retryIndexRef(userId, jobId));
      return next;
    });
  }

  async completeJob(userId: string, jobId: string): Promise<StockIntradayJob | null> {
    const ref = this.jobRef(userId, jobId);
    return this.db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const job = snap.data() as StockIntradayJob;
      const next: StockIntradayJob = {
        ...job,
        state: "COMPLETED",
        completedAt: nowIso(),
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastError: null,
        updatedAt: nowIso()
      };
      tx.set(ref, stripUndefined(next) as FirebaseFirestore.DocumentData, { merge: true });
      tx.delete(this.retryIndexRef(userId, jobId));
      return next;
    });
  }

  async failJob(userId: string, jobId: string, error: string): Promise<StockIntradayJob | null> {
    const ref = this.jobRef(userId, jobId);
    return this.db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const job = snap.data() as StockIntradayJob;
      const exhausted = job.attemptCount >= job.maxAttempts;
      const nextAttemptAt = exhausted
        ? null
        : new Date(Date.now() + jobRetryBackoffMs(job.attemptCount)).toISOString();
      const next: StockIntradayJob = {
        ...job,
        state: exhausted ? "DEAD_LETTER" : "QUEUED",
        lastError: error,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt,
        updatedAt: nowIso()
      };
      tx.set(ref, stripUndefined(next) as FirebaseFirestore.DocumentData, { merge: true });
      const retryRef = this.retryIndexRef(userId, jobId);
      if (!exhausted && nextAttemptAt) {
        tx.set(retryRef, {
          userId,
          jobId,
          nextAttemptAt,
          state: "QUEUED"
        });
      } else {
        tx.delete(retryRef);
      }
      return next;
    });
  }

  async reserveCash(userId: string, intentId: string, amount: number): Promise<boolean> {
    const ref = this.cashReservationRef(userId, intentId);
    return this.db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = snap.data() as StockCashReservation;
        if (!existing.released) return false;
      }
      const reservation: StockCashReservation = {
        reservationId: intentId,
        userId,
        intentId,
        amount,
        released: false,
        createdAt: nowIso(),
        state: "RESERVED"
      };
      tx.set(ref, stripUndefined(reservation) as FirebaseFirestore.DocumentData);
      return true;
    });
  }

  async releaseCash(userId: string, intentId: string): Promise<void> {
    const ref = this.cashReservationRef(userId, intentId);
    await ref.set({ released: true, updatedAt: nowIso() }, { merge: true });
  }

  async getReservedCashTotal(userId: string): Promise<number> {
    const snap = await this.col(userId, "reservations").where("released", "==", false).get();
    return snap.docs.reduce((sum, d) => sum + Number((d.data() as StockCashReservation).amount ?? 0), 0);
  }

  async appendActivity(
    userId: string,
    entry: Omit<StockIntradayActivityEntry, "id"> & { id?: string }
  ): Promise<void> {
    const id = entry.id ?? this.db.collection("_").doc().id;
    await this.col(userId, "activity")
      .doc(id)
      .set(
        stripUndefined({
          id,
          at: entry.at,
          message: entry.message,
          level: entry.level
        }) as FirebaseFirestore.DocumentData
      );
  }

  async listActivity(userId: string, limit = 50): Promise<StockIntradayActivityEntry[]> {
    const snap = await this.col(userId, "activity").orderBy("at", "desc").limit(limit).get();
    return snap.docs.map((d) => d.data() as StockIntradayActivityEntry);
  }

  async appendAudit(
    entry: Omit<StockIntradayAuditEntry, "id" | "at"> & { id?: string; at?: string }
  ): Promise<void> {
    const id = entry.id ?? this.db.collection("_").doc().id;
    await this.col(entry.userId, "audit")
      .doc(id)
      .set(
        stripUndefined({
          id,
          userId: entry.userId,
          at: entry.at ?? nowIso(),
          action: entry.action,
          detail: entry.detail
        }) as FirebaseFirestore.DocumentData
      );
  }

  async getSymbolCooldown(userId: string, symbol: string): Promise<string | null> {
    const snap = await this.col(userId, "cooldowns").doc(symbol.toUpperCase()).get();
    if (!snap.exists) return null;
    return String((snap.data() as { untilIso?: string }).untilIso ?? "") || null;
  }

  async setSymbolCooldown(userId: string, symbol: string, untilIso: string): Promise<void> {
    await this.col(userId, "cooldowns")
      .doc(symbol.toUpperCase())
      .set({ symbol: symbol.toUpperCase(), untilIso, updatedAt: nowIso() });
  }

  async listShadowTrades(userId: string): Promise<StockShadowTradeRecord[]> {
    const snap = await this.col(userId, "shadowTrades").orderBy("at", "desc").limit(200).get();
    return snap.docs.map((d) => d.data() as StockShadowTradeRecord);
  }

  async appendShadowTrade(
    userId: string,
    trade: Omit<StockShadowTradeRecord, "id"> & { id?: string }
  ): Promise<void> {
    const id = trade.id ?? this.db.collection("_").doc().id;
    await this.col(userId, "shadowTrades")
      .doc(id)
      .set(
        stripUndefined({
          ...trade,
          id,
          at: trade.at ?? nowIso()
        }) as FirebaseFirestore.DocumentData
      );
  }

  async getRestartGate(userId: string): Promise<StockRestartGate> {
    const snap = await this.restartGateRef(userId).get();
    if (!snap.exists) {
      const created = defaultRestartGate(userId);
      await this.restartGateRef(userId).set(stripUndefined(created) as FirebaseFirestore.DocumentData);
      return created;
    }
    return snap.data() as StockRestartGate;
  }

  async saveRestartGate(gate: StockRestartGate): Promise<void> {
    await this.restartGateRef(gate.userId).set(
      stripUndefined({ ...gate, updatedAt: nowIso() }) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
  }

  async saveReconciliation(record: StockReconciliationRecord): Promise<void> {
    await this.col(record.userId, "reconciliation")
      .doc(record.id)
      .set(stripUndefined({ ...record, updatedAt: nowIso() }) as FirebaseFirestore.DocumentData, {
        merge: true
      });
  }

  async listPendingReconciliation(userId: string): Promise<StockReconciliationRecord[]> {
    const snap = await this.col(userId, "reconciliation").where("status", "==", "PENDING").get();
    return snap.docs.map((d) => d.data() as StockReconciliationRecord);
  }

  async getWebhookConnection(connectionId: string): Promise<StockWebhookConnection | null> {
    const hash = hashRoutingId(connectionId);
    const snap = await this.webhookRootRef(hash).get();
    if (!snap.exists) return null;
    const data = snap.data() as Omit<StockWebhookConnection, "connectionId">;
    // Hydrate routing id for in-process use only — never read plaintext from storage.
    return { ...data, routingIdHash: hash, connectionId };
  }

  async saveWebhookConnection(conn: StockWebhookConnection): Promise<void> {
    const hash = conn.routingIdHash || (conn.connectionId ? hashRoutingId(conn.connectionId) : "");
    if (!hash) {
      throw new Error("WEBHOOK_ROUTING_HASH_REQUIRED");
    }
    const {
      connectionId: _omitConnectionId,
      ...persistable
    } = conn;
    void _omitConnectionId;
    const payload = stripUndefined({
      ...persistable,
      routingIdHash: hash
    }) as FirebaseFirestore.DocumentData;
    // Explicitly ensure plaintext routing id is never written.
    delete payload.connectionId;
    await this.webhookRootRef(hash).set(payload, { merge: true });
    await this.webhookMirrorRef(conn.userId, hash).set(payload, { merge: true });
  }

  async touchWebhookConnectionUse(connectionId: string): Promise<StockWebhookConnection | null> {
    const hash = hashRoutingId(connectionId);
    return this.db.runTransaction(async (tx: Transaction) => {
      const ref = this.webhookRootRef(hash);
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const existing = snap.data() as Omit<StockWebhookConnection, "connectionId">;
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
      const updated = {
        ...existing,
        routingIdHash: hash,
        lastUsedAt: now,
        rateCount,
        rateWindowStart,
        updatedAt: now
      };
      const payload = stripUndefined(updated) as FirebaseFirestore.DocumentData;
      delete payload.connectionId;
      tx.set(ref, payload, { merge: true });
      tx.set(this.webhookMirrorRef(existing.userId, hash), payload, { merge: true });
      return { ...updated, connectionId };
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
    return updated;
  }

  async listWebhookConnections(userId: string): Promise<StockWebhookConnection[]> {
    const snap = await this.col(userId, "webhookConnections").get();
    return snap.docs.map((d) => d.data() as StockWebhookConnection);
  }

  async registerSchedulerUser(userId: string): Promise<void> {
    await this.db
      .collection("stockIntradaySchedulerUsers")
      .doc(userId)
      .set({ userId, updatedAt: nowIso() }, { merge: true });
  }

  async listSchedulerUserIds(): Promise<string[]> {
    const snap = await this.db.collection("stockIntradaySchedulerUsers").get();
    return snap.docs.map((d) => d.id);
  }

  async reserveEntryAtomically(input: AtomicEntryReservationInput): Promise<AtomicEntryReservationResult> {
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

    const idemRef = this.idempotencyRef(userId, idempotencyKey);
    const intentRef = this.intentRef(userId, intent.intentId);
    const cashRef = this.cashReservationRef(userId, intent.intentId);
    const riskRef = this.riskRef(userId);
    const positionsCol = this.col(userId, "positions");
    const intentsCol = this.col(userId, "intents");
    const reservationsCol = this.col(userId, "reservations");

    return this.db.runTransaction(async (tx: Transaction) => {
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) {
        return { ok: false as const, code: "DUPLICATE_INTENT" };
      }

      const positionsSnap = await tx.get(positionsCol);
      const positions = positionsSnap.docs.map((d) => d.data() as StockManagedPosition);
      const intentsSnap = await tx.get(intentsCol);
      const pending = intentsSnap.docs
        .map((d) => d.data() as StockTradeIntent)
        .filter((i) => isActiveReservationState(i.entryReservationState));

      if (positions.some((p) => p.symbol === intent.symbol) || pending.some((p) => p.symbol === intent.symbol)) {
        return { ok: false as const, code: "SYMBOL_POSITION_EXISTS" };
      }

      if (positions.length + pending.length >= limits.maxSimultaneousPositions) {
        return { ok: false as const, code: "MAX_POSITIONS" };
      }

      const riskSnap = await tx.get(riskRef);
      let risk = riskSnap.exists
        ? refreshRiskPeriod(riskSnap.data() as StockIntradayRiskState)
        : refreshRiskPeriod(createDefaultRisk(userId));

      if (risk.tradesUsedToday >= limits.maxTradesPerDay) {
        return { ok: false as const, code: "DAILY_TRADE_LIMIT" };
      }

      const dailyAllocationRemaining = limits.dailyCapitalAllocation - risk.dailyAllocationUsed;
      if (dailyAllocationRemaining < cashAmount) {
        return { ok: false as const, code: "DAILY_ALLOCATION_EXCEEDED" };
      }

      const reservationsSnap = await tx.get(reservationsCol.where("released", "==", false));
      const currentReservedCash = reservationsSnap.docs.reduce(
        (sum, d) => sum + Number((d.data() as StockCashReservation).amount ?? 0),
        0
      );
      if (availableCashFromBroker - currentReservedCash - cashAmount < limits.minCashReserve) {
        return { ok: false as const, code: "CASH_RESERVE" };
      }

      const pendingExposure = pending.reduce((s, i) => s + i.reservedCash, 0);
      const portfolioExposure =
        positions.reduce((s, p) => s + p.quantity * p.entryPrice, 0) + pendingExposure;
      if (portfolioExposure + cashAmount > limits.maxPortfolioExposure) {
        return { ok: false as const, code: "PORTFOLIO_EXPOSURE" };
      }

      const symbolExposure =
        positions
          .filter((p) => p.symbol === intent.symbol)
          .reduce((s, p) => s + p.quantity * p.entryPrice, 0) +
        pending
          .filter((p) => p.symbol === intent.symbol)
          .reduce((s, i) => s + i.reservedCash, 0);
      if (symbolExposure + cashAmount > limits.maxExposurePerSymbol) {
        return { ok: false as const, code: "SYMBOL_EXPOSURE" };
      }

      const shouldOpen = openShadowPosition && position != null;
      const shouldReservePending = Boolean(reservePendingCapacity) && !shouldOpen;
      const reservationState: EntryReservationState = shouldOpen ? "FILLED" : "RESERVED";

      const finalIntent: StockTradeIntent = {
        ...intent,
        state: shouldOpen ? "OPEN" : intent.state,
        entryReservationState: reservationState,
        updatedAt: nowIso()
      };

      const leaseOwner = intent.leaseOwner;
      const leaseExpiresAt =
        intent.leaseExpiresAt ??
        (leaseOwner ? leaseExpiresFromNow(STOCK_INTENT_LEASE_MS) : null);

      tx.set(intentRef, stripUndefined(finalIntent) as FirebaseFirestore.DocumentData);
      tx.set(idemRef, {
        intentId: intent.intentId,
        leaseOwner,
        leaseExpiresAt,
        updatedAt: nowIso()
      });

      const reservation: StockCashReservation = {
        reservationId: intent.intentId,
        userId,
        intentId: intent.intentId,
        amount: cashAmount,
        released: false,
        createdAt: nowIso(),
        state: reservationState
      };
      tx.set(cashRef, stripUndefined(reservation) as FirebaseFirestore.DocumentData);

      let savedPosition: StockManagedPosition | null = null;
      if (shouldOpen && position) {
        tx.set(
          this.positionRef(userId, position.positionId),
          stripUndefined(position) as FirebaseFirestore.DocumentData
        );
        savedPosition = position;
      }

      if (shouldOpen || shouldReservePending) {
        risk.tradesUsedToday += 1;
        risk.dailyAllocationUsed += cashAmount;
        risk.updatedAt = nowIso();
        tx.set(riskRef, stripUndefined(risk) as FirebaseFirestore.DocumentData, { merge: true });
      }

      return {
        ok: true as const,
        intent: finalIntent,
        position: savedPosition,
        reservationState
      };
    });
  }

  async releaseEntryReservationAtomically(input: ReleaseEntryReservationInput): Promise<boolean> {
    const { userId, intentId, reverseDailyCounters, nextState, blockReason } = input;
    const intentRef = this.intentRef(userId, intentId);
    const cashRef = this.cashReservationRef(userId, intentId);
    const riskRef = this.riskRef(userId);

    return this.db.runTransaction(async (tx: Transaction) => {
      const intentSnap = await tx.get(intentRef);
      if (!intentSnap.exists) return false;
      const intent = intentSnap.data() as StockTradeIntent;
      if (intent.entryReservationState === "FILLED") return false;
      const wasActive = isActiveReservationState(intent.entryReservationState);
      const cashAmount = intent.reservedCash;

      tx.set(
        intentRef,
        stripUndefined({
          ...intent,
          state: nextState === "CANCELLED" ? "CANCELLED" : intent.state,
          entryReservationState: nextState,
          blockReason: blockReason ?? intent.blockReason,
          updatedAt: nowIso()
        }) as FirebaseFirestore.DocumentData,
        { merge: true }
      );

      const cashSnap = await tx.get(cashRef);
      if (cashSnap.exists) {
        const cash = cashSnap.data() as StockCashReservation;
        tx.set(
          cashRef,
          stripUndefined({ ...cash, released: true, state: nextState }) as FirebaseFirestore.DocumentData,
          { merge: true }
        );
      }

      if (reverseDailyCounters && wasActive) {
        const riskSnap = await tx.get(riskRef);
        let risk = riskSnap.exists
          ? refreshRiskPeriod(riskSnap.data() as StockIntradayRiskState)
          : refreshRiskPeriod(createDefaultRisk(userId));
        risk.tradesUsedToday = Math.max(0, risk.tradesUsedToday - 1);
        risk.dailyAllocationUsed = Math.max(0, risk.dailyAllocationUsed - cashAmount);
        risk.updatedAt = nowIso();
        tx.set(riskRef, stripUndefined(risk) as FirebaseFirestore.DocumentData, { merge: true });
      }
      return true;
    });
  }

  async finalizeEntryFillAtomically(input: FinalizeEntryFillInput): Promise<boolean> {
    const { userId, intentId, position } = input;
    const intentRef = this.intentRef(userId, intentId);
    const cashRef = this.cashReservationRef(userId, intentId);
    const positionRef = this.positionRef(userId, position.positionId);

    return this.db.runTransaction(async (tx: Transaction) => {
      const intentSnap = await tx.get(intentRef);
      if (!intentSnap.exists) return false;
      const intent = intentSnap.data() as StockTradeIntent;
      if (intent.entryReservationState === "FILLED") return true;
      if (!isActiveReservationState(intent.entryReservationState)) return false;

      tx.set(
        intentRef,
        stripUndefined({
          ...intent,
          state: "OPEN",
          entryReservationState: "FILLED",
          filledQuantity: position.quantity,
          averageFillPrice: position.entryPrice,
          updatedAt: nowIso()
        }) as FirebaseFirestore.DocumentData,
        { merge: true }
      );
      tx.set(positionRef, stripUndefined(position) as FirebaseFirestore.DocumentData);
      const cashSnap = await tx.get(cashRef);
      if (cashSnap.exists) {
        const cash = cashSnap.data() as StockCashReservation;
        tx.set(
          cashRef,
          stripUndefined({ ...cash, state: "FILLED" }) as FirebaseFirestore.DocumentData,
          { merge: true }
        );
      }
      return true;
    });
  }

  async closeShadowPositionAtomically(input: CloseShadowPositionInput): Promise<boolean> {
    const { userId, position, accounting, limits, perSymbolCooldownUntil, lossCooldownUntil } =
      input;
    const positionRef = this.positionRef(userId, position.positionId);
    const intentRef = this.intentRef(userId, position.intentId);
    const cashRef = this.cashReservationRef(userId, position.intentId);
    const riskRef = this.riskRef(userId);
    const exitRef = this.exitReservationRef(userId, position.positionId);
    const cooldownRef = this.col(userId, "cooldowns").doc(position.symbol.toUpperCase());
    const lossCooldownRef = this.col(userId, "cooldowns").doc("__LOSS__");
    const shadowRef = this.col(userId, "shadowTrades").doc(randomUUID());

    return this.db.runTransaction(async (tx: Transaction) => {
      const posSnap = await tx.get(positionRef);
      if (!posSnap.exists) return false;

      const intentSnap = await tx.get(intentRef);
      if (intentSnap.exists) {
        const intent = intentSnap.data() as StockTradeIntent;
        tx.set(
          intentRef,
          stripUndefined({
            ...intent,
            state: "CLOSED",
            exitReason: accounting.exitReason,
            entryReservationState: "RELEASED",
            updatedAt: nowIso()
          }) as FirebaseFirestore.DocumentData,
          { merge: true }
        );
      }

      tx.delete(positionRef);

      const cashSnap = await tx.get(cashRef);
      if (cashSnap.exists) {
        const cash = cashSnap.data() as StockCashReservation;
        tx.set(
          cashRef,
          stripUndefined({ ...cash, released: true, state: "RELEASED" }) as FirebaseFirestore.DocumentData,
          { merge: true }
        );
      }

      tx.set(
        shadowRef,
        stripUndefined({
          id: shadowRef.id,
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
        }) as FirebaseFirestore.DocumentData
      );

      const riskSnap = await tx.get(riskRef);
      let risk = riskSnap.exists
        ? refreshRiskPeriod(riskSnap.data() as StockIntradayRiskState)
        : refreshRiskPeriod(createDefaultRisk(userId));
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
      tx.set(riskRef, stripUndefined(risk) as FirebaseFirestore.DocumentData, { merge: true });

      tx.set(cooldownRef, {
        symbol: position.symbol.toUpperCase(),
        untilIso: perSymbolCooldownUntil,
        updatedAt: nowIso()
      });
      if (lossCooldownUntil) {
        tx.set(lossCooldownRef, {
          symbol: "__LOSS__",
          untilIso: lossCooldownUntil,
          updatedAt: nowIso()
        });
      }
      tx.delete(exitRef);
      return true;
    });
  }

  async getDashboardSnapshot(userId: string): Promise<StockDashboardSnapshot> {
    const snap = await this.dashboardRef(userId).get();
    if (!snap.exists) {
      const created = emptyDashboardSnapshot(userId);
      await this.dashboardRef(userId).set(stripUndefined(created) as FirebaseFirestore.DocumentData);
      return created;
    }
    return snap.data() as StockDashboardSnapshot;
  }

  async saveDashboardSnapshot(snapshot: StockDashboardSnapshot): Promise<void> {
    const next = { ...snapshot, updatedAt: nowIso() };
    await this.dashboardRef(snapshot.userId).set(
      stripUndefined(next) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
  }

  async listDueRetryJobs(nowMs = Date.now()): Promise<Array<{ userId: string; jobId: string }>> {
    const nowIsoStr = new Date(nowMs).toISOString();
    const snap = await this.db
      .collection("stockIntradayRetryIndex")
      .where("state", "==", "QUEUED")
      .where("nextAttemptAt", "<=", nowIsoStr)
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as { userId: string; jobId: string };
      return { userId: data.userId, jobId: data.jobId };
    });
  }
}
