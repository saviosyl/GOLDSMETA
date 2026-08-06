import { Router } from "express";
import { createRateLimit } from "../middleware/rateLimit";
import { AiExplainer } from "../services/ai/explainer";
import { logger } from "../services/logging/logger";
import type { GoldMetaStore } from "../services/storage/types";
import { enqueueWebhookEvent } from "../services/webhook/enqueueWebhookEvent";
import { validateWebhookPayload, WebhookValidationError } from "../services/webhook/validatePayload";
import { saveUserTradingViewConnection } from "../services/tradingview/userTradingViewConnection";
import {
  isSharedFeedSourceUser,
  recordSharedFeedAccepted,
  recordSharedFeedRejected
} from "../services/marketFeed/sharedFeed";

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

        try {
          await recordSharedFeedAccepted({
            store,
            userId: validated.userId,
            webhookId: validated.webhookId,
            payload: validated.payload,
            eventId: validated.stableEventId
          });
        } catch (recordError: unknown) {
          logger.warn("Shared market feed accepted diagnostics write failed", {
            error: recordError instanceof Error ? recordError.message : "unknown"
          });
        }

        // Per-user connection health — never cross-user
        try {
          const nowIso = new Date().toISOString();
          await saveUserTradingViewConnection(validated.userId, {
            lastSignalAt: nowIso,
            ...(result.duplicate ? {} : { lastValidSignalAt: nowIso }),
            connectionStatus: "connected",
            lastRejectReason: null
          });
        } catch {
          /* profile write is best-effort */
        }

        res.status(202).json(result);
      } catch (error: unknown) {
        if (error instanceof WebhookValidationError) {
          // Best-effort reject diagnostics on the owning connection when webhookId resolves
          try {
            const wid = firstParam(req.params.webhookId);
            if (wid) {
              const conn = await store.getWebhookConnectionById(wid);
              if (conn) {
                if (isSharedFeedSourceUser(conn.userId)) {
                  try {
                    await recordSharedFeedRejected({
                      store,
                      userId: conn.userId,
                      webhookId: wid,
                      reason: error.code,
                      payload: req.body
                    });
                  } catch {
                    /* diagnostics write is best-effort */
                  }
                }
                await saveUserTradingViewConnection(conn.userId, {
                  lastRejectedSignalAt: new Date().toISOString(),
                  lastRejectReason: error.code,
                  connectionStatus: "error"
                });
              }
            }
          } catch {
            /* ignore */
          }
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
