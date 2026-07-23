/**
 * Production Cloud Functions entry + re-exports.
 * Production `api` serves Signal Outcome Tracking + AutoTrade Control Centre.
 * `apiV6Preview` remains additive / isolated (IG Demo secrets).
 *
 * IG Demo secret binding for production `api` lives in `productionApi.ts`
 * (draft fix for ig_session_failed — do not deploy without approval).
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
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
import { AutoTradeService } from "./services/autoTrade/autoTradeService";
import { processDecisionForAutoTrade } from "./services/autoTrade/decisionTrigger";

const igDemoApiKey = defineSecret("IG_DEMO_API_KEY");
const igDemoUsername = defineSecret("IG_DEMO_USERNAME");
const igDemoPassword = defineSecret("IG_DEMO_PASSWORD");
const igDemoAccountId = defineSecret("IG_DEMO_ACCOUNT_ID");

const defaultStore = createStore();
const defaultTradingService = new TradingModeService(new InMemoryTradingStore());
/** Local/test AutoTrade — production HTTPS + decision trigger use secret-bound lazy init. */
const defaultAutoTradeService = createAutoTradeService();

let decisionAutoTradeService: AutoTradeService | null = null;
function getDecisionAutoTradeService(): AutoTradeService {
  if (!decisionAutoTradeService) {
    process.env.BROKER_EXECUTION_ENABLED = "false";
    process.env.DEMO_ORDER_SUBMISSION_ENABLED = "false";
    process.env.LIVE_EXECUTION_FEATURE_FLAG = "false";
    process.env.T212_PAPER_ORDER_SUBMISSION_ENABLED = "false";
    process.env.T212_LIVE_EXECUTION_FEATURE_FLAG = "false";
    process.env.AUTOTRADE_BROKER = "ig_demo";
    process.env.IG_DEMO_API_KEY = igDemoApiKey.value();
    process.env.IG_DEMO_USERNAME = igDemoUsername.value();
    process.env.IG_DEMO_PASSWORD = igDemoPassword.value();
    process.env.IG_DEMO_ACCOUNT_ID = igDemoAccountId.value();
    decisionAutoTradeService = createAutoTradeService({ brokerMode: "ig_demo" });
  }
  return decisionAutoTradeService;
}

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

/** Production HTTPS API (IG Demo secrets bound; orders still disabled). */
export { api } from "./productionApi";

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
    region: env.FIREBASE_REGION,
    secrets: [igDemoApiKey, igDemoUsername, igDemoPassword, igDemoAccountId]
  },
  async (event) => {
    const userId = event.params.userId;
    const decisionId = event.params.decisionId;
    await processDecisionForAutoTrade({
      userId,
      decisionId,
      autoTrade: getDecisionAutoTradeService(),
      store: defaultStore
    });
  }
);

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`GoldMeta backend listening on ${env.PORT}`);
  });
}
