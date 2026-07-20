import { Router } from "express";
import { createRateLimit } from "../middleware/rateLimit";
import { AiExplainer } from "../services/ai/explainer";
import { processDecisionPipeline } from "../services/decision/decisionPipeline";
import { logger } from "../services/logging/logger";
import type { InMemoryStore } from "../services/storage/inMemoryStore";
import { DedupeStore } from "../services/webhook/dedupe";
import { validateWebhookPayload, WebhookValidationError } from "../services/webhook/validatePayload";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildWebhooksRouter = (
  store: InMemoryStore,
  dedupe: DedupeStore,
  aiExplainer = new AiExplainer()
): Router => {
  const router = Router();

  router.post(
    "/webhooks/tradingview/:webhookId",
    createRateLimit("tradingview-webhook"),
    (req, res) => {
      try {
        const webhookId = firstParam(req.params.webhookId) ?? "";
        const validated = validateWebhookPayload(webhookId, req.body);

        if (!dedupe.checkAndStore(validated.stableEventId)) {
          res.status(202).json({
            accepted: true,
            duplicate: true,
            eventId: validated.stableEventId
          });
          return;
        }

        // Acknowledge immediately. Decision + AI run asynchronously so TradingView
        // is never blocked waiting on OpenAI or the full scoring pipeline.
        store.enqueueAcceptedEvent(validated.payload, validated.stableEventId);

        void processDecisionPipeline(
          validated.payload,
          validated.stableEventId,
          store,
          aiExplainer
        ).catch((error: unknown) => {
          logger.error("Background webhook processing failed", {
            eventId: validated.stableEventId,
            error: error instanceof Error ? error.message : "unknown"
          });
        });

        res.status(202).json({
          accepted: true,
          duplicate: false,
          eventId: validated.stableEventId,
          status: "QUEUED"
        });
      } catch (error: unknown) {
        if (error instanceof WebhookValidationError) {
          res.status(error.statusCode).json({
            error: {
              code: error.code,
              message: error.message
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
