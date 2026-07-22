/* eslint-disable @typescript-eslint/require-await -- sync in-memory impl of async port */
/**
 * Durable outcome-monitor jobs — independent of decision processingJobs.
 * Failed monitoring retries with exponential backoff; never permanently lost
 * when the decision job completes.
 */

import { createHash, randomUUID } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { nowIso } from "../../utils/time";
import { logger } from "../logging/logger";
import { getFirestoreDb } from "../firebaseAdmin";
import type { OutcomeMonitorJob, SignalBarInput } from "./types";

export function outcomeMonitorJobId(userId: string, eventId: string): string {
  return createHash("sha256")
    .update(`outcome-monitor|${userId}|${eventId}`)
    .digest("hex")
    .slice(0, 40);
}

export function backoffMs(retryCount: number): number {
  // 5s, 20s, 80s, 320s, … capped at 1h
  return Math.min(3_600_000, 5_000 * Math.pow(4, Math.max(0, retryCount)));
}

export interface OutcomeMonitorJobStore {
  enqueue(input: {
    userId: string;
    eventId: string;
    bar: SignalBarInput;
    maxRetries?: number;
  }): Promise<OutcomeMonitorJob>;
  get(jobId: string): Promise<OutcomeMonitorJob | null>;
  claim(
    jobId: string,
    ownerId: string,
    leaseMs: number
  ): Promise<OutcomeMonitorJob | null>;
  complete(jobId: string): Promise<OutcomeMonitorJob | null>;
  fail(
    jobId: string,
    error: Error | string,
    auditReason: string
  ): Promise<OutcomeMonitorJob | null>;
  listDue(limit?: number): Promise<OutcomeMonitorJob[]>;
}

export class InMemoryOutcomeMonitorJobStore implements OutcomeMonitorJobStore {
  private readonly jobs = new Map<string, OutcomeMonitorJob>();

  async enqueue(input: {
    userId: string;
    eventId: string;
    bar: SignalBarInput;
    maxRetries?: number;
  }): Promise<OutcomeMonitorJob> {
    const jobId = outcomeMonitorJobId(input.userId, input.eventId);
    const existing = this.jobs.get(jobId);
    if (existing && (existing.state === "QUEUED" || existing.state === "PROCESSING" || existing.state === "COMPLETED")) {
      return structuredClone(existing);
    }
    const now = nowIso();
    const job: OutcomeMonitorJob = {
      jobId,
      userId: input.userId,
      eventId: input.eventId,
      bar: structuredClone(input.bar),
      state: "QUEUED",
      retryCount: existing?.retryCount ?? 0,
      maxRetries: input.maxRetries ?? 8,
      nextAttemptAt: now,
      leaseOwnerId: null,
      leaseUntil: null,
      auditReason: null,
      errorMessage: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: null
    };
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

  async complete(jobId: string): Promise<OutcomeMonitorJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.state = "COMPLETED";
    job.leaseOwnerId = null;
    job.leaseUntil = null;
    job.completedAt = nowIso();
    job.updatedAt = job.completedAt;
    job.auditReason = "MONITOR_COMPLETED";
    this.jobs.set(jobId, job);
    return structuredClone(job);
  }

  async fail(
    jobId: string,
    error: Error | string,
    auditReason: string
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
    job.nextAttemptAt = new Date(Date.now() + backoffMs(retryCount)).toISOString();
    job.updatedAt = nowIso();
    this.jobs.set(jobId, job);
    logger.warn("Outcome monitor job failed", {
      jobId,
      retryCount,
      state: job.state,
      auditReason: job.auditReason,
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
      .slice(0, limit)
      .map((j) => structuredClone(j));
  }
}

export class FirestoreOutcomeMonitorJobStore implements OutcomeMonitorJobStore {
  constructor(private readonly db: Firestore) {}

  private ref(jobId: string) {
    return this.db.collection("outcomeMonitorJobs").doc(jobId);
  }

  async enqueue(input: {
    userId: string;
    eventId: string;
    bar: SignalBarInput;
    maxRetries?: number;
  }): Promise<OutcomeMonitorJob> {
    const jobId = outcomeMonitorJobId(input.userId, input.eventId);
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
        // Re-queue FAILED/DEAD for same event only if still FAILED (idempotent re-enqueue from decision).
        if (existing.state === "FAILED") {
          const restarted: OutcomeMonitorJob = {
            ...existing,
            bar: input.bar,
            state: "QUEUED",
            nextAttemptAt: nowIso(),
            updatedAt: nowIso(),
            auditReason: "REQUEUED_FROM_DECISION"
          };
          tx.set(ref, restarted);
          return restarted;
        }
        return existing;
      }
      const now = nowIso();
      const job: OutcomeMonitorJob = {
        jobId,
        userId: input.userId,
        eventId: input.eventId,
        bar: input.bar,
        state: "QUEUED",
        retryCount: 0,
        maxRetries: input.maxRetries ?? 8,
        nextAttemptAt: now,
        leaseOwnerId: null,
        leaseUntil: null,
        auditReason: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      };
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

  async complete(jobId: string): Promise<OutcomeMonitorJob | null> {
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
        auditReason: "MONITOR_COMPLETED"
      };
      tx.set(ref, updated);
      return updated;
    });
  }

  async fail(
    jobId: string,
    error: Error | string,
    auditReason: string
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
    return snap.docs.map((d) => d.data() as OutcomeMonitorJob);
  }
}

let jobStoreSingleton: OutcomeMonitorJobStore | null = null;

export function getOutcomeMonitorJobStore(): OutcomeMonitorJobStore {
  if (jobStoreSingleton) return jobStoreSingleton;
  const db = getFirestoreDb();
  jobStoreSingleton =
    db != null ? new FirestoreOutcomeMonitorJobStore(db) : new InMemoryOutcomeMonitorJobStore();
  return jobStoreSingleton;
}

export function setOutcomeMonitorJobStoreForTests(store: OutcomeMonitorJobStore): void {
  jobStoreSingleton = store;
}

export { randomUUID };
