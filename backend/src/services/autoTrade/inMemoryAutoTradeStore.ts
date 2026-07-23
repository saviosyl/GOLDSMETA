/**
 * In-memory AutoTrade store for unit/integration tests only.
 * Supports transactional claimIntent so two service instances sharing one store
 * cannot both claim the same deal reference.
 */

import { randomUUID } from "crypto";
import type {
  AutoTradeActivityEntry,
  AutoTradeAuditEntry,
  AutoTradePositionView,
  AutoTradeSettings,
  AutoTradeRiskState,
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
  filterUnresolvedT212Intents,
  isLeaseExpired,
  isTerminalIntentState
} from "./autoTradeStore";

export class InMemoryAutoTradeStore implements AutoTradeStorePort {
  private risk = new Map<string, AutoTradeRiskState>();
  private settings = new Map<string, AutoTradeSettings>();
  private connections = new Map<string, BrokerConnectionDoc>();
  private locks = new Map<string, AutoTradeLockDoc>();
  private intents = new Map<string, TradeIntent[]>();
  private intentsByDealRef = new Map<string, string>(); // `${userId}:${dealRef}` -> intentId
  private executions = new Map<string, BrokerExecutionRecord[]>();
  private positions = new Map<string, AutoTradePositionView[]>();
  private events = new Map<string, BrokerEventDoc[]>();
  private activity = new Map<string, AutoTradeActivityEntry[]>();
  private audit = new Map<string, AutoTradeAuditEntry[]>();
  private brokerSelection = new Map<string, BrokerSelectionDoc>();
  private t212Instruments = new Map<string, T212SelectedInstrument | null>();
  private t212Proposals = new Map<string, T212ExecutionProposal[]>();
  private t212Idempotency = new Map<string, string>(); // `${userId}:${key}` -> proposalId
  private t212AutomationMode = new Map<string, T212AutomationMode>();
  private t212OrderIntents = new Map<string, T212OrderIntent[]>();
  private t212IntentByKey = new Map<string, string>(); // `${userId}:${intentKey}` -> intentId
  private t212Qualification = new Map<string, PracticeAutoQualificationState>();
  private claimChain: Promise<unknown> = Promise.resolve();

  async getRiskState(userId: string): Promise<AutoTradeRiskState> {
    const existing = this.risk.get(userId);
    if (existing) return structuredClone(existing);
    const created = createDefaultRiskState(userId);
    this.risk.set(userId, created);
    return structuredClone(created);
  }

  async saveRiskState(state: AutoTradeRiskState): Promise<AutoTradeRiskState> {
    this.risk.set(state.userId, structuredClone(state));
    return structuredClone(state);
  }

  async getSettings(userId: string): Promise<AutoTradeSettings> {
    const existing = this.settings.get(userId);
    if (existing) return structuredClone(existing);
    const created = defaultSettings(userId);
    this.settings.set(userId, created);
    return structuredClone(created);
  }

  async saveSettings(settings: AutoTradeSettings): Promise<AutoTradeSettings> {
    this.settings.set(settings.userId, structuredClone(settings));
    return structuredClone(settings);
  }

  async getConnection(userId: string): Promise<BrokerConnectionDoc> {
    const existing = this.connections.get(userId);
    if (existing) return structuredClone(existing);
    const created = defaultConnection(userId);
    this.connections.set(userId, created);
    return structuredClone(created);
  }

  async saveConnection(doc: BrokerConnectionDoc): Promise<BrokerConnectionDoc> {
    this.connections.set(doc.userId, structuredClone(doc));
    return structuredClone(doc);
  }

  async getLock(userId: string): Promise<AutoTradeLockDoc> {
    const existing = this.locks.get(userId);
    if (existing) return structuredClone(existing);
    const created = defaultLock(userId);
    this.locks.set(userId, created);
    return structuredClone(created);
  }

  async saveLock(doc: AutoTradeLockDoc): Promise<AutoTradeLockDoc> {
    this.locks.set(doc.userId, structuredClone(doc));
    return structuredClone(doc);
  }

  async getIntentByDealReference(
    userId: string,
    dealReference: string
  ): Promise<TradeIntent | null> {
    const intentId = this.intentsByDealRef.get(`${userId}:${dealReference}`);
    if (!intentId) return null;
    return this.getIntent(userId, intentId);
  }

