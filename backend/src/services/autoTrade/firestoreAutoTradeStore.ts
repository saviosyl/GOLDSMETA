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
import type {
  BrokerSelectionDoc,
  T212ExecutionProposal,
  T212SelectedInstrument
} from "./t212/types";
import type {
  PracticeAutoQualificationState,
  T212AutomationMode,
  T212OrderIntent
} from "./t212/orderIntent";
import { isUnresolvedIntentState } from "./t212/orderIntent";
import { defaultQualificationState } from "./t212/qualification";
import { nowIso } from "../../utils/time";
import {
  type AutoTradeStorePort,
  type BrokerConnectionDoc,
  type AutoTradeLockDoc,
  type BrokerEventDoc,
  type ClaimIntentInput,
  type ClaimIntentResult,
  type ClaimT212OrderIntentInput,
  type ClaimT212OrderIntentResult,
  INTENT_LEASE_MS,
  applyLease,
  createDefaultRiskState,
  defaultBrokerSelection,
  defaultConnection,
  defaultLock,
  defaultSettings,
  defaultT212AutomationMode,
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
  /**
   * @param rootCollection When set (e.g. "autoTradePreview"), all docs live under
   *   users/{userId}/{rootCollection}/workspace/... isolating preview data.
   */
  constructor(
    private readonly db: Firestore,
    private readonly options: { rootCollection?: string } = {}
  ) {}

  private userCol(userId: string, name: string) {
    const user = this.db.collection("users").doc(userId);
    if (this.options.rootCollection) {
      return user
        .collection(this.options.rootCollection)
        .doc("workspace")
        .collection(name);
    }
    return user.collection(name);
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

  private brokerSelectionRef(userId: string) {
    return this.userCol(userId, "brokerSelection").doc("current");
  }

  private t212InstrumentRef(userId: string) {
    return this.userCol(userId, "t212SelectedInstrument").doc("current");
  }

  private t212ProposalRef(userId: string, proposalId: string) {
    return this.userCol(userId, "t212Proposals").doc(proposalId);
  }

  private t212IdempotencyRef(userId: string, idempotencyKey: string) {
    const safe = idempotencyKey.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 700);
    return this.userCol(userId, "t212ProposalIdempotency").doc(safe);
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

  async getBrokerSelection(userId: string): Promise<BrokerSelectionDoc> {
    const snap = await this.brokerSelectionRef(userId).get();
    if (!snap.exists) {
      const created = defaultBrokerSelection(userId);
      await this.brokerSelectionRef(userId).set(
        stripUndefined(created) as FirebaseFirestore.DocumentData
      );
      return created;
    }
    return snap.data() as BrokerSelectionDoc;
  }

  async saveBrokerSelection(doc: BrokerSelectionDoc): Promise<BrokerSelectionDoc> {
    await this.brokerSelectionRef(doc.userId).set(
      stripUndefined(doc) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
    return doc;
  }

  async getT212SelectedInstrument(userId: string): Promise<T212SelectedInstrument | null> {
    const snap = await this.t212InstrumentRef(userId).get();
    if (!snap.exists) return null;
    const data = snap.data() as T212SelectedInstrument & { cleared?: boolean };
    if (data.cleared) return null;
    return data as T212SelectedInstrument;
  }

  async saveT212SelectedInstrument(
    userId: string,
    instrument: T212SelectedInstrument | null
  ): Promise<void> {
    if (instrument == null) {
      await this.t212InstrumentRef(userId).set({ cleared: true, updatedAt: nowIso() });
      return;
    }
    await this.t212InstrumentRef(userId).set(
      stripUndefined(instrument) as FirebaseFirestore.DocumentData
    );
  }

  async getT212ProposalByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<T212ExecutionProposal | null> {
    const idx = await this.t212IdempotencyRef(userId, idempotencyKey).get();
    if (!idx.exists) return null;
    const proposalId = String((idx.data() as { proposalId?: string }).proposalId ?? "");
    if (!proposalId) return null;
    const snap = await this.t212ProposalRef(userId, proposalId).get();
    return snap.exists ? (snap.data() as T212ExecutionProposal) : null;
  }

  async saveT212Proposal(proposal: T212ExecutionProposal): Promise<T212ExecutionProposal> {
    await this.t212ProposalRef(proposal.userId, proposal.proposalId).set(
      stripUndefined(proposal) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
    await this.t212IdempotencyRef(proposal.userId, proposal.idempotencyKey).set(
      {
        proposalId: proposal.proposalId,
        idempotencyKey: proposal.idempotencyKey,
        decisionId: proposal.decisionId,
        updatedAt: nowIso()
      },
      { merge: true }
    );
    return proposal;
  }

  async createT212ProposalIfAbsent(
    proposal: T212ExecutionProposal
  ): Promise<{ proposal: T212ExecutionProposal; created: boolean }> {
    const indexRef = this.t212IdempotencyRef(proposal.userId, proposal.idempotencyKey);
    const proposalRef = this.t212ProposalRef(proposal.userId, proposal.proposalId);
    const lockRef = this.lockRef(proposal.userId);
    const riskRef = this.riskRef(proposal.userId);

    return this.db.runTransaction(async (tx: Transaction) => {
      const lockSnap = await tx.get(lockRef);
      const riskSnap = await tx.get(riskRef);
      const lock = lockSnap.exists
        ? (lockSnap.data() as AutoTradeLockDoc)
        : defaultLock(proposal.userId);
      const risk = riskSnap.exists
        ? (riskSnap.data() as AutoTradeRiskState)
        : createDefaultRiskState(proposal.userId);
      if (lock.locked || risk.emergencyStopActive || risk.locked) {
        throw Object.assign(new Error("AUTOTRADE_LOCKED"), { code: "AUTOTRADE_LOCKED" });
      }

      const idxSnap = await tx.get(indexRef);
      if (idxSnap.exists) {
        const existingId = String((idxSnap.data() as { proposalId?: string }).proposalId ?? "");
        if (existingId) {
          const existingSnap = await tx.get(this.t212ProposalRef(proposal.userId, existingId));
          if (existingSnap.exists) {
            return {
              proposal: existingSnap.data() as T212ExecutionProposal,
              created: false
            };
          }
        }
      }

      tx.set(proposalRef, stripUndefined(proposal) as FirebaseFirestore.DocumentData);
      tx.set(indexRef, {
        proposalId: proposal.proposalId,
        idempotencyKey: proposal.idempotencyKey,
        decisionId: proposal.decisionId,
        updatedAt: nowIso()
      });
      return { proposal, created: true };
    });
  }

  async listT212Proposals(userId: string, limit = 50): Promise<T212ExecutionProposal[]> {
    const snap = await this.userCol(userId, "t212Proposals")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as T212ExecutionProposal);
  }

  async clearAwaitingT212Proposals(userId: string): Promise<void> {
    const snap = await this.userCol(userId, "t212Proposals")
      .where("status", "in", ["AWAITING_CONFIRMATION", "CREATED"])
      .limit(100)
      .get();
    const batch = this.db.batch();
    for (const doc of snap.docs) {
      batch.set(doc.ref, { status: "CANCELLED", updatedAt: nowIso() }, { merge: true });
    }
    if (!snap.empty) await batch.commit();
  }

  async saveT212SelectedInstrumentAndInvalidateAwaiting(
    userId: string,
    instrument: T212SelectedInstrument,
    invalidateAwaiting: boolean
  ): Promise<void> {
    const snap = invalidateAwaiting
      ? await this.userCol(userId, "t212Proposals")
          .where("status", "in", ["AWAITING_CONFIRMATION", "CREATED"])
          .limit(100)
          .get()
      : null;
    const batch = this.db.batch();
    batch.set(
      this.t212InstrumentRef(userId),
      stripUndefined(instrument) as FirebaseFirestore.DocumentData
    );
    if (snap) {
      for (const doc of snap.docs) {
        batch.set(doc.ref, { status: "CANCELLED", updatedAt: nowIso() }, { merge: true });
      }
    }
    await batch.commit();
  }

  private t212AutomationModeRef(userId: string) {
    return this.userCol(userId, "t212AutomationMode").doc("current");
  }

  private t212OrderIntentRef(userId: string, intentId: string) {
    return this.userCol(userId, "t212OrderIntents").doc(intentId);
  }

  private t212OrderIntentKeyRef(userId: string, intentKey: string) {
    return this.userCol(userId, "t212OrderIntentKeys").doc(intentKey);
  }

  private t212QualificationRef(userId: string) {
    return this.userCol(userId, "t212PracticeAutoQualification").doc("current");
  }

  async getT212AutomationMode(userId: string): Promise<T212AutomationMode> {
    const snap = await this.t212AutomationModeRef(userId).get();
    if (!snap.exists) return defaultT212AutomationMode();
    const mode = String((snap.data() as { mode?: string }).mode ?? "OFF");
    return mode as T212AutomationMode;
  }

  async saveT212AutomationMode(
    userId: string,
    mode: T212AutomationMode
  ): Promise<T212AutomationMode> {
    await this.t212AutomationModeRef(userId).set(
      { mode, updatedAt: nowIso() },
      { merge: true }
    );
    return mode;
  }

  async getT212OrderIntent(
    userId: string,
    intentId: string
  ): Promise<T212OrderIntent | null> {
    const snap = await this.t212OrderIntentRef(userId, intentId).get();
    return snap.exists ? (snap.data() as T212OrderIntent) : null;
  }

  async saveT212OrderIntent(intent: T212OrderIntent): Promise<T212OrderIntent> {
    await this.t212OrderIntentRef(intent.userId, intent.intentId).set(
      stripUndefined(intent) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
    await this.t212OrderIntentKeyRef(intent.userId, intent.intentKey).set(
      {
        intentId: intent.intentId,
        intentKey: intent.intentKey,
        updatedAt: nowIso()
      },
      { merge: true }
    );
    return intent;
  }

  async listT212OrderIntents(userId: string, limit = 50): Promise<T212OrderIntent[]> {
    const snap = await this.userCol(userId, "t212OrderIntents")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as T212OrderIntent);
  }

  async listUnresolvedT212OrderIntents(userId: string): Promise<T212OrderIntent[]> {
    const list = await this.listT212OrderIntents(userId, 100);
    return list.filter((i) => isUnresolvedIntentState(i.state));
  }

  async claimT212OrderIntent(
    input: ClaimT212OrderIntentInput
  ): Promise<ClaimT212OrderIntentResult> {
    const keyRef = this.t212OrderIntentKeyRef(input.userId, input.intentKey);
    return this.db.runTransaction(async (tx: Transaction) => {
      const keySnap = await tx.get(keyRef);
      if (keySnap.exists) {
        const existingId = String(
          (keySnap.data() as { intentId?: string }).intentId ?? ""
        );
        if (existingId) {
          const existingSnap = await tx.get(
            this.t212OrderIntentRef(input.userId, existingId)
          );
          if (existingSnap.exists) {
            const existing = existingSnap.data() as T212OrderIntent;
            if (
              existing.leaseOwner &&
              existing.leaseExpiresAt &&
              Date.parse(existing.leaseExpiresAt) > Date.now() &&
              existing.leaseOwner !== input.ownerId
            ) {
              return { status: "lease_held" as const, intent: existing };
            }
            return { status: "duplicate" as const, intent: existing };
          }
        }
      }

      const created = input.create();
      const leased: T212OrderIntent = {
        ...created,
        leaseOwner: input.ownerId,
        leaseExpiresAt: new Date(
          Date.now() + (input.leaseMs ?? INTENT_LEASE_MS)
        ).toISOString()
      };
      tx.set(
        this.t212OrderIntentRef(input.userId, leased.intentId),
        stripUndefined(leased) as FirebaseFirestore.DocumentData
      );
      tx.set(keyRef, {
        intentId: leased.intentId,
        intentKey: leased.intentKey,
        updatedAt: nowIso()
      });
      return { status: "claimed" as const, intent: leased };
    });
  }

  async releaseT212OrderIntentLease(
    userId: string,
    intentId: string,
    ownerId: string
  ): Promise<void> {
    const ref = this.t212OrderIntentRef(userId, intentId);
    await this.db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const intent = snap.data() as T212OrderIntent;
      if (intent.leaseOwner && intent.leaseOwner !== ownerId) return;
      tx.set(
        ref,
        {
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: nowIso()
        },
        { merge: true }
      );
    });
  }

  async getT212PracticeAutoQualification(
    userId: string
  ): Promise<PracticeAutoQualificationState> {
    const snap = await this.t212QualificationRef(userId).get();
    if (!snap.exists) return defaultQualificationState(userId, nowIso());
    return snap.data() as PracticeAutoQualificationState;
  }

  async saveT212PracticeAutoQualification(
    state: PracticeAutoQualificationState
  ): Promise<PracticeAutoQualificationState> {
    const next = { ...state, updatedAt: nowIso() };
    await this.t212QualificationRef(state.userId).set(
      stripUndefined(next) as FirebaseFirestore.DocumentData,
      { merge: true }
    );
    return next;
  }
}
