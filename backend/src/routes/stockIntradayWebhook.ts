/**
 * Dedicated TradingView webhook for Stocks Intraday AutoTrade.
 * Does NOT use Firebase user session auth.
 * Authenticates via server-configured webhook secret (hashed at rest).
 */

import { Router } from "express";
import { createRateLimit } from "../middleware/rateLimit";
import { logger } from "../services/logging/logger";
import type { StockIntradayService } from "../services/stockIntraday/stockIntradayService";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

function extractWebhookToken(req: {
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
}): string | undefined {
  const header =
    (req.headers["x-goldmeta-webhook-token"] as string | undefined) ??
    (req.headers["x-webhook-token"] as string | undefined);
  if (header && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const q = req.query.token;
  if (typeof q === "string" && q.trim()) return q.trim();
  return undefined;
}

export const buildStockIntradayWebhookRouter = (service: StockIntradayService): Router => {
  const router = Router();

  router.post(
    "/webhooks/stock-intraday/:connectionId",
    createRateLimit("stock-intraday-webhook"),
    async (req, res) => {
      const connectionId = firstParam(req.params.connectionId) ?? "";
      try {
        const token = extractWebhookToken(req);
        const auth = await service.authenticateWebhook(connectionId, token);
        if (!auth.ok) {
          // Never log the token/secret
          logger.warn("Stock intraday webhook auth rejected", {
            connectionId,
            code: auth.code
          });
          res.status(auth.status).json({
            error: { code: auth.code, message: "Webhook authentication failed" }
          });
          return;
        }

        const ack = await service.acknowledgeStockSignal(auth.userId, req.body);
        if (!ack.accepted) {
          res.status(400).json({
            error: { code: ack.code, message: ack.code }
          });
          return;
        }

        // HTTP 202 — durable job created; processing happens via Firestore trigger.
        res.status(202).json({
          accepted: true,
          code: ack.code,
          signalId: ack.signalId,
          jobId: ack.jobId,
          message: "Signal accepted; durable processing job queued"
        });
      } catch (error: unknown) {
        logger.error("Stock intraday webhook failure", {
          connectionId,
          error: error instanceof Error ? error.message : "unknown"
        });
        res.status(500).json({
          error: {
            code: "STOCK_WEBHOOK_FAILED",
            message: "Webhook could not be processed"
          }
        });
      }
    }
  );

  return router;
};
