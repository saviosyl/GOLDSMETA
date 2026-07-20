import { z } from "zod";
import { env } from "../../config/env";
import { tradingViewPayloadSchema, type TradingViewPayload } from "../../models/types";
import { isWithinSkew } from "../../utils/time";
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
}

export const validateWebhookPayload = (
  webhookId: string,
  body: unknown,
  now = Date.now()
): ValidatedWebhookPayload => {
  if (webhookId !== env.WEBHOOK_ID) {
    throw new WebhookValidationError("Webhook not found", 404, "WEBHOOK_NOT_FOUND");
  }

  const parsed = tradingViewPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new WebhookValidationError("Invalid webhook payload", 400, "INVALID_PAYLOAD");
  }

  const payload = parsed.data;
  if (env.WEBHOOK_SECRET && payload.webhookSecret !== env.WEBHOOK_SECRET) {
    throw new WebhookValidationError("Invalid webhook credentials", 401, "INVALID_SECRET");
  }

  if (!isWithinSkew(payload.sentAt, env.WEBHOOK_MAX_SKEW_MS, now)) {
    throw new WebhookValidationError("Webhook timestamp outside allowed skew", 400, "STALE_TIMESTAMP");
  }

  return {
    payload,
    stableEventId: buildStableEventId(payload)
  };
};

export const zodErrorToMessages = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
