import { z } from "zod";
import { env } from "../../config/env";
import { tradingViewPayloadSchema, type TradingViewPayload } from "../../models/types";
import { isSentAtAcceptable } from "../../utils/time";
import { logger } from "../logging/logger";
import type { GoldMetaStore, WebhookConnection } from "../storage/types";
import { buildStableEventId } from "./eventId";

export class WebhookValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: string[]
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

const normalizeWebhookBody = (body: unknown): unknown => {
  // express.json(type: text/plain) may yield a raw JSON string instead of an object.
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) {
      return body;
    }
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return body;
    }
  }
  return body;
};

export const validateWebhookPayload = async (
  store: GoldMetaStore,
  webhookId: string,
  body: unknown,
  now = Date.now()
): Promise<ValidatedWebhookPayload> => {
  const normalized = normalizeWebhookBody(body);
  const parsed = tradingViewPayloadSchema.safeParse(normalized);
  if (!parsed.success) {
    const details = zodErrorToMessages(parsed.error).slice(0, 12);
    logger.warn("Webhook payload failed schema validation", {
      webhookId,
      bodyType: typeof body,
      normalizedType: typeof normalized,
      details
    });
    throw new WebhookValidationError("Invalid webhook payload", 400, "INVALID_PAYLOAD", details);
  }

  const payload = parsed.data;
  // Validate sentAt only — barTime is the candle timestamp and may be older than skew.
  const maxPastMs = env.WEBHOOK_MAX_SKEW_MS;
  const maxFutureMs = env.WEBHOOK_MAX_FUTURE_SKEW_MS;
  if (
    !isSentAtAcceptable(
      payload.sentAt,
      {
        maxPastMs,
        maxFutureMs
      },
      now
    )
  ) {
    const sentAtMs = new Date(payload.sentAt).getTime();
    const ageMs = Number.isFinite(sentAtMs) ? now - sentAtMs : null;
    logger.warn("Webhook payload failed timestamp skew check", {
      webhookId,
      sentAt: payload.sentAt,
      ageMs,
      maxPastMs,
      maxFutureMs
    });
    throw new WebhookValidationError("Webhook timestamp outside allowed skew", 400, "STALE_TIMESTAMP");
  }

  const connection = await store.getWebhookConnectionById(webhookId);
  if (!connection) {
    throw new WebhookValidationError("Webhook not found", 404, "WEBHOOK_NOT_FOUND");
  }

  // Path webhookId is the primary credential (unguessable URL). Body webhookSecret is optional
  // defense-in-depth: only enforce when the payload actually provides a non-null secret.
  // Pine default sends webhookSecret:null — requiring a match would 401 every live TV alert.
  if (
    connection.secret &&
    payload.webhookSecret != null &&
    payload.webhookSecret !== connection.secret
  ) {
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
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
