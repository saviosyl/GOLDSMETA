/* eslint-disable @typescript-eslint/require-await -- sync in-memory impl of async port */
/**
 * Durable outcome-monitor jobs — independent of decision processingJobs.
 * Per-signal child jobs keyed by userId+signalId+symbol+timeframe+barTime+eventId.
 * Failed monitoring retries with exponential backoff; never permanently lost
 * when the decision job completes.
 */

import { createHash, randomUUID } from "crypto";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { nowIso } from "../../utils/time";
import { logger } from "../logging/logger";
import { getFirestoreDb } from "../firebaseAdmin";
import type { OutcomeMonitorJob, SignalBarApplyStatus, SignalBarInput } from "./types";
import {
  allowInMemorySignalOutcomeStore,
  SignalOutcomeStorageUnavailableError
} from "./storagePolicy";

/** Per-signal child job id — chronological ordering is by barTime within signalId. */
export function outcomeMonitorJobId(parts: {
  userId: string;
  signalId: string;
  symbol: string;
  timeframe: string | null;
  barTime: string;
  eventId: string;
}): string {
  return createHash("sha256")
    .update(
      `outcome-monitor|${parts.userId}|${parts.signalId}|${parts.symbol}|${parts.timeframe ?? ""}|${parts.barTime}|${parts.eventId}`
    )
    .digest("hex")
    .slice(0, 40);
}

export function backoffMs(retryCount: number): number {
  // 5s, 20s, 80s, 320s, … capped at 1h — never immediate retry loop
  return Math.min(3_600_000, 5_000 * Math.pow(4, Math.max(0, retryCount)));
}

/** Statuses that may complete a per-signal job (no durable retry required). */
export const SAFE_COMPLETE_APPLY_STATUSES: ReadonlySet<SignalBarApplyStatus> = new Set([
  "APPLIED",
  "DUPLICATE",
  "TERMINAL",
  "IDENTITY_MISMATCH",
  "SAME_CANDLE_SKIP",
  "NOT_FOUND"
]);

/** Statuses that must durable-retry with backoff. */
export const RETRY_APPLY_STATUSES: ReadonlySet<SignalBarApplyStatus> = new Set([
  "LEASE_BUSY",
  "OUT_OF_ORDER_WAIT"
]);

export interface EnqueueOutcomeMonitorInput {
  userId: string;
  signalId: string;
  eventId: string;
  bar: SignalBarInput;
  maxRetries?: number;
}

export interface OutcomeMonitorJobStore {
  enqueue(input: EnqueueOutcomeMonitorInput): Promise<OutcomeMonitorJob>;
  get(jobId: string): Promise<OutcomeMonitorJob | null>;
  claim(
    jobId: string,
    ownerId: string,
    leaseMs: number
  ): Promise<OutcomeMonitorJob | null>;
  complete(
    jobId: string,
    lastApplyStatus?: SignalBarApplyStatus | null
  ): Promise<OutcomeMonitorJob | null>;
  fail(
    jobId: string,
    error: Error | string,
    auditReason: string,
    lastApplyStatus?: SignalBarApplyStatus | null
  ): Promise<OutcomeMonitorJob | null>;
  listDue(limit?: number): Promise<OutcomeMonitorJob[]>;
  /**
   * Incomplete jobs for the same signal with chronologically earlier barTime.
   * Blocks later bars so T2 cannot permanently discard T1.
   */
  listEarlierIncomplete(
    signalId: string,
    barTime: string,
    excludeJobId?: string
  ): Promise<OutcomeMonitorJob[]>;
}

function buildJob(input: EnqueueOutcomeMonitorInput, existing?: OutcomeMonitorJob | null): OutcomeMonitorJob {
  const now = nowIso();
  const jobId = outcomeMonitorJobId({
    userId: input.userId,
    signalId: input.signalId,
    symbol: input.bar.symbol,
    timeframe: input.bar.timeframe,
    barTime: input.bar.barTime,
    eventId: input.eventId
  });
  return {
    jobId,
    userId: input.userId,
    signalId: input.signalId,
    eventId: input.eventId,
    bar: structuredClone(input.bar),
    barTime: input.bar.barTime,
    symbol: input.bar.symbol,
    timeframe: input.bar.timeframe ?? null,
    state: "QUEUED",
    retryCount: existing?.retryCount ?? 0,
    maxRetries: input.maxRetries ?? 8,
    nextAttemptAt: now,
    leaseOwnerId: null,
    leaseUntil: null,
    auditReason: existing?.state === "FAILED" ? "REQUEUED_FROM_DECISION" : null,
    errorMessage: null,
    lastApplyStatus: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedAt: null
  };
}

