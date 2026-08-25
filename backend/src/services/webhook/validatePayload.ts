import { z } from "zod";
import { env } from "../../config/env";
import { tradingViewPayloadSchema, type TradingViewPayload } from "../../models/types";
import { isSentAtAcceptable } from "../../utils/time";
import { logger } from "../logging/logger";
import type { GoldMetaStore, WebhookConnection } from "../storage/types";
import { buildStableEventId } from "./eventId";
import {
  applyCustomFieldMappings,
  getUserTradingViewConnection,
  verifyWebhookToken
} from "../tradingview/userTradingViewConnection";
import { getActiveStandardTemplate, normalizeSymbolAlias } from "../tradingview/standardTemplate";

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
  const connection = await store.getWebhookConnectionById(webhookId);
  if (!connection) {
    throw new WebhookValidationError("Webhook not found", 404, "WEBHOOK_NOT_FOUND");
  }

  // Resolve owning user first — payloads cannot forge another UID.
  const userId = connection.userId;
  let profile = null as Awaited<ReturnType<typeof getUserTradingViewConnection>> | null;
  try {
    profile = await getUserTradingViewConnection(userId);
  } catch {
    profile = null;
  }

  let normalized = normalizeWebhookBody(body);
  // Custom mappings rewrite field names into the standard schema before Zod parse.
  if (
    profile?.templateMode === "custom" &&
    profile.customFieldMappings.length > 0 &&
    normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
  ) {
    normalized = applyCustomFieldMappings(
      normalized as Record<string, unknown>,
      profile.customFieldMappings
    );
  }

  // Normalise symbol aliases (OANDA:XAUUSD → XAUUSD) before schema enum check.
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    const obj = { ...(normalized as Record<string, unknown>) };
    if (typeof obj.symbol === "string") {
      const canon = normalizeSymbolAlias(obj.symbol);
      if (!canon) {
        throw new WebhookValidationError("Unsupported symbol", 400, "UNSUPPORTED_SYMBOL");
      }
      obj.symbol = canon;
    }
    if (typeof obj.timeframe === "string") {
      const allowed = new Set(
        getActiveStandardTemplate().supportedTimeframes.map((t) => t.value)
      );
      if (!allowed.has(obj.timeframe)) {
        throw new WebhookValidationError("Unsupported timeframe", 400, "UNSUPPORTED_TIMEFRAME");
      }
    }
    // Payload size guard
    const bytes = Buffer.byteLength(JSON.stringify(obj), "utf8");
    if (bytes > getActiveStandardTemplate().validationRules.maxPayloadBytes) {
      throw new WebhookValidationError("Payload too large", 400, "PAYLOAD_TOO_LARGE");
    }
    normalized = obj;
  }

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
  const maxPastMs = Math.min(
    env.WEBHOOK_MAX_SKEW_MS,
    (profile?.staleSignalLimitSeconds ??
      getActiveStandardTemplate().validationRules.staleSignalLimitSeconds) * 1000
  );
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

  // Path webhookId is the primary credential. Body secret is optional defense-in-depth.
  if (payload.webhookSecret != null) {
    const okHash = verifyWebhookToken(payload.webhookSecret, connection.secretHash);
    const okLegacy =
      Boolean(connection.secret) && payload.webhookSecret === connection.secret;
    if (!okHash && !okLegacy) {
      throw new WebhookValidationError("Invalid webhook credentials", 401, "INVALID_SECRET");
    }
  }

  return {
    payload,
    stableEventId: buildStableEventId(payload),
    userId,
    webhookId: connection.webhookId,
    connection
  };
};

export const zodErrorToMessages = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
