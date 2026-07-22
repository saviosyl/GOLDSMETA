/**
 * Production Cloud Functions entry + re-exports.
 * Production `api` is unchanged in behaviour; `apiV6Preview` is additive only.
 * Stocks Intraday jobs/triggers are additive and do not alter IG AutoTrade.
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { env } from "./config/env";
import { createApiApp, type AppDependencies } from "./apiApp";
import { processJob } from "./services/jobs/processJob";
import { createStore } from "./services/storage/createStore";
import { AiExplainer } from "./services/ai/explainer";
import { InMemoryTradingStore } from "./services/trading/inMemoryTradingStore";
import { TradingModeService } from "./services/trading/tradingModeService";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import { processDecisionForAutoTrade } from "./services/autoTrade/decisionTrigger";
import { createStockIntradayService } from "./services/stockIntraday/runtime";
import { processStockIntradayJob } from "./services/stockIntraday/processStockIntradayJob";
import { enqueueEngineTick } from "./services/stockIntraday/intradayEngine";
import { logger } from "./services/logging/logger";

const defaultStore = createStore();
const defaultTradingService = new TradingModeService(new InMemoryTradingStore());
const defaultAutoTradeService = createAutoTradeService();
const defaultStockIntradayService = createStockIntradayService();

export type { AppDependencies };
export { createApiApp };

export const createApp = (
  dependencies: Partial<AppDependencies> = {}
) =>
  createApiApp({
    store: dependencies.store ?? defaultStore,
    aiExplainer: dependencies.aiExplainer ?? new AiExplainer(),
    tradingService: dependencies.tradingService ?? defaultTradingService,
    autoTradeService: dependencies.autoTradeService ?? defaultAutoTradeService,
    stockIntradayService: dependencies.stockIntradayService ?? defaultStockIntradayService
  });

export const app = createApp();
export const api = onRequest(
  {
    region: env.FIREBASE_REGION,
    cors: [
      "https://goldmeta.metamechsolutions.com",
      "https://goldmeta-web.pages.dev",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ]
  },
  app
);

/** Isolated V6 IG Demo read-only preview — deploy with --only functions:apiV6Preview */
export { apiV6Preview } from "./previewApi";

export const processProcessingJob = onDocumentCreated(
  { document: "processingJobs/{jobId}", region: env.FIREBASE_REGION },
  async (event) => {
    await processJob(event.params.jobId);
  }
);

/** Trusted AutoTrade path — never trusts browser execution payloads. */
export const onGoldMetaDecisionCreated = onDocumentCreated(
  {
    document: "users/{userId}/decisions/{decisionId}",
    region: env.FIREBASE_REGION
  },
  async (event) => {
    const userId = event.params.userId;
    const decisionId = event.params.decisionId;
    await processDecisionForAutoTrade({
      userId,
      decisionId,
      autoTrade: defaultAutoTradeService,
      store: defaultStore
    });
  }
);

/**
 * Durable Stocks Intraday job processor (create only).
 * Path: users/{userId}/stockIntraday/data/jobs/{jobId}
 * Retries are handled by stockIntradayJobRetryTick (nextAttemptAt + backoff).
 */
export const onStockIntradayJobCreated = onDocumentCreated(
  {
    document: "users/{userId}/stockIntraday/data/jobs/{jobId}",
    region: env.FIREBASE_REGION
  },
  async (event) => {
    const userId = event.params.userId;
    const jobId = event.params.jobId;
    await processStockIntradayJob(userId, jobId, {
      store: defaultStockIntradayService.getStore(),
      service: defaultStockIntradayService
    });
  }
);

/**
 * Coarse market-hours scheduler — enqueue only (processing via Firestore trigger).
 */
export const stockIntradaySchedulerTick = onSchedule(
  {
    schedule: "every 5 minutes",
    region: env.FIREBASE_REGION,
    timeZone: "America/New_York"
  },
  async () => {
    const userIds = await defaultStockIntradayService.listSchedulerUserIds();
    if (!userIds.length) {
      logger.info("Stock intraday scheduler: no registered users");
      return;
    }
    for (const userId of userIds) {
      await enqueueEngineTick({
        store: defaultStockIntradayService.getStore(),
        userId,
        kind: "MONITOR_POSITIONS"
      });
      await enqueueEngineTick({
        store: defaultStockIntradayService.getStore(),
        userId,
        kind: "SCHEDULED_SCAN"
      });
    }
  }
);

/**
 * Automatic job retries with exponential backoff (nextAttemptAt).
 * Does not immediately re-process; only claims due QUEUED jobs.
 */
export const stockIntradayJobRetryTick = onSchedule(
  {
    schedule: "every 1 minutes",
    region: env.FIREBASE_REGION,
    timeZone: "UTC"
  },
  async () => {
    const results = await defaultStockIntradayService.runJobRetryPass();
    if (results.length) {
      logger.info("Stock intraday job retry pass", { count: results.length });
    }
  }
);

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`GoldMeta backend listening on ${env.PORT}`);
  });
}