  async getIntent(userId: string, intentId: string): Promise<TradeIntent | null> {
    const list = this.intents.get(userId) ?? [];
    const found = list.find((i) => i.intentId === intentId);
    return found ? structuredClone(found) : null;
  }

  async saveIntent(intent: TradeIntent): Promise<TradeIntent> {
    const list = this.intents.get(intent.userId) ?? [];
    const idx = list.findIndex((i) => i.intentId === intent.intentId);
    if (idx >= 0) list[idx] = structuredClone(intent);
    else list.unshift(structuredClone(intent));
    this.intents.set(intent.userId, list);
    if (intent.dealReference) {
      this.intentsByDealRef.set(`${intent.userId}:${intent.dealReference}`, intent.intentId);
    }
    return structuredClone(intent);
  }

  async listIntents(userId: string, limit = 50): Promise<TradeIntent[]> {
    return structuredClone((this.intents.get(userId) ?? []).slice(0, limit));
  }

  async claimIntent(input: ClaimIntentInput): Promise<ClaimIntentResult> {
    const run = async (): Promise<ClaimIntentResult> => {
      const key = `${input.userId}:${input.dealReference}`;
      const existingId = this.intentsByDealRef.get(key);
      if (existingId) {
        const existing = await this.getIntent(input.userId, existingId);
        if (!existing) {
          // fall through to create
        } else if (isTerminalIntentState(existing.state)) {
          return { status: "duplicate", intent: existing };
        } else if (
          existing.leaseOwnerId &&
          !isLeaseExpired(existing) &&
          existing.leaseOwnerId !== input.ownerId
        ) {
          return { status: "lease_held", intent: existing };
        } else {
          // reclaim expired/own lease
          const claimed = applyLease(existing, input.ownerId, input.leaseMs ?? INTENT_LEASE_MS);
          await this.saveIntent(claimed);
          return { status: "claimed", intent: claimed };
        }
      }

      const created = applyLease(input.create(), input.ownerId, input.leaseMs ?? INTENT_LEASE_MS);
      if (!created.dealReference) created.dealReference = input.dealReference;
      await this.saveIntent(created);
      return { status: "claimed", intent: created };
    };

    const next = this.claimChain.then(run, run);
    this.claimChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async heartbeatIntentLease(
    userId: string,
    intentId: string,
    ownerId: string,
    leaseMs = INTENT_LEASE_MS
  ): Promise<TradeIntent | null> {
    const intent = await this.getIntent(userId, intentId);
    if (!intent || intent.leaseOwnerId !== ownerId) return null;
    const next = applyLease(intent, ownerId, leaseMs);
    await this.saveIntent(next);
    return next;
  }

  async releaseIntentLease(userId: string, intentId: string, ownerId: string): Promise<void> {
    const intent = await this.getIntent(userId, intentId);
    if (!intent || intent.leaseOwnerId !== ownerId) return;
    await this.saveIntent({
      ...intent,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      leaseHeartbeatAt: null,
      updatedAt: nowIso()
    });
  }

  async saveExecution(exec: BrokerExecutionRecord): Promise<BrokerExecutionRecord> {
    const list = this.executions.get(exec.userId) ?? [];
    list.unshift(structuredClone(exec));
    this.executions.set(exec.userId, list);
    return structuredClone(exec);
  }

  async listExecutions(userId: string, limit = 50): Promise<BrokerExecutionRecord[]> {
    return structuredClone((this.executions.get(userId) ?? []).slice(0, limit));
  }

  async savePosition(userId: string, position: AutoTradePositionView): Promise<void> {
    const list = this.positions.get(userId) ?? [];
    const idx = list.findIndex((p) => p.positionId === position.positionId);
    if (idx >= 0) list[idx] = structuredClone(position);
    else list.unshift(structuredClone(position));
    this.positions.set(userId, list);
  }

  async listPositions(userId: string): Promise<AutoTradePositionView[]> {
    return structuredClone(this.positions.get(userId) ?? []);
  }

  async appendBrokerEvent(event: BrokerEventDoc): Promise<void> {
    const list = this.events.get(event.userId) ?? [];
    list.unshift(structuredClone(event));
    this.events.set(event.userId, list.slice(0, 500));
  }

  async listBrokerEvents(userId: string, limit = 50): Promise<BrokerEventDoc[]> {
    return structuredClone((this.events.get(userId) ?? []).slice(0, limit));
  }

  async appendActivity(userId: string, entry: AutoTradeActivityEntry): Promise<void> {
    const list = this.activity.get(userId) ?? [];
    list.unshift(structuredClone(entry));
    this.activity.set(userId, list.slice(0, 200));
  }

  async listActivity(userId: string, limit = 50): Promise<AutoTradeActivityEntry[]> {
    return structuredClone((this.activity.get(userId) ?? []).slice(0, limit));
  }

  async appendAudit(entry: AutoTradeAuditEntry): Promise<void> {
    const list = this.audit.get(entry.userId) ?? [];
    list.unshift(structuredClone(entry));
    this.audit.set(entry.userId, list.slice(0, 500));
  }

  async listAudit(userId: string, limit = 50): Promise<AutoTradeAuditEntry[]> {
    return structuredClone((this.audit.get(userId) ?? []).slice(0, limit));
  }

  async getBrokerSelection(userId: string): Promise<BrokerSelectionDoc> {
    const existing = this.brokerSelection.get(userId);
    if (existing) return structuredClone(existing);
    const created = defaultBrokerSelection(userId);
    this.brokerSelection.set(userId, created);
    return structuredClone(created);
  }

  async saveBrokerSelection(doc: BrokerSelectionDoc): Promise<BrokerSelectionDoc> {
    this.brokerSelection.set(doc.userId, structuredClone(doc));
    return structuredClone(doc);
  }

  async getT212SelectedInstrument(userId: string): Promise<T212SelectedInstrument | null> {
    const value = this.t212Instruments.get(userId);
    return value == null ? null : structuredClone(value);
  }

  async saveT212SelectedInstrument(
    userId: string,
    instrument: T212SelectedInstrument | null
  ): Promise<void> {
    this.t212Instruments.set(userId, instrument == null ? null : structuredClone(instrument));
  }

  async getT212ProposalByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<T212ExecutionProposal | null> {
    const proposalId = this.t212Idempotency.get(`${userId}:${idempotencyKey}`);
    if (!proposalId) return null;
    const list = this.t212Proposals.get(userId) ?? [];
    const found = list.find((p) => p.proposalId === proposalId);
    return found ? structuredClone(found) : null;
  }

  async saveT212Proposal(proposal: T212ExecutionProposal): Promise<T212ExecutionProposal> {
    const list = this.t212Proposals.get(proposal.userId) ?? [];
    const idx = list.findIndex((p) => p.proposalId === proposal.proposalId);
    if (idx >= 0) list[idx] = structuredClone(proposal);
    else list.unshift(structuredClone(proposal));
    this.t212Proposals.set(proposal.userId, list);
    this.t212Idempotency.set(
      `${proposal.userId}:${proposal.idempotencyKey}`,
      proposal.proposalId
    );
    return structuredClone(proposal);
  }

  async createT212ProposalIfAbsent(
    proposal: T212ExecutionProposal
  ): Promise<{ proposal: T212ExecutionProposal; created: boolean }> {
    const lock = await this.getLock(proposal.userId);
    const risk = await this.getRiskState(proposal.userId);
    if (lock.locked || risk.emergencyStopActive || risk.locked) {
      throw Object.assign(new Error("AUTOTRADE_LOCKED"), { code: "AUTOTRADE_LOCKED" });
    }
    const existing = await this.getT212ProposalByIdempotencyKey(
      proposal.userId,
      proposal.idempotencyKey
    );
    if (existing) {
      return { proposal: existing, created: false };
    }
    const saved = await this.saveT212Proposal(proposal);
    return { proposal: saved, created: true };
  }

  async listT212Proposals(userId: string, limit = 50): Promise<T212ExecutionProposal[]> {
    return structuredClone((this.t212Proposals.get(userId) ?? []).slice(0, limit));
  }

  async clearAwaitingT212Proposals(userId: string): Promise<void> {
    const list = this.t212Proposals.get(userId) ?? [];
    const next = list.map((p) =>
      p.status === "AWAITING_CONFIRMATION" || p.status === "CREATED"
        ? { ...p, status: "CANCELLED" as const, updatedAt: nowIso() }
        : p
    );
    this.t212Proposals.set(userId, next);
  }

  async saveT212SelectedInstrumentAndInvalidateAwaiting(
    userId: string,
    instrument: T212SelectedInstrument,
    invalidateAwaiting: boolean
  ): Promise<void> {
    this.t212Instruments.set(userId, structuredClone(instrument));
    if (invalidateAwaiting) {
      await this.clearAwaitingT212Proposals(userId);
    }
  }

  async getT212AutomationMode(userId: string): Promise<T212AutomationMode> {
    return this.t212AutomationMode.get(userId) ?? defaultT212AutomationMode();
  }

  async saveT212AutomationMode(
    userId: string,
    mode: T212AutomationMode
  ): Promise<T212AutomationMode> {
    if (mode === "LIVE_LOCKED") {
      // Visible but impossible to activate as an executable mode.
      this.t212AutomationMode.set(userId, "LIVE_LOCKED");
      return "LIVE_LOCKED";
    }
    this.t212AutomationMode.set(userId, mode);
    return mode;
  }

  async getT212OrderIntent(
    userId: string,
    intentId: string
  ): Promise<T212OrderIntent | null> {
    const list = this.t212OrderIntents.get(userId) ?? [];
    const found = list.find((i) => i.intentId === intentId);
    return found ? structuredClone(found) : null;
  }

  async saveT212OrderIntent(intent: T212OrderIntent): Promise<T212OrderIntent> {
    const list = this.t212OrderIntents.get(intent.userId) ?? [];
    const idx = list.findIndex((i) => i.intentId === intent.intentId);
    if (idx >= 0) list[idx] = structuredClone(intent);
    else list.unshift(structuredClone(intent));
    this.t212OrderIntents.set(intent.userId, list);
    this.t212IntentByKey.set(`${intent.userId}:${intent.intentKey}`, intent.intentId);
    return structuredClone(intent);
  }

  async listT212OrderIntents(userId: string, limit = 50): Promise<T212OrderIntent[]> {
    return structuredClone((this.t212OrderIntents.get(userId) ?? []).slice(0, limit));
  }

  async listUnresolvedT212OrderIntents(userId: string): Promise<T212OrderIntent[]> {
    return structuredClone(
      filterUnresolvedT212Intents(this.t212OrderIntents.get(userId) ?? [])
    );
  }

  async claimT212OrderIntent(
    input: ClaimT212OrderIntentInput
  ): Promise<ClaimT212OrderIntentResult> {
    const run = async (): Promise<ClaimT212OrderIntentResult> => {
      const key = `${input.userId}:${input.intentKey}`;
      const existingId = this.t212IntentByKey.get(key);
      if (existingId) {
        const existing = await this.getT212OrderIntent(input.userId, existingId);
        if (existing) {
          if (
            existing.leaseOwner &&
            existing.leaseExpiresAt &&
            Date.parse(existing.leaseExpiresAt) > Date.now() &&
            existing.leaseOwner !== input.ownerId
          ) {
            return { status: "lease_held", intent: existing };
          }
          return { status: "duplicate", intent: existing };
        }
      }
      const created = input.create();
      const leased = {
        ...created,
        leaseOwner: input.ownerId,
        leaseExpiresAt: new Date(
          Date.now() + (input.leaseMs ?? INTENT_LEASE_MS)
        ).toISOString()
      };
      await this.saveT212OrderIntent(leased);
      return { status: "claimed", intent: structuredClone(leased) };
    };
    const next = this.claimChain.then(run, run);
    this.claimChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async releaseT212OrderIntentLease(
    userId: string,
    intentId: string,
    ownerId: string
  ): Promise<void> {
    const intent = await this.getT212OrderIntent(userId, intentId);
    if (!intent) return;
    if (intent.leaseOwner && intent.leaseOwner !== ownerId) return;
    await this.saveT212OrderIntent({
      ...intent,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: nowIso()
    });
  }

  async getT212PracticeAutoQualification(
    userId: string
  ): Promise<PracticeAutoQualificationState> {
    return (
      this.t212Qualification.get(userId) ??
      defaultQualificationState(userId, nowIso())
    );
  }

  async saveT212PracticeAutoQualification(
    state: PracticeAutoQualificationState
  ): Promise<PracticeAutoQualificationState> {
    const next = { ...state, updatedAt: nowIso() };
    this.t212Qualification.set(state.userId, structuredClone(next));
    return structuredClone(next);
  }
}

/** Unique owner id for a service instance (tests + Cloud Functions). */
export function createExecutionOwnerId(prefix = "owner"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
