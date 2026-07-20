import { randomUUID } from "crypto";
import { AiExplainer } from "../ai/explainer";
import { processDecisionPipeline } from "../decision/decisionPipeline";
import { logger } from "../logging/logger";
import { createStore } from "../storage/createStore";
import type { GoldMetaStore, ProcessingJob } from "../storage/types";

export interface ProcessJobOptions {
  store?: GoldMetaStore;
  aiExplainer?: AiExplainer;
  workerId?: string;
  lockMs?: number;
}

export const processJob = async (
  jobId: string,
  options: ProcessJobOptions = {}
): Promise<ProcessingJob | undefined> => {
  const store = options.store ?? createStore();
  const existing = await store.getProcessingJob(jobId);

  if (!existing) {
    logger.warn("Processing job not found", { jobId });
    return undefined;
  }

  if (existing.state === "COMPLETED") {
    return existing;
  }

  const claimed = await store.claimProcessingJob(
    jobId,
    options.workerId ?? `worker-${randomUUID()}`,
    options.lockMs ?? 5 * 60 * 1000
  );
  if (!claimed) {
    return await store.getProcessingJob(jobId);
  }

  try {
    const rawEvent = await store.getRawEvent(claimed.userId, claimed.eventId);
    if (!rawEvent) {
      throw new Error(`Raw event ${claimed.eventId} not found for user ${claimed.userId}`);
    }

    const decision = await processDecisionPipeline(
      claimed.userId,
      rawEvent.payload,
      claimed.eventId,
      store,
      options.aiExplainer ?? new AiExplainer(),
      {
        environment: claimed.environment,
        isTestDecision: claimed.isTestDecision,
        webhookId: claimed.webhookId
      }
    );

    return await store.completeProcessingJob(jobId, decision.decisionId);
  } catch (error: unknown) {
    const failed = await store.failProcessingJob(
      jobId,
      error instanceof Error ? error : "Unknown processing error"
    );
    logger.error("Processing job failed", {
      jobId,
      error: error instanceof Error ? error.message : "unknown"
    });
    return failed;
  }
};
