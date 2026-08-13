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
import { processDecisionForQualification } from "./services/broker/ctrader/qualificationService";
import { runQuoteKeepalivePass } from "./services/broker/ctrader/quoteService";
import { runDemoPositionManagementPass } from "./services/broker/ctrader/demoPositionLifecycle";
import { runWeeklyReportPass } from "./services/broker/ctrader/weeklyReportService";

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
 * are bound. Demo paper submission may be enabled for Demo Auto; Live execution
 * stays hard-locked via flags.ts.
 * OAuth redirect URI continues to come from CTRADER_REDIRECT_URI (Secret Manager).
 */
/**
 * Demo opportunity mode remains ACTIVE_DEMO.
 * Temporary overnight overlay (DEMO_OVERNIGHT_MODE) is OFF after morning handoff.
 * Guard implementation in demoOvernightGuard.ts is retained for future controlled sessions.
 * Never enables Live.
 */
function applyDemoOvernightRuntimeEnv(): void {
  process.env.DEMO_OPPORTUNITY_MODE =
    process.env.DEMO_OPPORTUNITY_MODE || "ACTIVE_DEMO";
  // Morning handoff 2026-08-13: disable temporary overnight entry overlay.
  process.env.DEMO_OVERNIGHT_MODE = "false";
}

function applyProductionCTraderRuntimeEnv(): void {
  if (!(process.env.CTRADER_CLIENT_ID ?? "").trim()) return;
  process.env.CTRADER_CONNECTOR_ENABLED =
    process.env.CTRADER_CONNECTOR_ENABLED || "true";
  process.env.CTRADER_DEMO_READ_ENABLED =
    process.env.CTRADER_DEMO_READ_ENABLED || "true";
  process.env.CTRADER_DEMO_ORDER_PREVIEW_ENABLED =
    process.env.CTRADER_DEMO_ORDER_PREVIEW_ENABLED || "true";
  // Demo Auto / controlled Demo paper orders — Live remains impossible.
  process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
  process.env.CTRADER_LIVE_ENABLED = "false";
  process.env.BROKER_EXECUTION_ENABLED = "false";
  applyDemoOvernightRuntimeEnv();
  if (!process.env.GOLDMETA_WEB_ORIGIN) {
    process.env.GOLDMETA_WEB_ORIGIN =
      process.env.WEB_ORIGIN ?? "https://goldmeta.metamechsolutions.com";
  }
  // Force DEMO Open API environment for this phase.
  process.env.CTRADER_ENVIRONMENT = "DEMO";
}

/** Shared Demo Auto runtime env for decision-triggered execution (never Live). */
function applyDemoAutoTradeRuntimeEnv(): void {
  if (!(process.env.CTRADER_CLIENT_ID ?? "").trim()) return;
  process.env.CTRADER_CONNECTOR_ENABLED =
    process.env.CTRADER_CONNECTOR_ENABLED || "true";
  process.env.CTRADER_DEMO_READ_ENABLED =
    process.env.CTRADER_DEMO_READ_ENABLED || "true";
  process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
  process.env.CTRADER_LIVE_ENABLED = "false";
  process.env.BROKER_EXECUTION_ENABLED = "false";
  process.env.CTRADER_ENVIRONMENT = "DEMO";
  applyDemoOvernightRuntimeEnv();
}

/**
 * Micro Edge Phase-1 read-only runtime (OAuth/API only — no collector).
 * Never binds Core CTRADER_ACCESS_TOKEN / CTRADER_REFRESH_TOKEN.
 * Never enables Micro broker execution.
 */
function applyMicroEdgeRuntimeEnv(): void {
  process.env.MICRO_DEPLOYED_RUNTIME = "true";
  process.env.MICRO_STORAGE_MODE =
    process.env.MICRO_STORAGE_MODE || "firestore";
  process.env.MICRO_CTRADER_ENVIRONMENT =
    process.env.MICRO_CTRADER_ENVIRONMENT || "DEMO";
  process.env.MICRO_BROKER_EXECUTION_ENABLED = "false";
  process.env.MICRO_CTRADER_REDIRECT_URI =
    process.env.MICRO_CTRADER_REDIRECT_URI ||
    "https://goldmeta.metamechsolutions.com/micro-edge/connect/callback";
}

