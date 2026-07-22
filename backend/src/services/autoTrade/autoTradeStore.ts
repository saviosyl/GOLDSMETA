/**
 * In-memory AutoTrade persistence for tests and local preview.
 * Production path will mirror these collections in Firestore (Admin SDK writes only).
 */

import type {
  AutoTradeActivityEntry,
  AutoTradeAuditEntry,
  AutoTradeRiskLimits,
  AutoTradeRiskState,
  AutoTradeSettings,
  BrokerExecutionRecord,
  TradeIntent
} from "./types";
import { FIRST_PILOT_LIMITS } from "./types";
import { createDefaultRiskState } from "./riskEngine";
import { nowIso } from "../../utils/time";

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
  updatedAt: string;
}

export interface AutoTradeLockDoc {
  userId: string;
  locked: boolean;
  reason: string | null;
  lockedAt: string | null;
  unlockedAt: string | null;
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
  saveExecution(exec: BrokerExecutionRecord): Promise<BrokerExecutionRecord>;
  listExecutions(userId: string, limit?: number): Promise<BrokerExecutionRecord[]>;
  appendActivity(userId: string, entry: AutoTradeActivityEntry): Promise<void>;
  listActivity(userId: string, limit?: number): Promise<AutoTradeActivityEntry[]>;
  appendAudit(entry: AutoTradeAuditEntry): Promise<void>;
  listAudit(userId: string, limit?: number): Promise<AutoTradeAuditEntry[]>;
  /** Process-local mutex for concurrent execution protection. */
  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T>;
}

function defaultConnection(userId: string): BrokerConnectionDoc {
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
    updatedAt: nowIso()
  };
}

function defaultSettings(userId: string, limits: AutoTradeRiskLimits = FIRST_PILOT_LIMITS): AutoTradeSettings {
  return { userId, limits, updatedAt: nowIso() };
}

function defaultLock(userId: string): AutoTradeLockDoc {
  return { userId, locked: false, reason: null, lockedAt: null, unlockedAt: null };
}

export class InMemoryAutoTradeStore implements AutoTradeStorePort {
  private risk = new Map<string, AutoTradeRiskState>();
  private settings = new Map<string, AutoTradeSettings>();
  private connections = new Map<string, BrokerConnectionDoc>();
  private locks = new Map<string, AutoTradeLockDoc>();
  private intents = new Map<string, TradeIntent[]>();
  private executions = new Map<string, BrokerExecutionRecord[]>();
  private activity = new Map<string, AutoTradeActivityEntry[]>();
  private audit = new Map<string, AutoTradeAuditEntry[]>();
  private mutex = new Map<string, Promise<unknown>>();

  async getRiskState(userId: string): Promise<AutoTradeRiskState> {
    const existing = this.risk.get(userId);
    if (existing) return { ...existing };
    const created = createDefaultRiskState(userId);
    this.risk.set(userId, created);
    return { ...created };
  }

  async saveRiskState(state: AutoTradeRiskState): Promise<AutoTradeRiskState> {
    this.risk.set(state.userId, { ...state });
    return { ...state };
  }

  async getSettings(userId: string): Promise<AutoTradeSettings> {
    const existing = this.settings.get(userId);
    if (existing) return { ...existing, limits: { ...existing.limits } };
    const created = defaultSettings(userId);
    this.settings.set(userId, created);
    return { ...created, limits: { ...created.limits } };
  }

  async saveSettings(settings: AutoTradeSettings): Promise<AutoTradeSettings> {
    this.settings.set(settings.userId, {
      ...settings,
      limits: { ...settings.limits }
    });
    return { ...settings, limits: { ...settings.limits } };
  }

  async getConnection(userId: string): Promise<BrokerConnectionDoc> {
    const existing = this.connections.get(userId);
    if (existing) return { ...existing };
    const created = defaultConnection(userId);
    this.connections.set(userId, created);
    return { ...created };
  }

  async saveConnection(doc: BrokerConnectionDoc): Promise<BrokerConnectionDoc> {
    this.connections.set(doc.userId, { ...doc });
    return { ...doc };
  }

  async getLock(userId: string): Promise<AutoTradeLockDoc> {
    const existing = this.locks.get(userId);
    if (existing) return { ...existing };
    const created = defaultLock(userId);
    this.locks.set(userId, created);
    return { ...created };
  }

  async saveLock(doc: AutoTradeLockDoc): Promise<AutoTradeLockDoc> {
    this.locks.set(doc.userId, { ...doc });
    return { ...doc };
  }

  async getIntentByDealReference(
    userId: string,
    dealReference: string
  ): Promise<TradeIntent | null> {
    const list = this.intents.get(userId) ?? [];
    return list.find((i) => i.dealReference === dealReference) ?? null;
  }

  async getIntent(userId: string, intentId: string): Promise<TradeIntent | null> {
    const list = this.intents.get(userId) ?? [];
    return list.find((i) => i.intentId === intentId) ?? null;
  }

  async saveIntent(intent: TradeIntent): Promise<TradeIntent> {
    const list = this.intents.get(intent.userId) ?? [];
    const idx = list.findIndex((i) => i.intentId === intent.intentId);
    if (idx >= 0) list[idx] = intent;
    else list.unshift(intent);
    this.intents.set(intent.userId, list);
    return intent;
  }

  async listIntents(userId: string, limit = 50): Promise<TradeIntent[]> {
    return (this.intents.get(userId) ?? []).slice(0, limit);
  }

  async saveExecution(exec: BrokerExecutionRecord): Promise<BrokerExecutionRecord> {
    const list = this.executions.get(exec.userId) ?? [];
    list.unshift(exec);
    this.executions.set(exec.userId, list);
    return exec;
  }

  async listExecutions(userId: string, limit = 50): Promise<BrokerExecutionRecord[]> {
    return (this.executions.get(userId) ?? []).slice(0, limit);
  }

  async appendActivity(userId: string, entry: AutoTradeActivityEntry): Promise<void> {
    const list = this.activity.get(userId) ?? [];
    list.unshift(entry);
    this.activity.set(userId, list.slice(0, 200));
  }

  async listActivity(userId: string, limit = 50): Promise<AutoTradeActivityEntry[]> {
    return (this.activity.get(userId) ?? []).slice(0, limit);
  }

  async appendAudit(entry: AutoTradeAuditEntry): Promise<void> {
    const list = this.audit.get(entry.userId) ?? [];
    list.unshift(entry);
    this.audit.set(entry.userId, list.slice(0, 500));
  }

  async listAudit(userId: string, limit = 50): Promise<AutoTradeAuditEntry[]> {
    return (this.audit.get(userId) ?? []).slice(0, limit);
  }

  async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.mutex.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => gate);
    this.mutex.set(userId, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
