/**
 * Production Cloud Functions entry + re-exports.
 * Production `api` serves Signal Outcome Tracking + AutoTrade Control Centre.
 * `apiV6Preview` remains additive / isolated (IG Demo secrets).
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { env } from "./config/env";
import { createApiApp, type AppDependencies } from "./apiApp";
import { processJob } from "./services/jobs/processJob";
import { processOutcomeMonitorJob } from "./services/signalOutcome/monitor";
import { runOutcomeMonitorRetryPass } from "./services/signalOutcome/retryPass";
import { createStore } from "./services/storage/createStore";
import { AiExplainer } from "./services/ai/explainer";
import { InMemoryTradingStore } from "./services/trading/inMemoryTradingStore";
import { TradingModeService } from "./services/trading/tradingModeService";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import { processDecisionForAutoTrade } from "./services/autoTrade/decisionTrigger";

const defaultStore = createStore();
const defaultTradingService = new TradingModeService(new InMemoryTradingStore());
const defaultAutoTradeService = createAutoTradeService();

export type { AppDependencies };
export { createApiApp };

export const createApp = (dependencies: Partial<AppDependencies> = {}) =>
  createApiApp({
    store: dependencies.store ?? defaultStore,
    aiExplainer: dependencies.aiExplainer ?? new AiExplainer(),
    tradingService: dependencies.tradingService ?? defaultTradingService,
    autoTradeService: dependencies.autoTradeService ?? defaultAutoTradeService
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

/** Durable signal-outcome bar monitor — retries independently of decision jobs. */
export const processOutcomeMonitorJobDoc = onDocumentCreated(
  { document: "outcomeMonitorJobs/{jobId}", region: env.FIREBASE_REGION },
  async (event) => {
    await processOutcomeMonitorJob(event.params.jobId);
  }
);

/**
 * Automatic retry for FAILED/QUEUED outcome-monitor jobs past nextAttemptAt.
 * onDocumentCreated does not re-fire when a job is updated to FAILED — this
 * scheduled pass claims due jobs transactionally with exponential backoff.
 */
export const retryOutcomeMonitorJobs = onSchedule(
  {
    schedule: "every 1 minutes",
    region: env.FIREBASE_REGION,
    timeoutSeconds: 120
  },
  async () => {
    await runOutcomeMonitorRetryPass();
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

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`GoldMeta backend listening on ${env.PORT}`);
  });
}
