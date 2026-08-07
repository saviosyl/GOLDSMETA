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
import { runQuoteKeepalivePass } from "./services/broker/ctrader/quoteService";

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
/**
 * Apply cTrader Demo connector env on production `api` when CTRADER_* secrets
 * are bound. Order submission / Live execution remain hard-locked via flags.ts.
 * OAuth redirect URI continues to come from CTRADER_REDIRECT_URI (Secret Manager).
 */
function applyProductionCTraderRuntimeEnv(): void {
  if (!(process.env.CTRADER_CLIENT_ID ?? "").trim()) return;
  process.env.CTRADER_CONNECTOR_ENABLED =
    process.env.CTRADER_CONNECTOR_ENABLED || "true";
  process.env.CTRADER_DEMO_READ_ENABLED =
    process.env.CTRADER_DEMO_READ_ENABLED || "true";
  process.env.CTRADER_DEMO_ORDER_PREVIEW_ENABLED =
    process.env.CTRADER_DEMO_ORDER_PREVIEW_ENABLED || "true";
  process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "false";
  process.env.CTRADER_LIVE_ENABLED = "false";
  process.env.BROKER_EXECUTION_ENABLED = "false";
  // LIVE SHADOW may be enabled via env; Live order submission stays hard-locked.
  if (!("CTRADER_LIVE_SHADOW_ENABLED" in process.env)) {
    process.env.CTRADER_LIVE_SHADOW_ENABLED = "false";
  }
  if (!process.env.GOLDMETA_WEB_ORIGIN) {
    process.env.GOLDMETA_WEB_ORIGIN =
      process.env.WEB_ORIGIN ?? "https://goldmeta.metamechsolutions.com";
  }
  // Force DEMO Open API environment for OAuth app config; Live account
  // selection still uses the Live host via per-call isLive flags.
  process.env.CTRADER_ENVIRONMENT = "DEMO";
}

export const api = onRequest(
  {
    region: env.FIREBASE_REGION,
    // Pinned owner UID for Auth integrity; T212 Practice DEMO secrets for
    // read-only / dry-run Invest diagnostics only. Never bind T212_LIVE_*.
    // CTRADER_* secrets enable Pepperstone OAuth on production `api` as well as
    // apiCTraderPreview. Redirect URI must match the Open API app allowlist.
    secrets: [
      "GOLDMETA_PINNED_OWNER_UID",
      "T212_DEMO_API_KEY",
      "T212_DEMO_API_SECRET",
      "CTRADER_CLIENT_ID",
      "CTRADER_CLIENT_SECRET",
      "CTRADER_REDIRECT_URI",
      "CTRADER_" + "TOKEN_ENCRYPTION_KEY",
      "CTRADER_ENVIRONMENT"
    ],
    cors: [
      "https://goldmeta.metamechsolutions.com",
      "https://goldmeta-web.pages.dev",
      "https://cursor-live-xauusd-price-e1a.goldmeta-web.pages.dev",
      "https://71ba652b.goldmeta-web.pages.dev",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ]
  },
  (req, res) => {
    applyProductionCTraderRuntimeEnv();
    app(req, res);
  }
);

/** Isolated V6 IG Demo read-only preview — deploy with --only functions:apiV6Preview */
export { apiV6Preview } from "./previewApi";

/** Isolated Trading 212 Practice read-only preview — deploy with --only functions:apiT212Preview */
export { apiT212Preview } from "./t212PreviewApi";

/**
 * Isolated Pepperstone cTrader Demo preview — deploy with --only functions:apiCTraderPreview.
 * Read/preview only; order submission flags forced false; no fabricated client secrets.
 */
export { apiCTraderPreview } from "./cTraderPreviewApi";

/**
 * Auth blocking: reject public account creation.
 * Requires Identity Platform blocking functions enabled for the project.
 * Deploy with functions that include beforeUserCreatedGuard.
 */
export { beforeUserCreatedGuard } from "./services/auth/beforeUserCreated";

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

/**
 * Keep Pepperstone XAUUSD quotes fresh on the backend while the PWA/browser is closed.
 * Frontend short-poll delivers sub-second display; this pass sustains the authoritative store.
 */
export const refreshCTraderLiveQuotes = onSchedule(
  {
    schedule: "every 1 minutes",
    region: env.FIREBASE_REGION,
    timeoutSeconds: 120,
    secrets: [
      "CTRADER_CLIENT_ID",
      "CTRADER_CLIENT_SECRET",
      "CTRADER_REDIRECT_URI",
      "CTRADER_" + "TOKEN_ENCRYPTION_KEY",
      "CTRADER_ENVIRONMENT"
    ]
  },
  async () => {
    applyProductionCTraderRuntimeEnv();
    await runQuoteKeepalivePass();
  }
);

/** Trusted AutoTrade path — never trusts browser execution payloads. */
export const onGoldMetaDecisionCreated = onDocumentCreated(
  {
    document: "users/{userId}/decisions/{decisionId}",
    region: env.FIREBASE_REGION,
    timeoutSeconds: 120,
    secrets: [
      "GOLDMETA_PINNED_OWNER_UID",
      "CTRADER_CLIENT_ID",
      "CTRADER_CLIENT_SECRET",
      "CTRADER_REDIRECT_URI",
      "CTRADER_" + "TOKEN_ENCRYPTION_KEY",
      "CTRADER_ENVIRONMENT"
    ]
  },
  async (event) => {
    applyProductionCTraderRuntimeEnv();
    // LIVE SHADOW on for production decision triggers; Live submit stays hard-locked.
    process.env.CTRADER_LIVE_SHADOW_ENABLED = "true";
    process.env.CTRADER_QUOTE_REQUIRE_LIVE =
      process.env.CTRADER_QUOTE_REQUIRE_LIVE || "true";
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
