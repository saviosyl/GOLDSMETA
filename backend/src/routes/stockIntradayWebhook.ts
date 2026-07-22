/**
 * Dedicated TradingView webhook for Stocks Intraday AutoTrade.
 * Does NOT use Firebase user session auth.
 *
 * TradingView official docs: webhooks are HTTP POST to a URL with the alert
 * message as the body. Custom headers are not supported. Passwords / login
 * credentials must not be placed in the alert body or treated as reusable
 * secrets in the URL path.
 *
 * connectionId is a non-secret routing identifier only. Requests are verified
 * through a trusted edge using TradingView's documented client certificate
 * and/or official source-IP allowlist. Client-supplied X-Forwarded-For is never
 * trusted. When reliable verification is unavailable (typical on bare Firebase
 * Functions), signals may be stored and analysed but must not independently
 * authorize automatic entry.
 */

import { Router } from "express";
import { createRateLimit } from "../middleware/rateLimit";
import { logger } from "../services/logging/logger";
import type { StockIntradayService } from "../services/stockIntraday/stockIntradayService";
import { hashRoutingId } from "../services/stockIntraday/stockIntradayStore";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildStockIntradayWebhookRouter = (service: StockIntradayService): Router => {
  const router = Router();

  router.post(
    "/webhooks/stock-intraday/:connectionId",
    createRateLimit("stock-intraday-webhook"),
    async (req, res) => {
      const connectionId = firstParam(req.params.connectionId) ?? "";
      const routingIdHashPrefix = connectionId
        ? hashRoutingId(connectionId).slice(0, 12)
        : "unknown";
      try {
        const queryTokenPresent =
          typeof req.query.token === "string" ||
          typeof req.query.secret === "string" ||
          typeof req.query.webhookToken === "string";

        // Never pass client-controlled X-Forwarded-For as trustedSourceIp.
        const auth = await service.authenticateWebhook(connectionId, {
          queryTokenPresent,
          forwardedFor: null,
          socketRemoteAddress: req.socket?.remoteAddress ?? null,
          trustedClientCertCn:
            typeof req.headers["x-goldmeta-tv-client-cert-cn"] === "string" &&
            process.env.APP_ENV === "test"
              ? req.headers["x-goldmeta-tv-client-cert-cn"]
              : null,
          trustedSourceIp:
            typeof req.headers["x-goldmeta-tv-trusted-ip"] === "string" &&
            process.env.APP_ENV === "test"
              ? req.headers["x-goldmeta-tv-trusted-ip"]
              : null
        });
        if (!auth.ok) {
          logger.warn("Stock intraday webhook auth rejected", {
            routingIdHashPrefix,
            code: auth.code
          });
          res.status(auth.status).json({
            error: { code: auth.code, message: "Webhook authentication failed" }
          });
          return;
        }

        const ack = await service.acknowledgeStockSignal(auth.userId, req.body, {
          authorizesAutomaticEntry: auth.authorizesAutomaticEntry,
          sourceVerified: auth.sourceVerified
        });
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
          sourceVerified: auth.sourceVerified,
          authorizesAutomaticEntry: auth.authorizesAutomaticEntry,
          message: auth.authorizesAutomaticEntry
            ? "Signal accepted; durable processing job queued"
            : "Signal stored for analysis; automatic entry not authorized without verified TradingView source + internal scan"
        });
      } catch (error: unknown) {
        logger.error("Stock intraday webhook failure", {
          routingIdHashPrefix,
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
