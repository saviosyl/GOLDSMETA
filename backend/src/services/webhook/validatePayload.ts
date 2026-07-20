import { z } from "zod";
import { env } from "../../config/env";
import { tradingViewPayloadSchema, type TradingViewPayload } from "../../models/types";
import { isWithinSkew } from "../../utils/time";
import type { GoldMetaStore, WebhookConnection } from "../storage/types";
import { buildStableEventId } from "./eventId";

export class WebhookValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
  }
}

export interface ValidatedWebhookPayload {
  payload: TradingViewPayload;
  stableEventId: string;
  userId: string;
  webhookId: string;
  connection: WebhookConnection;
}

export const validateWebhookPayload = async (
  store: GoldMetaStore,
  webhookId: string,
  body: unknown,
  now = Date.now()
): Promise<ValidatedWebhookPayload> => {
  const parsed = tradingViewPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new WebhookValidationError("Invalid webhook payload", 400, "INVALID_PAYLOAD");
  }

  const payload = parsed.data;
  if (!isWithinSkew(payload.sentAt, env.WEBHOOK_MAX_SKEW_MS, now)) {
    throw new WebhookValidationError("Webhook timestamp outside allowed skew", 400, "STALE_TIMESTAMP");
  }

  const connection = await store.getWebhookConnectionById(webhookId);
  if (!connection) {
    throw new WebhookValidationError("Webhook not found", 404, "WEBHOOK_NOT_FOUND");
  }

  if (connection.secret && payload.webhookSecret !== connection.secret) {
    throw new WebhookValidationError("Invalid webhook credentials", 401, "INVALID_SECRET");
  }

  return {
    payload,
    stableEventId: buildStableEventId(payload),
    userId: connection.userId,
    webhookId: connection.webhookId,
    connection
  };
};

export const zodErrorToMessages = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
