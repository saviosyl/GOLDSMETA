import { randomUUID } from "crypto";
import type { SetupRecord } from "../../models/setup";
import { isActiveSetupStatus } from "../../models/setup";
import { DEFAULT_MANUAL_RISK } from "../../models/manualRisk";
import type { ManualExecutionRecord, SetupSkipRecord } from "../../models/manualRisk";
import type {
  DecisionRecord,
  DeviceRecord,
  JournalCreate,
  JournalEntry,
  JournalPatch,
  MarketSnapshot,
  TradingViewPayload,
  UserSettings,
  WebPushSubscriptionRecord
} from "../../models/types";
import { nowIso } from "../../utils/time";
import type {
  CreateProcessingJobInput,
  CreateWebhookConnectionInput,
  DecisionEnvironment,
  GoldMetaStore,
  ProcessingJob,
  RawEventRecord,
  SaveRawEventOptions,
  WebhookConnection,
  WebhookRejectLog
} from "./types";

const userScopedKey = (userId: string, id: string): string => `${userId}:${id}`;

export class InMemoryGoldMetaStore implements GoldMetaStore {
  private rawEvents = new Map<string, RawEventRecord>();
  private snapshots = new Map<string, MarketSnapshot>();
  private decisions = new Map<string, DecisionRecord>();
  private setups = new Map<string, SetupRecord>();
  private devices = new Map<string, DeviceRecord>();
  private webPushSubscriptions = new Map<string, WebPushSubscriptionRecord>();
  private journalEntries = new Map<string, JournalEntry>();
  private settings = new Map<string, UserSettings>();
  private notifications = new Set<string>();
  private webhookConnections = new Map<string, WebhookConnection>();
  private processingJobs = new Map<string, ProcessingJob>();
  private eventDedupes = new Set<string>();
  private webhookRejects: WebhookRejectLog[] = [];
  private setupSkips: SetupSkipRecord[] = [];

