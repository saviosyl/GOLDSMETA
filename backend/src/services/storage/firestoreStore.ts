import { randomUUID } from "crypto";
import type { Firestore, Query, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
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
import type { SessionPlanRecord } from "../decision/sessionPlanTypes";
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

const webhookConnectionSchema = z.object({
  webhookId: z.string(),
  userId: z.string(),
  secret: z.string().nullable(),
  secretHash: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  revokedAt: z.string().nullable().optional(),
  rotatedAt: z.string().nullable().optional(),
  lastAlertAt: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  templateMode: z.enum(["standard", "custom"]).nullable().optional()
});

const processingJobSchema = z.object({
  jobId: z.string(),
  userId: z.string(),
  eventId: z.string(),
  webhookId: z.string().optional(),
  state: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "DEAD_LETTER"]),
  retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(1),
  environment: z.enum(["LIVE", "TEST"]),
  isTestDecision: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lockedUntil: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  decisionId: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional()
});

const rawEventSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  receivedAt: z.string(),
  payload: z.unknown(),
  webhookId: z.string().optional(),
  environment: z.enum(["LIVE", "TEST"]).optional(),
  isTestEvent: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const stripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)])
    );
  }
  return value;
};

const toFirestoreData = <T>(value: T): FirebaseFirestore.DocumentData =>
  stripUndefined(value) as FirebaseFirestore.DocumentData;

const defaultSettings = (userId: string): UserSettings => ({
  userId,
  aiEnabled: false,
  notificationsEnabled: true,
  provisionalSignalsEnabled: false,
  riskProfile: "BALANCED",
  liveForwardAckAt: null,
  manualRisk: { ...DEFAULT_MANUAL_RISK },
  manualRiskLimitChangeLog: [],
  updatedAt: nowIso()
});

export class FirestoreGoldMetaStore implements GoldMetaStore {
  constructor(private readonly db: Firestore) {}

  async saveRawEvent(
    userId: string,
    payload: TradingViewPayload,
    stableEventId: string,
    options: SaveRawEventOptions = {}
  ): Promise<RawEventRecord> {
    const ref = this.rawEventRef(userId, stableEventId);
    const timestamp = nowIso();
    const existing = await ref.get();
    const existingData = existing.exists
      ? rawEventSchema.parse(existing.data()) as RawEventRecord
      : undefined;
    const record: RawEventRecord = {
      ...existingData,
      eventId: stableEventId,
      userId,
      receivedAt: existingData?.receivedAt ?? timestamp,
      payload,
      webhookId: options.webhookId ?? existingData?.webhookId,
      environment: options.environment ?? existingData?.environment,
      isTestEvent: options.isTestEvent ?? existingData?.isTestEvent,
      createdAt: existingData?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    await ref.set(toFirestoreData(record), { merge: true });
    return record;
  }

  enqueueAcceptedEvent(
    userId: string,
    payload: TradingViewPayload,
    stableEventId: string,
    options: SaveRawEventOptions = {}
  ): Promise<RawEventRecord> {
    return this.saveRawEvent(userId, payload, stableEventId, options);
  }

  async getRawEvent(userId: string, eventId: string): Promise<RawEventRecord | undefined> {
    const snap = await this.rawEventRef(userId, eventId).get();
    if (!snap.exists) {
      return undefined;
    }
    return rawEventSchema.parse(snap.data()) as RawEventRecord;
  }

  async saveSnapshot(userId: string, snapshot: MarketSnapshot): Promise<MarketSnapshot> {
    await this.db
      .collection("users")
      .doc(userId)
      .collection("marketSnapshots")
      .doc(snapshot.id)
      .set(toFirestoreData(snapshot), { merge: true });
    return snapshot;
  }

  async getSnapshot(userId: string, snapshotId: string): Promise<MarketSnapshot | undefined> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("marketSnapshots")
      .doc(snapshotId)
      .get();
    return snap.exists ? snap.data() as MarketSnapshot : undefined;
  }

  async saveDecision(decision: DecisionRecord): Promise<DecisionRecord> {
    await this.db
      .collection("users")
      .doc(decision.userId)
      .collection("decisions")
      .doc(decision.decisionId)
      .set(toFirestoreData(decision), { merge: true });
    return decision;
  }

  async getDecision(userId: string, decisionId: string): Promise<DecisionRecord | undefined> {
    // Prefer the user-scoped document path. Collection-group queries on
    // decisionId require an extra index and currently fail in production.
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("decisions")
      .doc(decisionId)
      .get();
    return snap.exists ? (snap.data() as DecisionRecord) : undefined;
  }

