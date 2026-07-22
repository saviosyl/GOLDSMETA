import express, { type ErrorRequestHandler } from "express";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
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
import { AiExplainer } from "./services/ai/explainer";
import { processJob } from "./services/jobs/processJob";
import { createStore } from "./services/storage/createStore";
import type { GoldMetaStore } from "./services/storage/types";
import { InMemoryTradingStore } from "./services/trading/inMemoryTradingStore";
import { TradingModeService } from "./services/trading/tradingModeService";
import { AutoTradeService } from "./services/autoTrade/autoTradeService";
import { InMemoryAutoTradeStore } from "./services/autoTrade/autoTradeStore";
import { FakeIgBrokerAdapter } from "./services/autoTrade/fakeIgBrokerAdapter";

export interface AppDependencies {
  store: GoldMetaStore;
  aiExplainer: AiExplainer;
  tradingService?: TradingModeService;
  autoTradeService?: AutoTradeService;
}

const defaultStore = createStore();
const defaultTradingService = new TradingModeService(new InMemoryTradingStore());
const defaultAutoTradeService = new AutoTradeService(
  new InMemoryAutoTradeStore(),
  (environment) => new FakeIgBrokerAdapter({ environment })
);

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

export const createApp = (
  dependencies: AppDependencies = {
    store: defaultStore,
    aiExplainer: new AiExplainer(),
    tradingService: defaultTradingService,
    autoTradeService: defaultAutoTradeService
  }
): express.Express => {
  const app = express();
  app.disable("x-powered-by");
  // Cloud Functions / load balancers terminate TLS; needed for correct webhook HTTPS URLs.
  app.set("trust proxy", 1);
  app.use(buildCorsMiddleware());
  // TradingView sends application/json when the alert message is valid JSON, otherwise
  // text/plain. Accept both so webhook delivery is not dropped before validation.
  app.use(express.json({ limit: env.PAYLOAD_SIZE_LIMIT, type: ["application/json", "text/plain"] }));

  const tradingService = dependencies.tradingService ?? defaultTradingService;
  const autoTradeService = dependencies.autoTradeService ?? defaultAutoTradeService;

  app.use(buildHealthRouter());
  app.use(buildWebhooksRouter(dependencies.store, dependencies.aiExplainer));
  app.use(buildTradingViewRouter(dependencies.store, dependencies.aiExplainer));
  app.use(buildDevicesRouter(dependencies.store));
  app.use(buildPushRouter(dependencies.store));
  app.use(buildDecisionsRouter(dependencies.store));
  app.use(buildSetupsRouter(dependencies.store));
  app.use(buildV4Router(dependencies.store));
  app.use(buildV5Router(dependencies.store));
  app.use(buildJournalRouter(dependencies.store));
  app.use(buildSettingsRouter(dependencies.store));
  app.use(buildTradingRouter(tradingService));
  app.use(buildAutoTradeRouter(autoTradeService));
  app.use(buildSystemRouter());
  app.use(errorHandler);

  return app;
};

export const app = createApp();
export const api = onRequest(
  {
    region: env.FIREBASE_REGION,
    // Mirror Express CORS allowlist for Cloud Functions OPTIONS handling.
    cors: [
      "https://goldmeta.metamechsolutions.com",
      "https://goldmeta-web.pages.dev",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ]
  },
  app
);
export const processProcessingJob = onDocumentCreated(
  { document: "processingJobs/{jobId}", region: env.FIREBASE_REGION },
  async (event) => {
    await processJob(event.params.jobId);
  }
);

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`GoldMeta backend listening on ${env.PORT}`);
  });
}
