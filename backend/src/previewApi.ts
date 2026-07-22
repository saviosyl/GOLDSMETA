/**
 * Isolated V6 preview HTTPS function — IG Demo read-only AutoTrade.
 *
 * Deploy ONLY this function (never replace production `api`):
 *   firebase deploy --only functions:apiV6Preview
 *
 * Secrets (Firebase Secret Manager — set privately via CLI):
 *   IG_DEMO_API_KEY, IG_DEMO_USERNAME, IG_DEMO_PASSWORD, IG_DEMO_ACCOUNT_ID
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import type { Express } from "express";
import { createApiApp } from "./apiApp";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import { LIVE_EXECUTION_FEATURE_FLAG } from "./services/autoTrade/types";
import { redactSecrets } from "./services/autoTrade/redactSecrets";

const igDemoApiKey = defineSecret("IG_DEMO_API_KEY");
const igDemoUsername = defineSecret("IG_DEMO_USERNAME");
const igDemoPassword = defineSecret("IG_DEMO_PASSWORD");
const igDemoAccountId = defineSecret("IG_DEMO_ACCOUNT_ID");

function applyPreviewRuntimeEnv(): void {
  process.env.AUTOTRADE_BROKER = "ig_demo";
  process.env.DEMO_ORDER_SUBMISSION_ENABLED = "false";
  process.env.LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.AUTOTRADE_STORE = "firestore";
  process.env.AUTOTRADE_FIRESTORE_ROOT = "autoTradePreview";
  process.env.IG_DEMO_API_KEY = igDemoApiKey.value();
  process.env.IG_DEMO_USERNAME = igDemoUsername.value();
  process.env.IG_DEMO_PASSWORD = igDemoPassword.value();
  process.env.IG_DEMO_ACCOUNT_ID = igDemoAccountId.value();
}

let previewApp: Express | null = null;

function getPreviewApp(): Express {
  if (!previewApp) {
    applyPreviewRuntimeEnv();
    // Create AutoTrade AFTER secrets are in process.env — fail closed on ig_demo.
    const autoTradeService = createAutoTradeService({ brokerMode: "ig_demo" });
    previewApp = createApiApp({ autoTradeService });
  }
  return previewApp;
}

/**
 * Preview-only AutoTrade API. Production `api` is unchanged.
 * Fail-closed: AUTOTRADE_BROKER=ig_demo with no silent FakeIg fallback.
 */
export const apiV6Preview = onRequest(
  {
    region: "us-central1",
    cors: false,
    invoker: "public",
    secrets: [igDemoApiKey, igDemoUsername, igDemoPassword, igDemoAccountId],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  (req, res) => {
    try {
      if (LIVE_EXECUTION_FEATURE_FLAG) {
        res.status(403).json({ error: "LIVE_BLOCKED", message: "Live execution is disabled." });
        return;
      }
      getPreviewApp()(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview API error";
      console.error("[apiV6Preview]", redactSecrets(message));
      if (!res.headersSent) {
        res.status(503).json({
          error: "PREVIEW_API_UNAVAILABLE",
          message: "IG Demo preview backend unavailable. Check secrets and try again.",
          environment: "IG DEMO — READ ONLY",
        });
      }
    }
  }
);
