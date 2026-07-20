import { env } from "../../config/env";
import { nowIso } from "../../utils/time";
import { AiExplainer } from "../ai/explainer";
import { processJob } from "../jobs/processJob";
import type { DecisionEnvironment, GoldMetaStore } from "../storage/types";

export interface EnqueueWebhookEventInput {
  store: GoldMetaStore;
  userId: string;
  webhookId?: string;
  payload: Parameters<GoldMetaStore["saveRawEvent"]>[1];
  stableEventId: string;
  environment?: DecisionEnvironment;
  isTestDecision?: boolean;
  aiExplainer?: AiExplainer;
}

export interface EnqueueWebhookEventResult {
  accepted: true;
  duplicate: boolean;
  eventId: string;
  status: "QUEUED";
  jobId: string | null;
}

export const shouldProcessInline = (): boolean =>
  env.APP_ENV === "test" && env.STORAGE_BACKEND === "memory";

export const enqueueWebhookEvent = async ({
  store,
  userId,
  webhookId,
  payload,
  stableEventId,
  environment = "LIVE",
  isTestDecision = false,
  aiExplainer
}: EnqueueWebhookEventInput): Promise<EnqueueWebhookEventResult> => {
  const isNewEvent = await store.checkAndStoreEventDedupe(userId, stableEventId);
  if (!isNewEvent) {
    return {
      accepted: true,
      duplicate: true,
      eventId: stableEventId,
      status: "QUEUED",
      jobId: null
    };
  }

  await store.saveRawEvent(userId, payload, stableEventId, {
    webhookId,
    environment,
    isTestEvent: isTestDecision
  });

  if (webhookId) {
    await store.updateWebhookLastAlert(webhookId, nowIso());
  }

  const job = await store.createProcessingJob({
    userId,
    eventId: stableEventId,
    webhookId,
    environment,
    isTestDecision
  });

  if (shouldProcessInline()) {
    await processJob(job.jobId, { store, aiExplainer });
  }

  return {
    accepted: true,
    duplicate: false,
    eventId: stableEventId,
    status: "QUEUED",
    jobId: job.jobId
  };
};
