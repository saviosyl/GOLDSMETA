import { Router } from "express";
import { createRateLimit } from "../middleware/rateLimit";
import { AiExplainer } from "../services/ai/explainer";
import { logger } from "../services/logging/logger";
import type { GoldMetaStore } from "../services/storage/types";
import { enqueueWebhookEvent } from "../services/webhook/enqueueWebhookEvent";
import { validateWebhookPayload, WebhookValidationError } from "../services/webhook/validatePayload";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildWebhooksRouter = (
  store: GoldMetaStore,
  aiExplainer = new AiExplainer()
): Router => {
  const router = Router();

  router.post(
    "/webhooks/tradingview/:webhookId",
    createRateLimit("tradingview-webhook"),
    async (req, res) => {
      try {
        const webhookId = firstParam(req.params.webhookId) ?? "";
        const validated = await validateWebhookPayload(store, webhookId, req.body);
        const isTestDecision = validated.payload.eventType === "TEST";
        const result = await enqueueWebhookEvent({
          store,
          userId: validated.userId,
          webhookId: validated.webhookId,
          payload: validated.payload,
          stableEventId: validated.stableEventId,
          environment: isTestDecision ? "TEST" : "LIVE",
          isTestDecision,
          aiExplainer
        });

        res.status(202).json(result);
      } catch (error: unknown) {
        if (error instanceof WebhookValidationError) {
          res.status(error.statusCode).json({
            error: {
              code: error.code,
              message: error.message,
              ...(error.details && error.details.length > 0 ? { details: error.details } : {})
            }
          });
          return;
        }

        logger.error("Unhandled webhook processing error", {
          error: error instanceof Error ? error.message : "unknown"
        });
        res.status(500).json({
          error: {
            code: "WEBHOOK_PROCESSING_FAILED",
            message: "Webhook could not be processed"
          }
        });
      }
    }
  );

  return router;
};