  async listDecisions(userId: string, limit = 50): Promise<DecisionRecord[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("decisions")
      .orderBy("generatedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((doc) => doc.data() as DecisionRecord);
  }

  async latestDecision(userId: string): Promise<DecisionRecord | undefined> {
    const [latest] = await this.listDecisions(userId, 1);
    return latest;
  }

  async latestMeaningfulDecision(userId: string): Promise<DecisionRecord | undefined> {
    return (await this.listDecisions(userId, 50)).find((decision) => decision.decision !== "WAIT");
  }

  async saveSetup(setup: SetupRecord): Promise<SetupRecord> {
    await this.db
      .collection("users")
      .doc(setup.userId)
      .collection("setups")
      .doc(setup.setupId)
      .set(toFirestoreData(setup), { merge: true });
    return setup;
  }

  async getSetup(userId: string, setupId: string): Promise<SetupRecord | undefined> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("setups")
      .doc(setupId)
      .get();
    return snap.exists ? (snap.data() as SetupRecord) : undefined;
  }

  async getSetupByDecisionId(userId: string, decisionId: string): Promise<SetupRecord | undefined> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("setups")
      .where("decisionId", "==", decisionId)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    return doc ? (doc.data() as SetupRecord) : undefined;
  }

  async listSetups(
    userId: string,
    limit = 50,
    environment?: DecisionEnvironment
  ): Promise<SetupRecord[]> {
    let query: Query = this.db
      .collection("users")
      .doc(userId)
      .collection("setups");
    if (environment) {
      query = query.where("environment", "==", environment);
    }
    const snap = await query.orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((doc) => doc.data() as SetupRecord);
  }

  async listActiveSetups(
    userId: string,
    environment?: DecisionEnvironment
  ): Promise<SetupRecord[]> {
    const setups = await this.listSetups(userId, 200, environment);
    return setups.filter((s) => isActiveSetupStatus(s.status) && s.resolution === "OPEN");
  }

  async saveManualExecution(
    userId: string,
    setupId: string,
    record: ManualExecutionRecord
  ): Promise<SetupRecord | undefined> {
    const existing = await this.getSetup(userId, setupId);
    if (!existing) return undefined;
    const updated: SetupRecord = {
      ...existing,
      manualExecution: record,
      updatedAt: nowIso()
    };
    await this.saveSetup(updated);
    return updated;
  }

  async recordSetupSkip(record: Omit<SetupSkipRecord, "id">): Promise<SetupSkipRecord> {
    const id = randomUUID();
    const full: SetupSkipRecord = { ...record, id };
    await this.db
      .collection("users")
      .doc(record.userId)
      .collection("setupSkips")
      .doc(id)
      .set(toFirestoreData(full));
    return full;
  }

  async listRecentSetupSkips(userId: string, limit = 20): Promise<SetupSkipRecord[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("setupSkips")
      .orderBy("at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as SetupSkipRecord);
  }

  async saveV4ShadowResult(userId: string, result: Record<string, unknown>): Promise<void> {
    const shadowId =
      typeof result.shadowId === "string" ? result.shadowId : `v4_${Date.now()}`;
    await this.db
      .collection("users")
      .doc(userId)
      .collection("v4Shadows")
      .doc(shadowId)
      .set(toFirestoreData({ ...result, userId, shadowId }), { merge: true });
  }

  async listV4ShadowResults(userId: string, limit = 50): Promise<Record<string, unknown>[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("v4Shadows")
      .orderBy("generatedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as Record<string, unknown>);
  }

  async saveV4ShadowAnalysis(
    userId: string,
    analysis: import("../v4/shadowTypes").V4ShadowAnalysisRecord
  ): Promise<void> {
    await this.db
      .collection("users")
      .doc(userId)
      .collection("v4Analyses")
      .doc(analysis.analysisId)
      .set(toFirestoreData(analysis), { merge: true });
  }

  async listV4ShadowAnalyses(
    userId: string,
    environment?: DecisionEnvironment,
    limit = 50
  ): Promise<import("../v4/shadowTypes").V4ShadowAnalysisRecord[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("v4Analyses")
      .orderBy("generatedAt", "desc")
      .limit(Math.max(limit * 3, 50))
      .get();
    const rows = snap.docs.map(
      (d) => d.data() as import("../v4/shadowTypes").V4ShadowAnalysisRecord
    );
    return rows.filter((a) => !environment || a.environment === environment).slice(0, limit);
  }

  async saveV4ShadowCandidate(
    userId: string,
    candidate: import("../v4/shadowTypes").V4ShadowCandidateRecord
  ): Promise<void> {
    await this.db
      .collection("users")
      .doc(userId)
      .collection("v4Candidates")
      .doc(candidate.candidateId)
      .set(toFirestoreData(candidate), { merge: true });
  }

  async listV4ShadowCandidates(
    userId: string,
    environment?: DecisionEnvironment,
    limit = 50
  ): Promise<import("../v4/shadowTypes").V4ShadowCandidateRecord[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("v4Candidates")
      .orderBy("updatedAt", "desc")
      .limit(Math.max(limit * 3, 50))
      .get();
    const rows = snap.docs.map(
      (d) => d.data() as import("../v4/shadowTypes").V4ShadowCandidateRecord
    );
    return rows.filter((c) => !environment || c.environment === environment).slice(0, limit);
  }

  async saveV4ShadowPlan(
    userId: string,
    plan: import("../v4/shadowTypes").V4LockedShadowPlan
  ): Promise<void> {
    await this.db
      .collection("users")
      .doc(userId)
      .collection("v4ShadowPlans")
      .doc(plan.planId)
      .set(toFirestoreData(plan), { merge: true });
  }

  async listV4ShadowPlans(
    userId: string,
    environment?: DecisionEnvironment,
    limit = 50
  ): Promise<import("../v4/shadowTypes").V4LockedShadowPlan[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("v4ShadowPlans")
      .orderBy("updatedAt", "desc")
      .limit(Math.max(limit * 3, 50))
      .get();
    const rows = snap.docs.map(
      (d) => d.data() as import("../v4/shadowTypes").V4LockedShadowPlan
    );
    return rows.filter((p) => !environment || p.environment === environment).slice(0, limit);
  }

  async recordV4PlanMutation(
    userId: string,
    audit: import("../v4/shadowTypes").V4PlanMutationAudit
  ): Promise<void> {
    await this.db
      .collection("users")
      .doc(userId)
      .collection("v4PlanMutations")
      .doc(audit.id)
      .set(toFirestoreData(audit), { merge: true });
  }

  async listV4PlanMutations(
    userId: string,
    limit = 50
  ): Promise<import("../v4/shadowTypes").V4PlanMutationAudit[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("v4PlanMutations")
      .orderBy("at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as import("../v4/shadowTypes").V4PlanMutationAudit);
  }

  async saveSessionPlan(plan: SessionPlanRecord): Promise<SessionPlanRecord> {
    const batch = this.db.batch();
    const planRef = this.db
      .collection("users")
      .doc(plan.userId)
      .collection("sessionPlans")
      .doc(plan.planId);
    const activeRef = this.db
      .collection("users")
      .doc(plan.userId)
      .collection("sessionPlans")
      .doc("active");
    batch.set(planRef, toFirestoreData(plan), { merge: true });
    batch.set(activeRef, toFirestoreData({ ...plan, activePointer: true }), { merge: true });
    await batch.commit();
    return plan;
  }

  async getActiveSessionPlan(userId: string): Promise<SessionPlanRecord | undefined> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("sessionPlans")
      .doc("active")
      .get();
    if (!snap.exists) return undefined;
    const data = snap.data() as SessionPlanRecord & { activePointer?: boolean };
    const { activePointer: _pointer, ...plan } = data;
    return plan as SessionPlanRecord;
  }

  async getSessionPlan(userId: string, planId: string): Promise<SessionPlanRecord | undefined> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("sessionPlans")
      .doc(planId)
      .get();
    if (!snap.exists) return undefined;
    return snap.data() as SessionPlanRecord;
  }

  async registerDevice(device: DeviceRecord): Promise<DeviceRecord> {
    await this.db
      .collection("users")
      .doc(device.userId)
      .collection("devices")
      .doc(device.deviceId)
      .set(toFirestoreData(device), { merge: true });
    return device;
  }

  async deleteDevice(userId: string, deviceId: string): Promise<boolean> {
    const ref = this.db.collection("users").doc(userId).collection("devices").doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) {
      return false;
    }
    await ref.delete();
    return true;
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    const snap = await this.db.collection("users").doc(userId).collection("devices").get();
    return snap.docs.map((doc) => doc.data() as DeviceRecord);
  }

  async upsertWebPushSubscription(
    subscription: WebPushSubscriptionRecord
  ): Promise<WebPushSubscriptionRecord> {
    await this.db
      .collection("users")
      .doc(subscription.userId)
      .collection("webPushSubscriptions")
      .doc(subscription.subscriptionId)
      .set(toFirestoreData(subscription), { merge: true });
    return subscription;
  }

  async deleteWebPushSubscription(userId: string, endpoint: string): Promise<boolean> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("webPushSubscriptions")
      .where("endpoint", "==", endpoint)
      .limit(5)
      .get();
    if (snap.empty) {
      return false;
    }
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
    return true;
  }

  async listWebPushSubscriptions(userId: string): Promise<WebPushSubscriptionRecord[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("webPushSubscriptions")
      .get();
    return snap.docs.map((doc) => doc.data() as WebPushSubscriptionRecord);
  }

  async getSettings(userId: string): Promise<UserSettings> {
    const ref = this.db.collection("users").doc(userId).collection("settings").doc("main");
    const snap = await ref.get();
    if (snap.exists) {
      return snap.data() as UserSettings;
    }
    const settings = defaultSettings(userId);
    await ref.set(toFirestoreData(settings), { merge: true });
    return settings;
  }

  async updateSettings(
    userId: string,
    patch: Partial<Omit<UserSettings, "userId" | "updatedAt">>
  ): Promise<UserSettings> {
    const updated: UserSettings = {
      ...(await this.getSettings(userId)),
      ...patch,
      updatedAt: nowIso()
    };
    await this.db
      .collection("users")
      .doc(userId)
      .collection("settings")
      .doc("main")
      .set(toFirestoreData(updated), { merge: true });
    return updated;
  }

  async createJournalEntry(userId: string, input: JournalCreate): Promise<JournalEntry> {
    const timestamp = nowIso();
    const entry: JournalEntry = {
      ...input,
      journalId: randomUUID(),
      userId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.db
      .collection("users")
      .doc(userId)
      .collection("journalEntries")
      .doc(entry.journalId)
      .set(toFirestoreData(entry));
    return entry;
  }

  async patchJournalEntry(
    userId: string,
    journalId: string,
    patch: JournalPatch
  ): Promise<JournalEntry | undefined> {
    const ref = this.db.collection("users").doc(userId).collection("journalEntries").doc(journalId);
    const snap = await ref.get();
    if (!snap.exists) {
      return undefined;
    }
    const updated: JournalEntry = {
      ...snap.data() as JournalEntry,
      ...patch,
      updatedAt: nowIso()
    };
    await ref.set(toFirestoreData(updated), { merge: true });
    return updated;
  }

  async listJournalEntries(userId: string): Promise<JournalEntry[]> {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("journalEntries")
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map((doc) => doc.data() as JournalEntry);
  }

  async markNotification(userId: string, key: string): Promise<boolean> {
    const ref = this.db.collection("users").doc(userId).collection("notificationEvents").doc(key);
    try {
      await ref.create({ userId, key, createdAt: nowIso() });
      return true;
    } catch (error: unknown) {
      if (this.isAlreadyExists(error)) {
        return false;
      }
      throw error;
    }
  }

  async createWebhookConnection(input: CreateWebhookConnectionInput): Promise<WebhookConnection> {
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
    await this.webhookConnectionRef(connection.webhookId).set(toFirestoreData(connection));
    return connection;
  }

  async getWebhookConnection(
    userId: string,
    webhookId: string
  ): Promise<WebhookConnection | undefined> {
    const connection = await this.getWebhookConnectionById(webhookId);
    return connection?.userId === userId ? connection : undefined;
  }

  async getWebhookConnectionById(webhookId: string): Promise<WebhookConnection | undefined> {
    const snap = await this.webhookConnectionRef(webhookId).get();
    if (!snap.exists) {
      return undefined;
    }
    const connection = webhookConnectionSchema.parse(snap.data());
    return connection.status === "ACTIVE" ? connection : undefined;
  }

  async listWebhookConnections(userId: string): Promise<WebhookConnection[]> {
    const snap = await this.db
      .collection("webhookConnections")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map((doc) => webhookConnectionSchema.parse(doc.data()));
  }

  async revokeWebhookConnection(
    userId: string,
    webhookId: string
  ): Promise<WebhookConnection | undefined> {
    const existing = await this.getWebhookConnection(userId, webhookId);
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
    await this.webhookConnectionRef(webhookId).set(toFirestoreData(updated), { merge: true });
    return updated;
  }

  async rotateWebhookConnection(
    userId: string,
    webhookId: string,
    secret: string,
    secretHash?: string | null
  ): Promise<WebhookConnection | undefined> {
    const existing = await this.getWebhookConnection(userId, webhookId);
    if (!existing) {
      return undefined;
    }
    const timestamp = nowIso();
    const updated: WebhookConnection = {
      ...existing,
      // Prefer hash-only persistence when hash provided
      secret: secretHash ? null : secret,
      secretHash: secretHash ?? existing.secretHash ?? null,
      rotatedAt: timestamp,
      updatedAt: timestamp
    };
    await this.webhookConnectionRef(webhookId).set(toFirestoreData(updated), { merge: true });
    return updated;
  }

  async updateWebhookLastAlert(webhookId: string, timestamp: string): Promise<void> {
    await this.webhookConnectionRef(webhookId).set(
      {
        lastAlertAt: timestamp,
        updatedAt: timestamp
      },
      { merge: true }
    );
  }

  async createProcessingJob(input: CreateProcessingJobInput): Promise<ProcessingJob> {
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
    await this.processingJobRef(job.jobId).set(toFirestoreData(job));
    return job;
  }

  async getProcessingJob(jobId: string): Promise<ProcessingJob | undefined> {
    const snap = await this.processingJobRef(jobId).get();
    return snap.exists ? processingJobSchema.parse(snap.data()) : undefined;
  }

  claimProcessingJob(
    jobId: string,
    _workerId: string,
    lockMs: number
  ): Promise<ProcessingJob | undefined> {
    return this.db.runTransaction(async (transaction) => {
      const ref = this.processingJobRef(jobId);
      const existing = await this.getJobInTransaction(transaction, jobId);
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
      transaction.set(ref, toFirestoreData(updated), { merge: true });
      return updated;
    });
  }

  completeProcessingJob(jobId: string, decisionId: string): Promise<ProcessingJob | undefined> {
    return this.db.runTransaction(async (transaction) => {
      const ref = this.processingJobRef(jobId);
      const existing = await this.getJobInTransaction(transaction, jobId);
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
      transaction.set(ref, toFirestoreData(updated), { merge: true });
      return updated;
    });
  }

  failProcessingJob(jobId: string, error: Error | string): Promise<ProcessingJob | undefined> {
    return this.db.runTransaction(async (transaction) => {
      const ref = this.processingJobRef(jobId);
      const existing = await this.getJobInTransaction(transaction, jobId);
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
      transaction.set(ref, toFirestoreData(updated), { merge: true });
      return updated;
    });
  }

  async checkAndStoreEventDedupe(userId: string, stableEventId: string): Promise<boolean> {
    const ref = this.db
      .collection("users")
      .doc(userId)
      .collection("eventDedupes")
      .doc(stableEventId);
    try {
      await ref.create({ userId, stableEventId, createdAt: nowIso() });
      return true;
    } catch (error: unknown) {
      if (this.isAlreadyExists(error)) {
        return false;
      }
      throw error;
    }
  }

  async recordWebhookReject(log: Omit<WebhookRejectLog, "id">): Promise<void> {
    const id = randomUUID();
    await this.db
      .collection("system")
      .doc("webhookRejects")
      .collection("items")
      .doc(id)
      .set(toFirestoreData({ ...log, id }));
  }

  async listRecentWebhookRejects(limit = 20): Promise<WebhookRejectLog[]> {
    const snap = await this.db
      .collection("system")
      .doc("webhookRejects")
      .collection("items")
      .orderBy("at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((doc) => doc.data() as WebhookRejectLog);
  }

  private rawEventRef(userId: string, eventId: string): FirebaseFirestore.DocumentReference {
    return this.db.collection("users").doc(userId).collection("rawEvents").doc(eventId);
  }

  private webhookConnectionRef(webhookId: string): FirebaseFirestore.DocumentReference {
    return this.db.collection("webhookConnections").doc(webhookId);
  }

  private processingJobRef(jobId: string): FirebaseFirestore.DocumentReference {
    return this.db.collection("processingJobs").doc(jobId);
  }

  private async getJobInTransaction(
    transaction: Transaction,
    jobId: string
  ): Promise<ProcessingJob | undefined> {
    const snap = await transaction.get(this.processingJobRef(jobId));
    return snap.exists ? processingJobSchema.parse(snap.data()) : undefined;
  }

  private isAlreadyExists(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return false;
    }

    return error.code === 6 || error.code === "already-exists";
  }
}
