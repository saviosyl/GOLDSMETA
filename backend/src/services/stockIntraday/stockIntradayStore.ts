/**
 * In-memory Stocks Intraday store (tests + local).
 */

import { randomUUID } from "crypto";
import { nowIso } from "../../utils/time";
import {
  DEFAULT_STOCK_INTRADAY_LIMITS,
  type StockIntradayMode
} from "./featureFlags";
import {
  DEFAULT_STOCK_UNIVERSE,
  type StockIntradayRiskState,
  type StockManagedPosition,
  type StockTradeIntent,
  type StockUniverseFilters
} from "./types";
import type { StockSignalRecord } from "./signalIngestion";
import { createDefaultRiskState, refreshRiskPeriod } from "./risk/riskEngine";

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

export interface StockIntradayStorePort {
  getRiskState(userId: string): Promise<StockIntradayRiskState>;
  saveRiskState(state: StockIntradayRiskState): Promise<StockIntradayRiskState>;
  getSettings(userId: string): Promise<StockIntradaySettings>;
  saveSettings(settings: StockIntradaySettings): Promise<StockIntradaySettings>;
  listPositions(userId: string): Promise<StockManagedPosition[]>;
  savePosition(position: StockManagedPosition): Promise<void>;
  deletePosition(userId: string, positionId: string): Promise<void>;
  getIntent(userId: string, intentId: string): Promise<StockTradeIntent | null>;
  saveIntent(intent: StockTradeIntent): Promise<void>;
  listOpenIntents(userId: string): Promise<StockTradeIntent[]>;
  /** Atomic reservation: returns false if duplicate idempotency key exists. */
  reserveIntent(intent: StockTradeIntent, idempotencyKey: string): Promise<boolean>;
  hasAlertId(userId: string, alertId: string): Promise<boolean>;
  saveSignal(record: StockSignalRecord): Promise<void>;
  getSignalByAlertId(userId: string, alertId: string): Promise<StockSignalRecord | null>;
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
}

export class InMemoryStockIntradayStore implements StockIntradayStorePort {
  private risk = new Map<string, StockIntradayRiskState>();
  private settings = new Map<string, StockIntradaySettings>();
  private positions = new Map<string, StockManagedPosition[]>();
  private intents = new Map<string, StockTradeIntent[]>();
  private idempotency = new Set<string>();
  private alerts = new Map<string, StockSignalRecord>();
  private activity = new Map<string, StockIntradayActivityEntry[]>();
  private audit: StockIntradayAuditEntry[] = [];
  private cooldowns = new Map<string, string>();
  private shadow = new Map<
    string,
    Array<{ id: string; symbol: string; side: "BUY" | "SELL"; quantity: number; at: string; note: string }>
  >();

  async getRiskState(userId: string): Promise<StockIntradayRiskState> {
    const existing = this.risk.get(userId) ?? createDefaultRiskState(userId);
    return refreshRiskPeriod(existing);
  }

  async saveRiskState(state: StockIntradayRiskState): Promise<StockIntradayRiskState> {
    this.risk.set(state.userId, state);
    return state;
  }

  async getSettings(userId: string): Promise<StockIntradaySettings> {
    return (
      this.settings.get(userId) ?? {
        userId,
        limits: { ...DEFAULT_STOCK_INTRADAY_LIMITS },
        universe: { ...DEFAULT_STOCK_UNIVERSE, allowlist: [...DEFAULT_STOCK_UNIVERSE.allowlist] },
        allowedStrategyIds: [],
        updatedAt: nowIso()
      }
    );
  }

  async saveSettings(settings: StockIntradaySettings): Promise<StockIntradaySettings> {
    this.settings.set(settings.userId, settings);
    return settings;
  }

  async listPositions(userId: string): Promise<StockManagedPosition[]> {
    return [...(this.positions.get(userId) ?? [])];
  }

  async savePosition(position: StockManagedPosition): Promise<void> {
    const list = this.positions.get(position.userId) ?? [];
    const idx = list.findIndex((p) => p.positionId === position.positionId);
    if (idx >= 0) list[idx] = position;
    else list.push(position);
    this.positions.set(position.userId, list);
  }

  async deletePosition(userId: string, positionId: string): Promise<void> {
    const list = (this.positions.get(userId) ?? []).filter((p) => p.positionId !== positionId);
    this.positions.set(userId, list);
  }

  async getIntent(userId: string, intentId: string): Promise<StockTradeIntent | null> {
    return (this.intents.get(userId) ?? []).find((i) => i.intentId === intentId) ?? null;
  }

  async saveIntent(intent: StockTradeIntent): Promise<void> {
    const list = this.intents.get(intent.userId) ?? [];
    const idx = list.findIndex((i) => i.intentId === intent.intentId);
    if (idx >= 0) list[idx] = intent;
    else list.push(intent);
    this.intents.set(intent.userId, list);
  }

  async listOpenIntents(userId: string): Promise<StockTradeIntent[]> {
    return (this.intents.get(userId) ?? []).filter(
      (i) => !["CLOSED", "CANCELLED", "REJECTED"].includes(i.state)
    );
  }

  async reserveIntent(intent: StockTradeIntent, idempotencyKey: string): Promise<boolean> {
    if (this.idempotency.has(idempotencyKey)) return false;
    this.idempotency.add(idempotencyKey);
    await this.saveIntent(intent);
    return true;
  }

  async hasAlertId(userId: string, alertId: string): Promise<boolean> {
    return this.alerts.has(`${userId}:${alertId}`);
  }

  async saveSignal(record: StockSignalRecord): Promise<void> {
    this.alerts.set(`${record.userId}:${record.alertId}`, record);
  }

  async getSignalByAlertId(userId: string, alertId: string): Promise<StockSignalRecord | null> {
    return this.alerts.get(`${userId}:${alertId}`) ?? null;
  }

  async appendActivity(
    userId: string,
    entry: Omit<StockIntradayActivityEntry, "id"> & { id?: string }
  ): Promise<void> {
    const list = this.activity.get(userId) ?? [];
    list.unshift({ id: entry.id ?? randomUUID(), at: entry.at, message: entry.message, level: entry.level });
    this.activity.set(userId, list.slice(0, 100));
  }

  async listActivity(userId: string, limit = 40): Promise<StockIntradayActivityEntry[]> {
    return (this.activity.get(userId) ?? []).slice(0, limit);
  }

  async appendAudit(
    entry: Omit<StockIntradayAuditEntry, "id" | "at"> & { id?: string; at?: string }
  ): Promise<void> {
    this.audit.push({
      id: entry.id ?? randomUUID(),
      userId: entry.userId,
      at: entry.at ?? nowIso(),
      action: entry.action,
      detail: entry.detail
    });
  }

  async getSymbolCooldown(userId: string, symbol: string): Promise<string | null> {
    return this.cooldowns.get(`${userId}:${symbol.toUpperCase()}`) ?? null;
  }

  async setSymbolCooldown(userId: string, symbol: string, untilIso: string): Promise<void> {
    this.cooldowns.set(`${userId}:${symbol.toUpperCase()}`, untilIso);
  }

  async listShadowTrades(userId: string) {
    return [...(this.shadow.get(userId) ?? [])];
  }

  async appendShadowTrade(
    userId: string,
    trade: { symbol: string; side: "BUY" | "SELL"; quantity: number; note: string }
  ): Promise<void> {
    const list = this.shadow.get(userId) ?? [];
    list.unshift({ id: randomUUID(), at: nowIso(), ...trade });
    this.shadow.set(userId, list.slice(0, 100));
  }
}

void (null as unknown as StockIntradayMode);