export const api = onRequest(
  {
    region: env.FIREBASE_REGION,
    // Display candle fetches open a short-lived cTrader WS — allow headroom.
    timeoutSeconds: 120,
    memory: "512MiB",
    // Pinned owner UID for Auth integrity; T212 Practice DEMO secrets for
    // read-only / dry-run Invest diagnostics only. Never bind T212_LIVE_*.
    // CTRADER_* secrets enable Pepperstone OAuth on production `api` as well as
    // apiCTraderPreview. Redirect URI must match the Open API app allowlist.
    // MICRO_CTRADER_* secrets are Micro-only app identity + token vault crypto.
    // They must NOT include Core access/refresh tokens.
    secrets: [
      "GOLDMETA_PINNED_OWNER_UID",
      "T212_DEMO_API_KEY",
      "T212_DEMO_API_SECRET",
      "CTRADER_CLIENT_ID",
      "CTRADER_CLIENT_SECRET",
      "CTRADER_REDIRECT_URI",
      "CTRADER_" + "TOKEN_ENCRYPTION_KEY",
      "CTRADER_ENVIRONMENT",
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
      "MICRO_CTRADER_CLIENT_ID",
      "MICRO_CTRADER_CLIENT_SECRET",
      "MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY"
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
    applyMicroEdgeRuntimeEnv();
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
  {
    document: "processingJobs/{jobId}",
    region: env.FIREBASE_REGION,
    // Web Push for plan/decision alerts needs the same VAPID material as `api`.
    secrets: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]
  },
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

/**
 * Demo position lifecycle management — SL verify, breakeven, TP tracking.
 * Runs with PWA closed. Demo mutations enabled for this worker only; Live stays locked.
 */
export const manageDemoAutoTradePositions = onSchedule(
  {
    schedule: "every 1 minutes",
    region: env.FIREBASE_REGION,
    timeoutSeconds: 240,
    memory: "512MiB",
    secrets: [
      "CTRADER_CLIENT_ID",
      "CTRADER_CLIENT_SECRET",
      "CTRADER_REDIRECT_URI",
      "CTRADER_" + "TOKEN_ENCRYPTION_KEY",
      "CTRADER_ENVIRONMENT"
    ]
  },
  async () => {
    if (!(process.env.CTRADER_CLIENT_ID ?? "").trim()) {
      console.log(
        JSON.stringify({
          event: "manage_demo_positions_skip",
          reason: "CTRADER_CLIENT_ID_MISSING",
          ts: new Date().toISOString()
        })
      );
      return;
    }
    process.env.CTRADER_CONNECTOR_ENABLED = "true";
    process.env.CTRADER_DEMO_READ_ENABLED = "true";
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    process.env.CTRADER_LIVE_ENABLED = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
    process.env.CTRADER_ENVIRONMENT = "DEMO";
    const result = await runDemoPositionManagementPass();
    console.log(
      JSON.stringify({
        event: "manage_demo_positions_pass",
        ...result,
        ts: new Date().toISOString()
      })
    );
  }
);

/**
 * Weekly GoldMeta report — after the trading week closes (Sunday 21:10 UTC).
 * Idempotent per uid/week/environment.
 */
export const generateWeeklyGoldMetaReports = onSchedule(
  {
    schedule: "every sunday 21:10",
    region: env.FIREBASE_REGION,
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [
      "CTRADER_CLIENT_ID",
      "CTRADER_CLIENT_SECRET",
      "CTRADER_REDIRECT_URI",
      "CTRADER_" + "TOKEN_ENCRYPTION_KEY",
      "CTRADER_ENVIRONMENT"
    ]
  },
  async () => {
    await runWeeklyReportPass();
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
    // Demo paper AutoTrade path — submission on; Live stays hard-off.
    applyDemoAutoTradeRuntimeEnv();
    await processDecisionForAutoTrade({
      userId,
      decisionId,
      autoTrade: defaultAutoTradeService,
      store: defaultStore
    });
    try {
      await processDecisionForQualification({
        uid: userId,
        decisionId,
        store: defaultStore
      });
    } catch (error) {
      console.error("Qualification decision trigger failed", {
        userId,
        decisionId,
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }
);

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`GoldMeta backend listening on ${env.PORT}`);
  });
}