  saveRawEvent(
    userId: string,
    payload: TradingViewPayload,
    stableEventId: string,
    options: SaveRawEventOptions = {}
  ): RawEventRecord {
    const timestamp = nowIso();
    const existing = this.rawEvents.get(userScopedKey(userId, stableEventId));
    const record: RawEventRecord = {
      ...existing,
      eventId: stableEventId,
      userId,
      receivedAt: existing?.receivedAt ?? timestamp,
      payload,
      webhookId: options.webhookId ?? existing?.webhookId,
      environment: options.environment ?? existing?.environment,
      isTestEvent: options.isTestEvent ?? existing?.isTestEvent,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.rawEvents.set(userScopedKey(userId, stableEventId), record);
    return record;
  }

  enqueueAcceptedEvent(
    userId: string,
    payload: TradingViewPayload,
    stableEventId: string,
    options: SaveRawEventOptions = {}
  ): RawEventRecord {
    return this.saveRawEvent(userId, payload, stableEventId, options);
  }

  getRawEvent(userId: string, eventId: string): RawEventRecord | undefined {
    return this.rawEvents.get(userScopedKey(userId, eventId));
  }

  saveSnapshot(userId: string, snapshot: MarketSnapshot): MarketSnapshot {
    this.snapshots.set(userScopedKey(userId, snapshot.id), snapshot);
    return snapshot;
  }

  getSnapshot(userId: string, snapshotId: string): MarketSnapshot | undefined {
    return this.snapshots.get(userScopedKey(userId, snapshotId));
  }

  saveDecision(decision: DecisionRecord): DecisionRecord {
    this.decisions.set(decision.decisionId, decision);
    return decision;
  }

  getDecision(userId: string, decisionId: string): DecisionRecord | undefined {
    const decision = this.decisions.get(decisionId);
    return decision && decision.userId === userId ? decision : undefined;
  }

  listDecisions(userId = "default-user", limit = 50): DecisionRecord[] {
    return [...this.decisions.values()]
      .filter((decision) => decision.userId === userId)
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
      .slice(0, limit);
  }

  latestDecision(userId = "default-user"): DecisionRecord | undefined {
    const [latest] = this.listDecisions(userId, 1);
    return latest;
  }

  latestMeaningfulDecision(userId = "default-user"): DecisionRecord | undefined {
    return this.listDecisions(userId).find((decision) => decision.decision !== "WAIT");
  }

  saveSetup(setup: SetupRecord): SetupRecord {
    this.setups.set(setup.setupId, setup);
    return setup;
  }

  getSetup(userId: string, setupId: string): SetupRecord | undefined {
    const setup = this.setups.get(setupId);
    return setup?.userId === userId ? setup : undefined;
  }

  getSetupByDecisionId(userId: string, decisionId: string): SetupRecord | undefined {
    return [...this.setups.values()].find((s) => s.userId === userId && s.decisionId === decisionId);
  }

  listSetups(userId: string, limit = 50, environment?: DecisionEnvironment): SetupRecord[] {
    return [...this.setups.values()]
      .filter((s) => s.userId === userId && (environment ? s.environment === environment : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  listActiveSetups(userId: string, environment?: DecisionEnvironment): SetupRecord[] {
    return this.listSetups(userId, 200, environment).filter(
      (s) => isActiveSetupStatus(s.status) && s.resolution === "OPEN"
    );
  }

  saveManualExecution(
    userId: string,
    setupId: string,
    record: ManualExecutionRecord
  ): SetupRecord | undefined {
    const existing = this.getSetup(userId, setupId);
    if (!existing) return undefined;
    const updated: SetupRecord = {
      ...existing,
      manualExecution: record,
      updatedAt: nowIso()
    };
    this.setups.set(setupId, updated);
    return updated;
  }

  recordSetupSkip(record: Omit<SetupSkipRecord, "id">): SetupSkipRecord {
    const full: SetupSkipRecord = { ...record, id: randomUUID() };
    this.setupSkips.unshift(full);
    this.setupSkips = this.setupSkips.slice(0, 100);
    return full;
  }

  listRecentSetupSkips(userId: string, limit = 20): SetupSkipRecord[] {
    return this.setupSkips.filter((s) => s.userId === userId).slice(0, limit);
  }

  private v4Shadows: Array<Record<string, unknown> & { userId: string }> = [];
  private v4Analyses = new Map<string, import("../v4/shadowTypes").V4ShadowAnalysisRecord[]>();
  private v4Candidates = new Map<string, import("../v4/shadowTypes").V4ShadowCandidateRecord[]>();
  private v4Plans = new Map<string, import("../v4/shadowTypes").V4LockedShadowPlan[]>();
  private v4Mutations = new Map<string, import("../v4/shadowTypes").V4PlanMutationAudit[]>();

  saveV4ShadowResult(userId: string, result: Record<string, unknown>): void {
    this.v4Shadows.unshift({ ...result, userId });
    this.v4Shadows = this.v4Shadows.slice(0, 200);
  }

  listV4ShadowResults(userId: string, limit = 50): Record<string, unknown>[] {
    return this.v4Shadows.filter((s) => s.userId === userId).slice(0, limit);
  }

  saveV4ShadowAnalysis(
    userId: string,
    analysis: import("../v4/shadowTypes").V4ShadowAnalysisRecord
  ): void {
    const list = this.v4Analyses.get(userId) ?? [];
    this.v4Analyses.set(
      userId,
      [analysis, ...list.filter((a) => a.analysisId !== analysis.analysisId)].slice(0, 500)
    );
  }

  listV4ShadowAnalyses(
    userId: string,
    environment?: DecisionEnvironment,
    limit = 50
  ): import("../v4/shadowTypes").V4ShadowAnalysisRecord[] {
    return (this.v4Analyses.get(userId) ?? [])
      .filter((a) => !environment || a.environment === environment)
      .slice(0, limit);
  }

  saveV4ShadowCandidate(
    userId: string,
    candidate: import("../v4/shadowTypes").V4ShadowCandidateRecord
  ): void {
    const list = this.v4Candidates.get(userId) ?? [];
    this.v4Candidates.set(
      userId,
      [candidate, ...list.filter((c) => c.candidateId !== candidate.candidateId)].slice(0, 500)
    );
  }

  listV4ShadowCandidates(
    userId: string,
    environment?: DecisionEnvironment,
    limit = 50
  ): import("../v4/shadowTypes").V4ShadowCandidateRecord[] {
    return (this.v4Candidates.get(userId) ?? [])
      .filter((c) => !environment || c.environment === environment)
      .slice(0, limit);
  }

  saveV4ShadowPlan(userId: string, plan: import("../v4/shadowTypes").V4LockedShadowPlan): void {
    const list = this.v4Plans.get(userId) ?? [];
    this.v4Plans.set(
      userId,
      [plan, ...list.filter((p) => p.planId !== plan.planId)].slice(0, 500)
    );
  }

  listV4ShadowPlans(
    userId: string,
    environment?: DecisionEnvironment,
    limit = 50
  ): import("../v4/shadowTypes").V4LockedShadowPlan[] {
    return (this.v4Plans.get(userId) ?? [])
      .filter((p) => !environment || p.environment === environment)
      .slice(0, limit);
  }

  recordV4PlanMutation(
    userId: string,
    audit: import("../v4/shadowTypes").V4PlanMutationAudit
  ): void {
    const list = this.v4Mutations.get(userId) ?? [];
    this.v4Mutations.set(userId, [audit, ...list].slice(0, 200));
  }

  listV4PlanMutations(
    userId: string,
    limit = 50
  ): import("../v4/shadowTypes").V4PlanMutationAudit[] {
    return (this.v4Mutations.get(userId) ?? []).slice(0, limit);
  }

  recordWebhookReject(log: Omit<WebhookRejectLog, "id">): void {
    this.webhookRejects.unshift({ ...log, id: randomUUID() });
    this.webhookRejects = this.webhookRejects.slice(0, 100);
  }

  listRecentWebhookRejects(limit = 20): WebhookRejectLog[] {
    return this.webhookRejects.slice(0, limit);
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

  upsertWebPushSubscription(subscription: WebPushSubscriptionRecord): WebPushSubscriptionRecord {
    this.webPushSubscriptions.set(subscription.subscriptionId, subscription);
    return subscription;
  }

  deleteWebPushSubscription(userId: string, endpoint: string): boolean {
    for (const [id, sub] of this.webPushSubscriptions.entries()) {
      if (sub.userId === userId && sub.endpoint === endpoint) {
        return this.webPushSubscriptions.delete(id);
      }
    }
    return false;
  }

  listWebPushSubscriptions(userId: string): WebPushSubscriptionRecord[] {
    return [...this.webPushSubscriptions.values()].filter((sub) => sub.userId === userId);
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
      liveForwardAckAt: null,
      manualRisk: { ...DEFAULT_MANUAL_RISK },
      manualRiskLimitChangeLog: [],
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

  markNotification(userId: string, key: string): boolean {
    const scopedKey = userScopedKey(userId, key);
    if (this.notifications.has(scopedKey)) {
      return false;
    }
    this.notifications.add(scopedKey);
    return true;
  }

  createWebhookConnection(input: CreateWebhookConnectionInput): WebhookConnection {
    const timestamp = nowIso();
    const connection: WebhookConnection = {
      ...input,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
      revokedAt: null,
      rotatedAt: null,
      lastAlertAt: null
    };
    this.webhookConnections.set(connection.webhookId, connection);
    return connection;
  }

  getWebhookConnection(userId: string, webhookId: string): WebhookConnection | undefined {
    const connection = this.getWebhookConnectionById(webhookId);
    return connection?.userId === userId ? connection : undefined;
  }

  getWebhookConnectionById(webhookId: string): WebhookConnection | undefined {
    const connection = this.webhookConnections.get(webhookId);
    return connection?.status === "ACTIVE" ? connection : undefined;
  }

  listWebhookConnections(userId: string): WebhookConnection[] {
    return [...this.webhookConnections.values()]
      .filter((connection) => connection.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  revokeWebhookConnection(userId: string, webhookId: string): WebhookConnection | undefined {
    const existing = this.getWebhookConnection(userId, webhookId);
    if (!existing) {
      return undefined;
    }
    const timestamp = nowIso();
    const updated: WebhookConnection = {
      ...existing,
      status: "REVOKED",
      revokedAt: timestamp,
      updatedAt: timestamp
    };
    this.webhookConnections.set(webhookId, updated);
    return updated;
  }

  rotateWebhookConnection(
    userId: string,
    webhookId: string,
    secret: string
  ): WebhookConnection | undefined {
    const existing = this.getWebhookConnection(userId, webhookId);
    if (!existing) {
      return undefined;
    }
    const timestamp = nowIso();
    const updated: WebhookConnection = {
      ...existing,
      secret,
      rotatedAt: timestamp,
      updatedAt: timestamp
    };
    this.webhookConnections.set(webhookId, updated);
    return updated;
  }

  updateWebhookLastAlert(webhookId: string, timestamp: string): void {
    const existing = this.webhookConnections.get(webhookId);
    if (!existing) {
      return;
    }
    this.webhookConnections.set(webhookId, {
      ...existing,
      lastAlertAt: timestamp,
      updatedAt: timestamp
    });
  }

  createProcessingJob(input: CreateProcessingJobInput): ProcessingJob {
    const timestamp = nowIso();
    const job: ProcessingJob = {
      jobId: randomUUID(),
      userId: input.userId,
      eventId: input.eventId,
      webhookId: input.webhookId,
      state: "QUEUED",
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      environment: input.environment ?? "LIVE",
      isTestDecision: input.isTestDecision ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
      lockedUntil: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      decisionId: null,
      errorMessage: null
    };
    this.processingJobs.set(job.jobId, job);
    return job;
  }

  getProcessingJob(jobId: string): ProcessingJob | undefined {
    return this.processingJobs.get(jobId);
  }

  claimProcessingJob(jobId: string, _workerId: string, lockMs: number): ProcessingJob | undefined {
    const existing = this.processingJobs.get(jobId);
    if (!existing || existing.state !== "QUEUED") {
      return undefined;
    }
    const timestamp = nowIso();
    const updated: ProcessingJob = {
      ...existing,
      state: "PROCESSING",
      lockedUntil: new Date(Date.now() + lockMs).toISOString(),
      startedAt: existing.startedAt ?? timestamp,
      updatedAt: timestamp
    };
    this.processingJobs.set(jobId, updated);
    return updated;
  }

  completeProcessingJob(jobId: string, decisionId: string): ProcessingJob | undefined {
    const existing = this.processingJobs.get(jobId);
    if (!existing) {
      return undefined;
    }
    const timestamp = nowIso();
    const updated: ProcessingJob = {
      ...existing,
      state: "COMPLETED",
      decisionId,
      completedAt: timestamp,
      lockedUntil: null,
      updatedAt: timestamp
    };
    this.processingJobs.set(jobId, updated);
    return updated;
  }

  failProcessingJob(jobId: string, error: Error | string): ProcessingJob | undefined {
    const existing = this.processingJobs.get(jobId);
    if (!existing) {
      return undefined;
    }
    const timestamp = nowIso();
    const retryCount = existing.retryCount + 1;
    const updated: ProcessingJob = {
      ...existing,
      state: retryCount >= existing.maxRetries ? "DEAD_LETTER" : "FAILED",
      retryCount,
      failedAt: timestamp,
      lockedUntil: null,
      errorMessage: error instanceof Error ? error.message : error,
      updatedAt: timestamp
    };
    this.processingJobs.set(jobId, updated);
    return updated;
  }

  checkAndStoreEventDedupe(userId: string, stableEventId: string): boolean {
    const key = userScopedKey(userId, stableEventId);
    if (this.eventDedupes.has(key)) {
      return false;
    }
    this.eventDedupes.add(key);
    return true;
  }

  reset(): void {
    this.rawEvents.clear();
    this.snapshots.clear();
    this.decisions.clear();
    this.setups.clear();
    this.devices.clear();
    this.journalEntries.clear();
    this.settings.clear();
    this.notifications.clear();
    this.webhookConnections.clear();
    this.processingJobs.clear();
    this.eventDedupes.clear();
    this.v4Shadows = [];
    this.v4Analyses.clear();
    this.v4Candidates.clear();
    this.v4Plans.clear();
    this.v4Mutations.clear();
  }
}

export class InMemoryStore extends InMemoryGoldMetaStore {}
export const globalStore = new InMemoryStore();
