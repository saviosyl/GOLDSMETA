/**
 * Dedicated TradingView webhook for Stocks Intraday AutoTrade.
 * Does NOT use Firebase user session auth.
 *
 * TradingView official docs: webhooks are HTTP POST to a URL with the alert
 * message as the body. Custom headers are not supported. Passwords / login
 * credentials must not be placed in the alert body.
 *
 * Auth = unguessable opaque connectionId in the URL path (capability URL),
 * mapped server-side to the GoldMeta owner. Query-string tokens are rejected.
 */

import { Router } from "express";
import { createRateLimit } from "../middleware/rateLimit";
import { logger } from "../services/logging/logger";
import type { StockIntradayService } from "../services/stockIntraday/stockIntradayService";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildStockIntradayWebhookRouter = (service: StockIntradayService): Router => {
  const router = Router();

  router.post(
    "/webhooks/stock-intraday/:connectionId",
    createRateLimit("stock-intraday-webhook"),
    async (req, res) => {
      const connectionId = firstParam(req.params.connectionId) ?? "";
      try {
        const queryTokenPresent =
          typeof req.query.token === "string" ||
          typeof req.query.secret === "string" ||
          typeof req.query.webhookToken === "string";

        const auth = await service.authenticateWebhook(connectionId, {
          queryTokenPresent
        });
        if (!auth.ok) {
          logger.warn("Stock intraday webhook auth rejected", {
            connectionId: connectionId.slice(0, 8),
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

        res.status(202).json({
          accepted: true,
          code: ack.code,
          signalId: ack.signalId,
          jobId: ack.jobId,
          message: "Signal accepted; durable processing job queued"
        });
      } catch (error: unknown) {
        logger.error("Stock intraday webhook failure", {
          connectionId: connectionId.slice(0, 8),
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
