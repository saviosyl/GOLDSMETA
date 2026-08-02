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
import type { ManualExecutionRecord, SetupSkipRecord } from "../../models/manualRisk";
import type { SetupRecord } from "../../models/setup";

export type Awaitable<T> = T | Promise<T>;

export type DecisionEnvironment = "LIVE" | "TEST";

export interface RawEventRecord {
  eventId: string;
  userId: string;
  receivedAt: string;
  payload: TradingViewPayload;
  webhookId?: string;
  environment?: DecisionEnvironment;
  isTestEvent?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookConnection {
  webhookId: string;
  userId: string;
  /** @deprecated Prefer secretHash — plaintext only briefly returned on create/rotate. */
  secret: string | null;
  /** SHA-256 hex of webhook secret — never returned to clients. */
  secretHash?: string | null;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  updatedAt: string;
  revokedAt?: string | null;
  rotatedAt?: string | null;
  lastAlertAt?: string | null;
  templateId?: string | null;
  templateMode?: "standard" | "custom" | null;
}

export type ProcessingJobState =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "DEAD_LETTER";

export interface ProcessingJob {
  jobId: string;
  userId: string;
  eventId: string;
  webhookId?: string;
  state: ProcessingJobState;
  retryCount: number;
  maxRetries: number;
  environment: DecisionEnvironment;
  isTestDecision: boolean;
  createdAt: string;
  updatedAt: string;
  lockedUntil?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  decisionId?: string | null;
  errorMessage?: string | null;
}

export interface SaveRawEventOptions {
  webhookId?: string;
  environment?: DecisionEnvironment;
  isTestEvent?: boolean;
}

export interface CreateWebhookConnectionInput {
  userId: string;
  webhookId: string;
  secret: string | null;
  secretHash?: string | null;
  templateId?: string | null;
  templateMode?: "standard" | "custom" | null;
}

export interface CreateProcessingJobInput {
  userId: string;
  eventId: string;
  webhookId?: string;
  environment?: DecisionEnvironment;
  isTestDecision?: boolean;
  maxRetries?: number;
}

export interface WebhookRejectLog {
  id: string;
  webhookId: string | null;
  at: string;
  code: string;
  message: string;
  details?: string[];
}

export interface GoldMetaStore {
  saveRawEvent(
    userId: string,
    payload: TradingViewPayload,
    stableEventId: string,
    options?: SaveRawEventOptions
  ): Awaitable<RawEventRecord>;
  getRawEvent(userId: string, eventId: string): Awaitable<RawEventRecord | undefined>;
  enqueueAcceptedEvent(
    userId: string,
    payload: TradingViewPayload,
    stableEventId: string,
    options?: SaveRawEventOptions
  ): Awaitable<RawEventRecord>;

  saveSnapshot(userId: string, snapshot: MarketSnapshot): Awaitable<MarketSnapshot>;
  getSnapshot(userId: string, snapshotId: string): Awaitable<MarketSnapshot | undefined>;

  saveDecision(decision: DecisionRecord): Awaitable<DecisionRecord>;
  getDecision(userId: string, decisionId: string): Awaitable<DecisionRecord | undefined>;
  listDecisions(userId: string, limit?: number): Awaitable<DecisionRecord[]>;
  latestDecision(userId: string): Awaitable<DecisionRecord | undefined>;
  latestMeaningfulDecision(userId: string): Awaitable<DecisionRecord | undefined>;

  saveSetup(setup: SetupRecord): Awaitable<SetupRecord>;
  getSetup(userId: string, setupId: string): Awaitable<SetupRecord | undefined>;
  getSetupByDecisionId(userId: string, decisionId: string): Awaitable<SetupRecord | undefined>;
  listSetups(
    userId: string,
    limit?: number,
    environment?: DecisionEnvironment
  ): Awaitable<SetupRecord[]>;
  listActiveSetups(userId: string, environment?: DecisionEnvironment): Awaitable<SetupRecord[]>;
  saveManualExecution(
    userId: string,
    setupId: string,
    record: ManualExecutionRecord
  ): Awaitable<SetupRecord | undefined>;
  recordSetupSkip(record: Omit<SetupSkipRecord, "id">): Awaitable<SetupSkipRecord>;
  listRecentSetupSkips(userId: string, limit?: number): Awaitable<SetupSkipRecord[]>;

