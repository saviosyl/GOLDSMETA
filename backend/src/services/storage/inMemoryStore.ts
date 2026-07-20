import { randomUUID } from "crypto";
import type {
  DecisionRecord,
  DeviceRecord,
  JournalCreate,
  JournalEntry,
  JournalPatch,
  TradingViewPayload,
  UserSettings
} from "../../models/types";
import { nowIso } from "../../utils/time";

export interface RawEventRecord {
  eventId: string;
  receivedAt: string;
  payload: TradingViewPayload;
}

export class InMemoryStore {
  private rawEvents = new Map<string, RawEventRecord>();
  private decisions = new Map<string, DecisionRecord>();
  private devices = new Map<string, DeviceRecord>();
  private journalEntries = new Map<string, JournalEntry>();
  private settings = new Map<string, UserSettings>();
  private notifications = new Set<string>();

  saveRawEvent(payload: TradingViewPayload, stableEventId: string): RawEventRecord {
    const record: RawEventRecord = {
      eventId: stableEventId,
      receivedAt: nowIso(),
      payload
    };
    this.rawEvents.set(stableEventId, record);
    return record;
  }

  /** Fast-path persist used by the webhook before background decision processing. */
  enqueueAcceptedEvent(payload: TradingViewPayload, stableEventId: string): RawEventRecord {
    return this.saveRawEvent(payload, stableEventId);
  }

  getRawEvent(eventId: string): RawEventRecord | undefined {
    return this.rawEvents.get(eventId);
  }

  saveDecision(decision: DecisionRecord): DecisionRecord {
    this.decisions.set(decision.decisionId, decision);
    return decision;
  }

  getDecision(decisionId: string): DecisionRecord | undefined {
    return this.decisions.get(decisionId);
  }

  listDecisions(limit = 50): DecisionRecord[] {
    return [...this.decisions.values()]
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
      .slice(0, limit);
  }

  latestDecision(): DecisionRecord | undefined {
    const [latest] = this.listDecisions(1);
    return latest;
  }

  latestMeaningfulDecision(): DecisionRecord | undefined {
    return this.listDecisions().find((decision) => decision.decision !== "WAIT");
  }

  registerDevice(device: DeviceRecord): DeviceRecord {
    this.devices.set(device.deviceId, device);
    return device;
  }

  deleteDevice(userId: string, deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device || device.userId !== userId) {
      return false;
    }
    return this.devices.delete(deviceId);
  }

  listDevices(userId: string): DeviceRecord[] {
    return [...this.devices.values()].filter((device) => device.userId === userId);
  }

  getSettings(userId: string): UserSettings {
    const existing = this.settings.get(userId);
    if (existing) {
      return existing;
    }

    const created: UserSettings = {
      userId,
      aiEnabled: false,
      notificationsEnabled: true,
      provisionalSignalsEnabled: false,
      riskProfile: "BALANCED",
      updatedAt: nowIso()
    };
    this.settings.set(userId, created);
    return created;
  }

  updateSettings(userId: string, patch: Partial<Omit<UserSettings, "userId" | "updatedAt">>): UserSettings {
    const updated: UserSettings = {
      ...this.getSettings(userId),
      ...patch,
      updatedAt: nowIso()
    };
    this.settings.set(userId, updated);
    return updated;
  }

  createJournalEntry(userId: string, input: JournalCreate): JournalEntry {
    const timestamp = nowIso();
    const entry: JournalEntry = {
      ...input,
      journalId: randomUUID(),
      userId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.journalEntries.set(entry.journalId, entry);
    return entry;
  }

  patchJournalEntry(userId: string, journalId: string, patch: JournalPatch): JournalEntry | undefined {
    const existing = this.journalEntries.get(journalId);
    if (!existing || existing.userId !== userId) {
      return undefined;
    }
    const updated: JournalEntry = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };
    this.journalEntries.set(journalId, updated);
    return updated;
  }

  listJournalEntries(userId: string): JournalEntry[] {
    return [...this.journalEntries.values()]
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  markNotification(key: string): boolean {
    if (this.notifications.has(key)) {
      return false;
    }
    this.notifications.add(key);
    return true;
  }

  reset(): void {
    this.rawEvents.clear();
    this.decisions.clear();
    this.devices.clear();
    this.journalEntries.clear();
    this.settings.clear();
    this.notifications.clear();
  }
}

export const globalStore = new InMemoryStore();
