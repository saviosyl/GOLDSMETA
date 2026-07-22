/**
 * Firestore-backed AutoTrade store (Firebase Admin SDK only).
 * Client writes are forbidden by firestore.rules.
 */

import type { Firestore, Transaction } from "firebase-admin/firestore";
import type {
  AutoTradeActivityEntry,
  AutoTradeAuditEntry,
  AutoTradePositionView,
  AutoTradeRiskState,
  AutoTradeSettings,
  BrokerExecutionRecord,
  TradeIntent
} from "./types";
import { nowIso } from "../../utils/time";
import {
  type AutoTradeStorePort,
  type BrokerConnectionDoc,
  type AutoTradeLockDoc,
  type BrokerEventDoc,
  type ClaimIntentInput,
  type ClaimIntentResult,
  INTENT_LEASE_MS,
  applyLease,
  createDefaultRiskState,
  defaultConnection,
  defaultLock,
  defaultSettings,
  isLeaseExpired,
  isTerminalIntentState
} from "./autoTradeStore";

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

export class FirestoreAutoTradeStore implements AutoTradeStorePort {
  constructor(private readonly db: Firestore) {}

  private userCol(userId: string, name: string) {
    return this.db.collection("users").doc(userId).collection(name);
  }

  private riskRef(userId: string) {
    return this.userCol(userId, "autoTradeRiskState").doc("current");
  }

  private settingsRef(userId: string) {
    return this.userCol(userId, "brokerSettings").doc("current");
  }

  private connectionRef(userId: string) {
    return this.userCol(userId, "brokerConnections").doc("current");
  }

  private lockRef(userId: string) {
    return this.userCol(userId, "autoTradeLocks").doc("current");
  }

  private intentRef(userId: string, intentId: string) {
    return this.userCol(userId, "tradeIntents").doc(intentId);
  }

