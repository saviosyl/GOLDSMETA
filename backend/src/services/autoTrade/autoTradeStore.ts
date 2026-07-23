/**
 * AutoTrade persistence port + shared helpers.
 * Runtime default: FirestoreAutoTradeStore. Tests: InMemoryAutoTradeStore.
 */

import type {
  AutoTradeActivityEntry,
  AutoTradeAuditEntry,
  AutoTradeRiskLimits,
  AutoTradeRiskState,
  AutoTradeSettings,
  AutoTradePositionView,
  BrokerExecutionRecord,
  TradeIntent,
  TradeIntentState
} from "./types";
import { FIRST_PILOT_LIMITS } from "./types";
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
import { createDefaultRiskState } from "./riskEngine";
import { nowIso } from "../../utils/time";

export type ClaimT212OrderIntentResult =
  | { status: "claimed"; intent: T212OrderIntent }
  | { status: "duplicate"; intent: T212OrderIntent }
  | { status: "lease_held"; intent: T212OrderIntent };

export interface ClaimT212OrderIntentInput {
  userId: string;
  intentKey: string;
  ownerId: string;
  leaseMs?: number;
  create: () => T212OrderIntent;
}

export const INTENT_LEASE_MS = 60_000;

export interface BrokerConnectionDoc {
  userId: string;
  environment: "DEMO" | "LIVE" | null;
  connected: boolean;
  accountId: string | null;
  accountName: string | null;
  currency: string | null;
  balance: number | null;
  available: number | null;
  marginUsed: number | null;
  marketEpic: string | null;
  marketName: string | null;
  lastHeartbeatAt: string | null;
  credentialsRef: string | null;
  /** Fingerprint used to detect account/epic changes */
  pinnedAccountId: string | null;
  pinnedMarketEpic: string | null;
  updatedAt: string;
}

export interface AutoTradeLockDoc {
  userId: string;
  locked: boolean;
  reason: string | null;
  lockedAt: string | null;
  unlockedAt: string | null;
}

export interface BrokerEventDoc {
  id: string;
  userId: string;
  at: string;
  type: string;
  detail: Record<string, unknown>;
}

export type ClaimIntentResult =
  | { status: "claimed"; intent: TradeIntent }
  | { status: "duplicate"; intent: TradeIntent }
  | { status: "lease_held"; intent: TradeIntent };

export interface ClaimIntentInput {
  userId: string;
  dealReference: string;
  ownerId: string;
  leaseMs?: number;
  create: () => TradeIntent;
}