  /** V4 shadow results — never overwrite V3 decisions/setups. */
  saveV4ShadowResult?(userId: string, result: Record<string, unknown>): Awaitable<void>;
  listV4ShadowResults?(userId: string, limit?: number): Awaitable<Record<string, unknown>[]>;
  saveV4ShadowAnalysis?(userId: string, analysis: import("../v4/shadowTypes").V4ShadowAnalysisRecord): Awaitable<void>;
  listV4ShadowAnalyses?(
    userId: string,
    environment?: DecisionEnvironment,
    limit?: number
  ): Awaitable<import("../v4/shadowTypes").V4ShadowAnalysisRecord[]>;
  saveV4ShadowCandidate?(userId: string, candidate: import("../v4/shadowTypes").V4ShadowCandidateRecord): Awaitable<void>;
  listV4ShadowCandidates?(
    userId: string,
    environment?: DecisionEnvironment,
    limit?: number
  ): Awaitable<import("../v4/shadowTypes").V4ShadowCandidateRecord[]>;
  saveV4ShadowPlan?(userId: string, plan: import("../v4/shadowTypes").V4LockedShadowPlan): Awaitable<void>;
  listV4ShadowPlans?(
    userId: string,
    environment?: DecisionEnvironment,
    limit?: number
  ): Awaitable<import("../v4/shadowTypes").V4LockedShadowPlan[]>;
  recordV4PlanMutation?(userId: string, audit: import("../v4/shadowTypes").V4PlanMutationAudit): Awaitable<void>;
  listV4PlanMutations?(
    userId: string,
    limit?: number
  ): Awaitable<import("../v4/shadowTypes").V4PlanMutationAudit[]>;

  registerDevice(device: DeviceRecord): Awaitable<DeviceRecord>;
  deleteDevice(userId: string, deviceId: string): Awaitable<boolean>;
  listDevices(userId: string): Awaitable<DeviceRecord[]>;

  upsertWebPushSubscription(subscription: WebPushSubscriptionRecord): Awaitable<WebPushSubscriptionRecord>;
  deleteWebPushSubscription(userId: string, endpoint: string): Awaitable<boolean>;
  listWebPushSubscriptions(userId: string): Awaitable<WebPushSubscriptionRecord[]>;

  getSettings(userId: string): Awaitable<UserSettings>;
  updateSettings(
    userId: string,
    patch: Partial<Omit<UserSettings, "userId" | "updatedAt">>
  ): Awaitable<UserSettings>;

  createJournalEntry(userId: string, input: JournalCreate): Awaitable<JournalEntry>;
  patchJournalEntry(
    userId: string,
    journalId: string,
    patch: JournalPatch
  ): Awaitable<JournalEntry | undefined>;
  listJournalEntries(userId: string): Awaitable<JournalEntry[]>;

  markNotification(userId: string, key: string): Awaitable<boolean>;

  createWebhookConnection(input: CreateWebhookConnectionInput): Awaitable<WebhookConnection>;
  getWebhookConnection(userId: string, webhookId: string): Awaitable<WebhookConnection | undefined>;
  getWebhookConnectionById(webhookId: string): Awaitable<WebhookConnection | undefined>;
  listWebhookConnections(userId: string): Awaitable<WebhookConnection[]>;
  revokeWebhookConnection(userId: string, webhookId: string): Awaitable<WebhookConnection | undefined>;
  rotateWebhookConnection(
    userId: string,
    webhookId: string,
    secret: string,
    secretHash?: string | null
  ): Awaitable<WebhookConnection | undefined>;
  updateWebhookLastAlert(webhookId: string, timestamp: string): Awaitable<void>;

  createProcessingJob(input: CreateProcessingJobInput): Awaitable<ProcessingJob>;
  getProcessingJob(jobId: string): Awaitable<ProcessingJob | undefined>;
  claimProcessingJob(
    jobId: string,
    workerId: string,
    lockMs: number
  ): Awaitable<ProcessingJob | undefined>;
  completeProcessingJob(jobId: string, decisionId: string): Awaitable<ProcessingJob | undefined>;
  failProcessingJob(jobId: string, error: Error | string): Awaitable<ProcessingJob | undefined>;

  checkAndStoreEventDedupe(userId: string, stableEventId: string): Awaitable<boolean>;

  recordWebhookReject?(log: Omit<WebhookRejectLog, "id">): Awaitable<void>;
  listRecentWebhookRejects?(limit?: number): Awaitable<WebhookRejectLog[]>;
}