  private dealRefIndex(userId: string, dealReference: string) {
    // Deterministic doc id from deal reference (already URL-safe-ish)
    const safe = dealReference.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 700);
    return this.userCol(userId, "tradeIntentDealRefs").doc(safe);
  }

  async getRiskState(userId: string): Promise<AutoTradeRiskState> {
    const snap = await this.riskRef(userId).get();
    if (!snap.exists) {
      const created = createDefaultRiskState(userId);
      await this.riskRef(userId).set(stripUndefined(created) as FirebaseFirestore.DocumentData);
      return created;
    }
    return snap.data() as AutoTradeRiskState;
  }

  async saveRiskState(state: AutoTradeRiskState): Promise<AutoTradeRiskState> {
    await this.riskRef(state.userId).set(stripUndefined(state) as FirebaseFirestore.DocumentData, {
      merge: true
    });
    return state;
  }

  async getSettings(userId: string): Promise<AutoTradeSettings> {
    const snap = await this.settingsRef(userId).get();
    if (!snap.exists) {
      const created = defaultSettings(userId);
      await this.settingsRef(userId).set(stripUndefined(created) as FirebaseFirestore.DocumentData);
      return created;
    }
    return snap.data() as AutoTradeSettings;
  }

  async saveSettings(settings: AutoTradeSettings): Promise<AutoTradeSettings> {
    await this.settingsRef(settings.userId).set(
      stripUndefined(settings) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
    return settings;
  }

  async getConnection(userId: string): Promise<BrokerConnectionDoc> {
    const snap = await this.connectionRef(userId).get();
    if (!snap.exists) {
      const created = defaultConnection(userId);
      await this.connectionRef(userId).set(stripUndefined(created) as FirebaseFirestore.DocumentData);
      return created;
    }
    const data = snap.data() as BrokerConnectionDoc;
    return {
      ...defaultConnection(userId),
      ...data
    };
  }

  async saveConnection(doc: BrokerConnectionDoc): Promise<BrokerConnectionDoc> {
    await this.connectionRef(doc.userId).set(stripUndefined(doc) as FirebaseFirestore.DocumentData, {
      merge: true
    });
    return doc;
  }

  async getLock(userId: string): Promise<AutoTradeLockDoc> {
    const snap = await this.lockRef(userId).get();
    if (!snap.exists) {
      const created = defaultLock(userId);
      await this.lockRef(userId).set(stripUndefined(created) as FirebaseFirestore.DocumentData);
      return created;
    }
    return snap.data() as AutoTradeLockDoc;
  }

  async saveLock(doc: AutoTradeLockDoc): Promise<AutoTradeLockDoc> {
    await this.lockRef(doc.userId).set(stripUndefined(doc) as FirebaseFirestore.DocumentData, {
      merge: true
    });
    return doc;
  }

  async getIntentByDealReference(
    userId: string,
    dealReference: string
  ): Promise<TradeIntent | null> {
    const idx = await this.dealRefIndex(userId, dealReference).get();
    if (!idx.exists) return null;
    const intentId = String((idx.data() as { intentId?: string }).intentId ?? "");
    if (!intentId) return null;
    return this.getIntent(userId, intentId);
  }

  async getIntent(userId: string, intentId: string): Promise<TradeIntent | null> {
    const snap = await this.intentRef(userId, intentId).get();
    return snap.exists ? (snap.data() as TradeIntent) : null;
  }

  async saveIntent(intent: TradeIntent): Promise<TradeIntent> {
    await this.intentRef(intent.userId, intent.intentId).set(
      stripUndefined(intent) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
    if (intent.dealReference) {
      await this.dealRefIndex(intent.userId, intent.dealReference).set(
        {
          intentId: intent.intentId,
          dealReference: intent.dealReference,
          updatedAt: nowIso()
        },
        { merge: true }
      );
    }
    return intent;
  }

  async listIntents(userId: string, limit = 50): Promise<TradeIntent[]> {
    const snap = await this.userCol(userId, "tradeIntents")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as TradeIntent);
  }

  async claimIntent(input: ClaimIntentInput): Promise<ClaimIntentResult> {
    const leaseMs = input.leaseMs ?? INTENT_LEASE_MS;
    const indexRef = this.dealRefIndex(input.userId, input.dealReference);

    return this.db.runTransaction(async (tx: Transaction) => {
      const idxSnap = await tx.get(indexRef);
      if (idxSnap.exists) {
        const intentId = String((idxSnap.data() as { intentId?: string }).intentId ?? "");
        const intentSnap = await tx.get(this.intentRef(input.userId, intentId));
        if (intentSnap.exists) {
          const existing = intentSnap.data() as TradeIntent;
          if (isTerminalIntentState(existing.state)) {
            return { status: "duplicate" as const, intent: existing };
          }
          if (
            existing.leaseOwnerId &&
            !isLeaseExpired(existing) &&
            existing.leaseOwnerId !== input.ownerId
          ) {
            return { status: "lease_held" as const, intent: existing };
          }
          const claimed = applyLease(existing, input.ownerId, leaseMs);
          tx.set(this.intentRef(input.userId, claimed.intentId), stripUndefined(claimed) as FirebaseFirestore.DocumentData, {
            merge: true
          });
          return { status: "claimed" as const, intent: claimed };
        }
      }

      const created = applyLease(input.create(), input.ownerId, leaseMs);
      if (!created.dealReference) created.dealReference = input.dealReference;
      tx.set(
        this.intentRef(input.userId, created.intentId),
        stripUndefined(created) as FirebaseFirestore.DocumentData
      );
      tx.set(indexRef, {
        intentId: created.intentId,
        dealReference: input.dealReference,
        updatedAt: nowIso()
      });
      return { status: "claimed" as const, intent: created };
    });
  }

  async heartbeatIntentLease(
    userId: string,
    intentId: string,
    ownerId: string,
    leaseMs = INTENT_LEASE_MS
  ): Promise<TradeIntent | null> {
    const ref = this.intentRef(userId, intentId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const intent = snap.data() as TradeIntent;
      if (intent.leaseOwnerId !== ownerId) return null;
      const next = applyLease(intent, ownerId, leaseMs);
      tx.set(ref, stripUndefined(next) as FirebaseFirestore.DocumentData, { merge: true });
      return next;
    });
  }

  async releaseIntentLease(userId: string, intentId: string, ownerId: string): Promise<void> {
    const ref = this.intentRef(userId, intentId);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const intent = snap.data() as TradeIntent;
      if (intent.leaseOwnerId !== ownerId) return;
      tx.set(
        ref,
        {
          leaseOwnerId: null,
          leaseExpiresAt: null,
          leaseHeartbeatAt: null,
          updatedAt: nowIso()
        },
        { merge: true }
      );
    });
  }

  async saveExecution(exec: BrokerExecutionRecord): Promise<BrokerExecutionRecord> {
    await this.userCol(exec.userId, "brokerExecutions")
      .doc(exec.executionId)
      .set(stripUndefined(exec) as FirebaseFirestore.DocumentData);
    return exec;
  }

  async listExecutions(userId: string, limit = 50): Promise<BrokerExecutionRecord[]> {
    const snap = await this.userCol(userId, "brokerExecutions")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as BrokerExecutionRecord);
  }

  async savePosition(userId: string, position: AutoTradePositionView): Promise<void> {
    await this.userCol(userId, "brokerPositions")
      .doc(position.positionId)
      .set(stripUndefined({ ...position, userId }) as FirebaseFirestore.DocumentData, { merge: true });
  }

  async listPositions(userId: string): Promise<AutoTradePositionView[]> {
    const snap = await this.userCol(userId, "brokerPositions").limit(50).get();
    return snap.docs.map((d) => d.data() as AutoTradePositionView);
  }

  async appendBrokerEvent(event: BrokerEventDoc): Promise<void> {
    await this.userCol(event.userId, "brokerEvents")
      .doc(event.id)
      .set(stripUndefined(event) as FirebaseFirestore.DocumentData);
  }

  async listBrokerEvents(userId: string, limit = 50): Promise<BrokerEventDoc[]> {
    const snap = await this.userCol(userId, "brokerEvents").orderBy("at", "desc").limit(limit).get();
    return snap.docs.map((d) => d.data() as BrokerEventDoc);
  }

  async appendActivity(userId: string, entry: AutoTradeActivityEntry): Promise<void> {
    await this.userCol(userId, "autoTradeActivity")
      .doc(entry.id)
      .set(stripUndefined(entry) as FirebaseFirestore.DocumentData);
  }

  async listActivity(userId: string, limit = 50): Promise<AutoTradeActivityEntry[]> {
    const snap = await this.userCol(userId, "autoTradeActivity")
      .orderBy("at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as AutoTradeActivityEntry);
  }

  async appendAudit(entry: AutoTradeAuditEntry): Promise<void> {
    await this.userCol(entry.userId, "autoTradeAudit")
      .doc(entry.id)
      .set(stripUndefined(entry) as FirebaseFirestore.DocumentData);
  }

  async listAudit(userId: string, limit = 50): Promise<AutoTradeAuditEntry[]> {
    const snap = await this.userCol(userId, "autoTradeAudit")
      .orderBy("at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as AutoTradeAuditEntry);
  }
}
