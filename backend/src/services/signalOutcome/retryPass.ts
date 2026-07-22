/**
 * Automatic retry pass for durable outcome-monitor jobs.
 * onDocumentCreated only fires once; FAILED jobs with nextAttemptAt must be
 * picked up by this scheduled/guarded pass — never an immediate retry loop.
 */

import { randomUUID } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { nowIso } from "../../utils/time";
import { logger } from "../logging/logger";
import { getFirestoreDb } from "../firebaseAdmin";
import { processOutcomeMonitorJob } from "./monitor";
import {
  getOutcomeMonitorJobStore,
  type OutcomeMonitorJobStore
} from "./monitorJobs";
import type { SignalOutcomeStore } from "./store";
import { getSignalOutcomeStore } from "./monitor";

export interface SchedulerHeartbeat {
  lastRunAt: string;
  lastSuccessAt: string | null;
  claimed: number;
  completed: number;
  failed: number;
  skippedNotDue: number;
  workerId: string;
}

export async function persistSchedulerHeartbeat(
  heartbeat: SchedulerHeartbeat,
  db: Firestore | null = getFirestoreDb()
): Promise<void> {
  if (!db) {
    logger.info("Outcome monitor scheduler heartbeat (no firestore)", {
      lastRunAt: heartbeat.lastRunAt,
      claimed: heartbeat.claimed,
      completed: heartbeat.completed,
      failed: heartbeat.failed
    });
    return;
  }
  await db.collection("system").doc("outcomeMonitorScheduler").set(
    {
      ...heartbeat,
      updatedAt: nowIso()
    },
    { merge: true }
  );
}

/**
 * Query due QUEUED/FAILED jobs, claim transactionally, process once each.
 * Jobs with nextAttemptAt in the future are not claimed (no immediate loop).
 */
export async function runOutcomeMonitorRetryPass(options: {
  jobStore?: OutcomeMonitorJobStore;
  store?: SignalOutcomeStore;
  limit?: number;
  workerId?: string;
  db?: Firestore | null;
  now?: Date;
} = {}): Promise<SchedulerHeartbeat> {
  const jobStore = options.jobStore ?? getOutcomeMonitorJobStore();
  const store = options.store ?? getSignalOutcomeStore();
  const workerId = options.workerId ?? `retry-${randomUUID().slice(0, 8)}`;
  const limit = options.limit ?? 25;
  const started = nowIso();

  const due = await jobStore.listDue(limit);
  let claimed = 0;
  let completed = 0;
  let failed = 0;

  for (const job of due) {
    // Double-check due window (listDue should already filter).
    if (Date.parse(job.nextAttemptAt) > (options.now ?? new Date()).getTime()) {
      continue;
    }
    try {
      // processOutcomeMonitorJob claims transactionally — skips if not claimable.
      const before = await jobStore.get(job.jobId);
      if (!before || before.state === "COMPLETED" || before.state === "DEAD_LETTER") continue;
      if (before.state === "PROCESSING") {
        const until = before.leaseUntil ? Date.parse(before.leaseUntil) : 0;
        if (until > Date.now()) continue;
      }

      await processOutcomeMonitorJob(job.jobId, {
        jobStore,
        store,
        workerId: `${workerId}-${job.jobId.slice(0, 6)}`
      });
      claimed += 1;
      const after = await jobStore.get(job.jobId);
      if (after?.state === "COMPLETED") completed += 1;
      else if (after?.state === "FAILED" || after?.state === "DEAD_LETTER") failed += 1;
    } catch {
      claimed += 1;
      failed += 1;
      // processOutcomeMonitorJob already persisted fail/backoff.
    }
  }

  const heartbeat: SchedulerHeartbeat = {
    lastRunAt: started,
    lastSuccessAt: failed === 0 ? nowIso() : null,
    claimed,
    completed,
    failed,
    skippedNotDue: 0,
    workerId
  };
  await persistSchedulerHeartbeat(heartbeat, options.db === undefined ? getFirestoreDb() : options.db);
  logger.info("Outcome monitor retry pass finished", {
    claimed: heartbeat.claimed,
    completed: heartbeat.completed,
    failed: heartbeat.failed,
    workerId
  });
  return heartbeat;
}