const INCOMPLETE_STATES = new Set(["QUEUED", "PROCESSING", "FAILED"]);

export class InMemoryOutcomeMonitorJobStore implements OutcomeMonitorJobStore {
  private readonly jobs = new Map<string, OutcomeMonitorJob>();

  async enqueue(input: EnqueueOutcomeMonitorInput): Promise<OutcomeMonitorJob> {
    const jobId = outcomeMonitorJobId({
      userId: input.userId,
      signalId: input.signalId,
      symbol: input.bar.symbol,
      timeframe: input.bar.timeframe,
      barTime: input.bar.barTime,
      eventId: input.eventId
    });
    const existing = this.jobs.get(jobId);
    if (
      existing &&
      (existing.state === "QUEUED" ||
        existing.state === "PROCESSING" ||
        existing.state === "COMPLETED")
    ) {
      return structuredClone(existing);
    }
    const job = buildJob(input, existing ?? null);
    this.jobs.set(jobId, job);
    return structuredClone(job);
  }

  async get(jobId: string): Promise<OutcomeMonitorJob | null> {
    const j = this.jobs.get(jobId);
    return j ? structuredClone(j) : null;
  }

  async claim(
    jobId: string,
    ownerId: string,
    leaseMs: number
  ): Promise<OutcomeMonitorJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const now = Date.now();
    if (job.state === "COMPLETED" || job.state === "DEAD_LETTER") return null;
    if (job.state === "PROCESSING") {
      const until = job.leaseUntil ? Date.parse(job.leaseUntil) : 0;
      if (until > now && job.leaseOwnerId !== ownerId) return null;
    }
    if (job.state === "FAILED" || job.state === "QUEUED") {
      if (Date.parse(job.nextAttemptAt) > now) return null;
    }
    job.state = "PROCESSING";
    job.leaseOwnerId = ownerId;
    job.leaseUntil = new Date(now + leaseMs).toISOString();
    job.updatedAt = nowIso();
    this.jobs.set(jobId, job);
    return structuredClone(job);
  }

  async complete(
    jobId: string,
    lastApplyStatus: SignalBarApplyStatus | null = "APPLIED"
  ): Promise<OutcomeMonitorJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.state = "COMPLETED";
    job.leaseOwnerId = null;
    job.leaseUntil = null;
    job.completedAt = nowIso();
    job.updatedAt = job.completedAt;
    job.auditReason = "MONITOR_COMPLETED";
    job.lastApplyStatus = lastApplyStatus;
    this.jobs.set(jobId, job);
    return structuredClone(job);
  }

  async fail(
    jobId: string,
    error: Error | string,
    auditReason: string,
    lastApplyStatus: SignalBarApplyStatus | null = null
  ): Promise<OutcomeMonitorJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const retryCount = job.retryCount + 1;
    const dead = retryCount >= job.maxRetries;
    job.retryCount = retryCount;
    job.state = dead ? "DEAD_LETTER" : "FAILED";
    job.errorMessage = error instanceof Error ? error.message : error;
    job.auditReason = dead ? `DEAD_LETTER:${auditReason}` : auditReason;
    job.leaseOwnerId = null;
    job.leaseUntil = null;
    job.lastApplyStatus = lastApplyStatus;
    job.nextAttemptAt = new Date(Date.now() + backoffMs(retryCount)).toISOString();
    job.updatedAt = nowIso();
    this.jobs.set(jobId, job);
    logger.warn("Outcome monitor job failed", {
      jobId,
      signalId: job.signalId,
      retryCount,
      state: job.state,
      auditReason: job.auditReason,
      lastApplyStatus,
      nextAttemptAt: job.nextAttemptAt
    });
    return structuredClone(job);
  }

  async listDue(limit = 50): Promise<OutcomeMonitorJob[]> {
    const now = Date.now();
    return [...this.jobs.values()]
      .filter(
        (j) =>
          (j.state === "QUEUED" || j.state === "FAILED") && Date.parse(j.nextAttemptAt) <= now
      )
      .sort((a, b) => Date.parse(a.barTime) - Date.parse(b.barTime))
      .slice(0, limit)
      .map((j) => structuredClone(j));
  }

  async listEarlierIncomplete(
    signalId: string,
    barTime: string,
    excludeJobId?: string
  ): Promise<OutcomeMonitorJob[]> {
    const barMs = Date.parse(barTime);
    return [...this.jobs.values()]
      .filter(
        (j) =>
          j.signalId === signalId &&
          j.jobId !== excludeJobId &&
          INCOMPLETE_STATES.has(j.state) &&
          Date.parse(j.barTime) < barMs
      )
      .sort((a, b) => Date.parse(a.barTime) - Date.parse(b.barTime))
      .map((j) => structuredClone(j));
  }

  /** Test helper — advance a FAILED job to due without inventing a new create event. */
  forceNextAttemptAt(jobId: string, iso: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.nextAttemptAt = iso;
    job.updatedAt = nowIso();
    this.jobs.set(jobId, job);
  }
}

