/**
 * Shared Express app factory — used by production `api` and preview `apiV6Preview`.
 * Keeps createApp logic off the Cloud Function entry so preview can lazy-init
 * after Firebase secrets are injected (no circular import with index.ts).
 */
import express, { type ErrorRequestHandler } from "express";
import { env } from "./config/env";
import { buildCorsMiddleware } from "./middleware/cors";
import { buildDecisionsRouter } from "./routes/decisions";
import { buildDevicesRouter } from "./routes/devices";
import { buildHealthRouter } from "./routes/health";
import { buildJournalRouter } from "./routes/journal";
import { buildPushRouter } from "./routes/push";
import { buildSettingsRouter } from "./routes/settings";
import { buildSystemRouter } from "./routes/system";
import { buildTradingRouter } from "./routes/trading";
import { buildTradingViewRouter } from "./routes/tradingview";
import { buildWebhooksRouter } from "./routes/webhooks";
import { buildSetupsRouter } from "./routes/setups";
import { buildV4Router } from "./routes/v4";
import { buildV5Router } from "./routes/v5";
import { buildAutoTradeRouter } from "./routes/autoTrade";
import { buildSignalOutcomesRouter } from "./routes/signalOutcomes";
import { AiExplainer } from "./services/ai/explainer";
import { createStore } from "./services/storage/createStore";
import type { GoldMetaStore } from "./services/storage/types";
import { InMemoryTradingStore } from "./services/trading/inMemoryTradingStore";
import { TradingModeService } from "./services/trading/tradingModeService";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import type { AutoTradeService } from "./services/autoTrade/autoTradeService";

export interface AppDependencies {
  store: GoldMetaStore;
  aiExplainer: AiExplainer;
  tradingService?: TradingModeService;
  autoTradeService?: AutoTradeService;
}

const isPayloadTooLarge = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const maybeError = error as { type?: unknown; status?: unknown };
  return maybeError.type === "entity.too.large" || maybeError.status === 413;
};

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (isPayloadTooLarge(error)) {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Payload exceeds configured limit"
      }
    });
    return;
  }

  res.status(400).json({
    error: {
      code: "BAD_REQUEST",
      message: "Request could not be parsed"
    }
  });
};

export const createApiApp = (
  dependencies: Partial<AppDependencies> = {}
): express.Express => {
  const store = dependencies.store ?? createStore();
  const aiExplainer = dependencies.aiExplainer ?? new AiExplainer();
  const tradingService =
    dependencies.tradingService ?? new TradingModeService(new InMemoryTradingStore());
  const autoTradeService = dependencies.autoTradeService ?? createAutoTradeService();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(buildCorsMiddleware());
  app.use(express.json({ limit: env.PAYLOAD_SIZE_LIMIT, type: ["application/json", "text/plain"] }));

  app.use(buildHealthRouter());
  app.use(buildWebhooksRouter(store, aiExplainer));
  app.use(buildTradingViewRouter(store, aiExplainer));
  app.use(buildDevicesRouter(store));
  app.use(buildPushRouter(store));
  app.use(buildDecisionsRouter(store));
  app.use(buildSetupsRouter(store));
  app.use(buildV4Router(store));
  app.use(buildV5Router(store));
  app.use(buildSignalOutcomesRouter());
  app.use(buildJournalRouter(store));
  app.use(buildSettingsRouter(store));
  app.use(buildTradingRouter(tradingService));
  app.use(buildAutoTradeRouter(autoTradeService, store));
  app.use(buildSystemRouter());
  app.use(errorHandler);

  return app;
};