export interface AutoTradeStorePort {
  getRiskState(userId: string): Promise<AutoTradeRiskState>;
  saveRiskState(state: AutoTradeRiskState): Promise<AutoTradeRiskState>;
  getSettings(userId: string): Promise<AutoTradeSettings>;
  saveSettings(settings: AutoTradeSettings): Promise<AutoTradeSettings>;
  getConnection(userId: string): Promise<BrokerConnectionDoc>;
  saveConnection(doc: BrokerConnectionDoc): Promise<BrokerConnectionDoc>;
  getLock(userId: string): Promise<AutoTradeLockDoc>;
  saveLock(doc: AutoTradeLockDoc): Promise<AutoTradeLockDoc>;
  getIntentByDealReference(userId: string, dealReference: string): Promise<TradeIntent | null>;
  getIntent(userId: string, intentId: string): Promise<TradeIntent | null>;
  saveIntent(intent: TradeIntent): Promise<TradeIntent>;
  listIntents(userId: string, limit?: number): Promise<TradeIntent[]>;
  /**
   * Transactional create-or-claim by dealReference.
   * Two instances must never both receive status:"claimed" for the same ref.
   */
  claimIntent(input: ClaimIntentInput): Promise<ClaimIntentResult>;
  heartbeatIntentLease(
    userId: string,
    intentId: string,
    ownerId: string,
    leaseMs?: number
  ): Promise<TradeIntent | null>;
  releaseIntentLease(userId: string, intentId: string, ownerId: string): Promise<void>;
  saveExecution(exec: BrokerExecutionRecord): Promise<BrokerExecutionRecord>;
  listExecutions(userId: string, limit?: number): Promise<BrokerExecutionRecord[]>;
  savePosition(userId: string, position: AutoTradePositionView): Promise<void>;
  listPositions(userId: string): Promise<AutoTradePositionView[]>;
  appendBrokerEvent(event: BrokerEventDoc): Promise<void>;
  listBrokerEvents(userId: string, limit?: number): Promise<BrokerEventDoc[]>;
  appendActivity(userId: string, entry: AutoTradeActivityEntry): Promise<void>;
  listActivity(userId: string, limit?: number): Promise<AutoTradeActivityEntry[]>;
  appendAudit(entry: AutoTradeAuditEntry): Promise<void>;
  listAudit(userId: string, limit?: number): Promise<AutoTradeAuditEntry[]>;
  getBrokerSelection(userId: string): Promise<BrokerSelectionDoc>;
  saveBrokerSelection(doc: BrokerSelectionDoc): Promise<BrokerSelectionDoc>;
  getT212SelectedInstrument(userId: string): Promise<T212SelectedInstrument | null>;
  saveT212SelectedInstrument(
    userId: string,
    instrument: T212SelectedInstrument | null
  ): Promise<void>;
  getT212ProposalByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<T212ExecutionProposal | null>;
  saveT212Proposal(proposal: T212ExecutionProposal): Promise<T212ExecutionProposal>;
  /**
   * Atomic create-if-absent by idempotency key.
   * Re-checks AutoTrade lock inside the write path so Emergency STOP wins races.
   */
  createT212ProposalIfAbsent(
    proposal: T212ExecutionProposal
  ): Promise<{ proposal: T212ExecutionProposal; created: boolean }>;
  listT212Proposals(userId: string, limit?: number): Promise<T212ExecutionProposal[]>;
  clearAwaitingT212Proposals(userId: string): Promise<void>;
  /** Atomically persist instrument selection and cancel awaiting proposals when requested. */
  saveT212SelectedInstrumentAndInvalidateAwaiting(
    userId: string,
    instrument: T212SelectedInstrument,
    invalidateAwaiting: boolean
  ): Promise<void>;
  getT212AutomationMode(userId: string): Promise<T212AutomationMode>;
  saveT212AutomationMode(userId: string, mode: T212AutomationMode): Promise<T212AutomationMode>;
  getT212OrderIntent(userId: string, intentId: string): Promise<T212OrderIntent | null>;
  saveT212OrderIntent(intent: T212OrderIntent): Promise<T212OrderIntent>;
  listT212OrderIntents(userId: string, limit?: number): Promise<T212OrderIntent[]>;
  listUnresolvedT212OrderIntents(userId: string): Promise<T212OrderIntent[]>;
  claimT212OrderIntent(input: ClaimT212OrderIntentInput): Promise<ClaimT212OrderIntentResult>;
  releaseT212OrderIntentLease(
    userId: string,
    intentId: string,
    ownerId: string
  ): Promise<void>;
  getT212PracticeAutoQualification(
    userId: string
  ): Promise<PracticeAutoQualificationState>;
  saveT212PracticeAutoQualification(
    state: PracticeAutoQualificationState
  ): Promise<PracticeAutoQualificationState>;
}

export function defaultBrokerSelection(userId: string): BrokerSelectionDoc {
  return {
    userId,
    selectedBroker: "MANUAL",
    updatedAt: nowIso()
  };
}

export function defaultT212AutomationMode(): T212AutomationMode {
  return "OFF";
}

/** Helper for store implementations. */
export function filterUnresolvedT212Intents(
  intents: T212OrderIntent[]
): T212OrderIntent[] {
  return intents.filter((i) => isUnresolvedIntentState(i.state));
}

export function defaultConnection(userId: string): BrokerConnectionDoc {
  return {
    userId,
    environment: null,
    connected: false,
    accountId: null,
    accountName: null,
    currency: null,
    balance: null,
    available: null,
    marginUsed: null,
    marketEpic: null,
    marketName: null,
    lastHeartbeatAt: null,
    credentialsRef: null,
    pinnedAccountId: null,
    pinnedMarketEpic: null,
    updatedAt: nowIso()
  };
}

export function defaultSettings(
  userId: string,
  limits: AutoTradeRiskLimits = FIRST_PILOT_LIMITS
): AutoTradeSettings {
  return { userId, limits, updatedAt: nowIso() };
}

export function defaultLock(userId: string): AutoTradeLockDoc {
  return { userId, locked: false, reason: null, lockedAt: null, unlockedAt: null };
}

export function isLeaseExpired(intent: TradeIntent, nowMs = Date.now()): boolean {
  if (!intent.leaseExpiresAt) return true;
  return new Date(intent.leaseExpiresAt).getTime() <= nowMs;
}

export function isTerminalIntentState(state: TradeIntentState): boolean {
  return (
    state === "ACCEPTED" ||
    state === "REJECTED" ||
    state === "OPEN" ||
    state === "CLOSED" ||
    state === "BLOCKED" ||
    state === "RECONCILIATION_REQUIRED"
  );
}

export function applyLease(
  intent: TradeIntent,
  ownerId: string,
  leaseMs = INTENT_LEASE_MS
): TradeIntent {
  const at = nowIso();
  const expires = new Date(Date.now() + leaseMs).toISOString();
  return {
    ...intent,
    leaseOwnerId: ownerId,
    leaseExpiresAt: expires,
    leaseHeartbeatAt: at,
    updatedAt: at
  };
}

export { createDefaultRiskState };