export class FirestoreOutcomeMonitorJobStore implements OutcomeMonitorJobStore {
  constructor(private readonly db: Firestore) {}

  private ref(jobId: string) {
    return this.db.collection("outcomeMonitorJobs").doc(jobId);
  }

  async enqueue(input: EnqueueOutcomeMonitorInput): Promise<OutcomeMonitorJob> {
    const jobId = outcomeMonitorJobId({
      userId: input.userId,
      signalId: input.signalId,
      symbol: input.bar.symbol,
      timeframe: input.bar.timeframe,
      barTime: input.bar.barTime,
      eventId: input.eventId
    });
    const ref = this.ref(jobId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = snap.data() as OutcomeMonitorJob;
        if (
          existing.state === "QUEUED" ||
          existing.state === "PROCESSING" ||
          existing.state === "COMPLETED"
        ) {
          return existing;
        }
        if (existing.state === "FAILED") {
          const restarted = buildJob(input, existing);
          tx.set(ref, restarted);
          return restarted;
        }
        return existing;
      }
      const job = buildJob(input, null);
      tx.create(ref, job);
      return job;
    });
  }

  async get(jobId: string): Promise<OutcomeMonitorJob | null> {
    const snap = await this.ref(jobId).get();
    return snap.exists ? (snap.data() as OutcomeMonitorJob) : null;
  }

  async claim(
    jobId: string,
    ownerId: string,
    leaseMs: number
  ): Promise<OutcomeMonitorJob | null> {
    const ref = this.ref(jobId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const job = snap.data() as OutcomeMonitorJob;
      const now = Date.now();
      if (job.state === "COMPLETED" || job.state === "DEAD_LETTER") return null;
      if (job.state === "PROCESSING") {
        const until = job.leaseUntil ? Date.parse(job.leaseUntil) : 0;
        if (until > now && job.leaseOwnerId !== ownerId) return null;
      }
      if (
        (job.state === "FAILED" || job.state === "QUEUED") &&
        Date.parse(job.nextAttemptAt) > now
      ) {
        return null;
      }
      const updated: OutcomeMonitorJob = {
        ...job,
        state: "PROCESSING",
        leaseOwnerId: ownerId,
        leaseUntil: new Date(now + leaseMs).toISOString(),
        updatedAt: nowIso()
      };
      tx.set(ref, updated);
      return updated;
    });
  }

  async complete(
    jobId: string,
    lastApplyStatus: SignalBarApplyStatus | null = "APPLIED"
  ): Promise<OutcomeMonitorJob | null> {
    const ref = this.ref(jobId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const job = snap.data() as OutcomeMonitorJob;
      const updated: OutcomeMonitorJob = {
        ...job,
        state: "COMPLETED",
        leaseOwnerId: null,
        leaseUntil: null,
        completedAt: nowIso(),
        updatedAt: nowIso(),
        auditReason: "MONITOR_COMPLETED",
        lastApplyStatus
      };
      tx.set(ref, updated);
      return updated;
    });
  }

  async fail(
    jobId: string,
    error: Error | string,
    auditReason: string,
    lastApplyStatus: SignalBarApplyStatus | null = null
  ): Promise<OutcomeMonitorJob | null> {
    const ref = this.ref(jobId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const job = snap.data() as OutcomeMonitorJob;
      const retryCount = job.retryCount + 1;
      const dead = retryCount >= job.maxRetries;
      const updated: OutcomeMonitorJob = {
        ...job,
        retryCount,
        state: dead ? "DEAD_LETTER" : "FAILED",
        errorMessage: error instanceof Error ? error.message : error,
        auditReason: dead ? `DEAD_LETTER:${auditReason}` : auditReason,
        leaseOwnerId: null,
        leaseUntil: null,
        lastApplyStatus,
        nextAttemptAt: new Date(Date.now() + backoffMs(retryCount)).toISOString(),
        updatedAt: nowIso()
      };
      tx.set(ref, updated);
      return updated;
    });
  }

  async listDue(limit = 50): Promise<OutcomeMonitorJob[]> {
    const now = nowIso();
    const snap = await this.db
      .collection("outcomeMonitorJobs")
      .where("state", "in", ["QUEUED", "FAILED"])
      .where("nextAttemptAt", "<=", now)
      .limit(limit)
      .get();
    return snap.docs
      .map((d) => d.data() as OutcomeMonitorJob)
      .sort((a, b) => Date.parse(a.barTime) - Date.parse(b.barTime));
  }

  async listEarlierIncomplete(
    signalId: string,
    barTime: string,
    excludeJobId?: string
  ): Promise<OutcomeMonitorJob[]> {
    const barMs = Date.parse(barTime);
    const filterDocs = (docs: QueryDocumentSnapshot[]): OutcomeMonitorJob[] =>
      docs
        .map((d) => d.data() as OutcomeMonitorJob)
        .filter(
          (j) =>
            j.jobId !== excludeJobId &&
            INCOMPLETE_STATES.has(j.state) &&
            Date.parse(j.barTime) < barMs
        )
        .sort((a, b) => Date.parse(a.barTime) - Date.parse(b.barTime));

    try {
      const snap = await this.db
        .collection("outcomeMonitorJobs")
        .where("signalId", "==", signalId)
        .where("barTime", "<", barTime)
        .where("state", "in", ["QUEUED", "PROCESSING", "FAILED"])
        .get();
      return filterDocs(snap.docs);
    } catch {
      // Emulator / missing composite index — fall back to signalId equality filter in memory.
      const snap = await this.db
        .collection("outcomeMonitorJobs")
        .where("signalId", "==", signalId)
        .get();
      return filterDocs(snap.docs);
    }
  }
}

let jobStoreSingleton: OutcomeMonitorJobStore | null = null;

export function getOutcomeMonitorJobStore(): OutcomeMonitorJobStore {
  if (jobStoreSingleton) return jobStoreSingleton;
  const db = getFirestoreDb();
  if (db != null) {
    jobStoreSingleton = new FirestoreOutcomeMonitorJobStore(db);
    return jobStoreSingleton;
  }
  if (allowInMemorySignalOutcomeStore()) {
    jobStoreSingleton = new InMemoryOutcomeMonitorJobStore();
    return jobStoreSingleton;
  }
  logger.error("Outcome monitor job storage unavailable — fail closed", {
    code: "SIGNAL_OUTCOME_STORAGE_UNAVAILABLE"
  });
  throw new SignalOutcomeStorageUnavailableError(
    "Outcome monitor job store unavailable — refusing in-memory outside test/local"
  );
}

export function setOutcomeMonitorJobStoreForTests(store: OutcomeMonitorJobStore): void {
  jobStoreSingleton = store;
}

export { randomUUID };
