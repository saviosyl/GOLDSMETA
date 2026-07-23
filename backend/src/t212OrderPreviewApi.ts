/**
 * Isolated Trading 212 Practice ORDER preview HTTPS function.
 *
 * Deploy ONLY this function (never replace production `api`):
 *   firebase deploy --only functions:apiT212OrderPreview
 *
 * Enables Practice paper submission flags in THIS process only:
 *   BROKER_EXECUTION_ENABLED=true
 *   T212_PAPER_ORDER_SUBMISSION_ENABLED=true
 *   DEMO_ORDER_SUBMISSION_ENABLED=true
 *   T212_LIVE_EXECUTION_FEATURE_FLAG=false
 *   LIVE_EXECUTION_FEATURE_FLAG=false
 *
 * Secrets: T212_DEMO_* + GOLDMETA_PINNED_OWNER_UID only. Never binds T212_LIVE_*.
 * Firestore root: autoTradeT212OrderPreview
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import type { Express } from "express";
import { createApiApp } from "./apiApp";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import {
  isLiveExecutionFeatureFlag,
  isPracticeOrderSubmissionAllowed,
  isT212LiveExecutionFeatureFlag
} from "./services/autoTrade/executionFlags";
import { redactSecrets } from "./services/autoTrade/redactSecrets";

const t212DemoApiKey = defineSecret("T212_DEMO_API_KEY");
const t212DemoApiSecret = defineSecret("T212_DEMO_API_SECRET");
const pinnedOwnerUid = defineSecret("GOLDMETA_PINNED_OWNER_UID");

function applyT212OrderPreviewRuntimeEnv(): void {
  process.env.AUTOTRADE_BROKER = "fake";
  process.env.BROKER_EXECUTION_ENABLED = "true";
  process.env.DEMO_ORDER_SUBMISSION_ENABLED = "true";
  process.env.T212_PAPER_ORDER_SUBMISSION_ENABLED = "true";
  process.env.LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.T212_LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.AUTOTRADE_STORE = "firestore";
  process.env.AUTOTRADE_FIRESTORE_ROOT = "autoTradeT212OrderPreview";
  process.env.T212_ORDER_PREVIEW = "true";
  process.env.T212_DEMO_API_KEY = t212DemoApiKey.value();
  process.env.T212_DEMO_API_SECRET = t212DemoApiSecret.value();
  process.env.GOLDMETA_PINNED_OWNER_UID = pinnedOwnerUid.value();
  delete process.env.T212_LIVE_API_KEY;
  delete process.env.T212_LIVE_API_SECRET;
}

let orderPreviewApp: Express | null = null;

function getT212OrderPreviewApp(): Express {
  if (!orderPreviewApp) {
    applyT212OrderPreviewRuntimeEnv();
    const autoTradeService = createAutoTradeService({ brokerMode: "fake" });
    orderPreviewApp = createApiApp({ autoTradeService });
  }
  return orderPreviewApp;
}

/**
 * Preview-only Trading 212 Practice order automation API.
 * Production `api` remains dry-run / read-only with all execution flags false.
 */
export const apiT212OrderPreview = onRequest(
  {
    region: "us-central1",
    cors: [
      "https://goldmeta.metamechsolutions.com",
      "https://goldmeta-web.pages.dev",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ],
    // Authenticated app traffic; Cloud Run invoker public + Firebase Auth in app.
    invoker: "public",
    secrets: [t212DemoApiKey, t212DemoApiSecret, pinnedOwnerUid],
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  (req, res) => {
    try {
      applyT212OrderPreviewRuntimeEnv();
      if (isLiveExecutionFeatureFlag() || isT212LiveExecutionFeatureFlag()) {
        res.status(403).json({
          error: "LIVE_EXECUTION_BLOCKED",
          message: "Live Trading 212 execution is locked."
        });
        return;
      }
      if (!isPracticeOrderSubmissionAllowed()) {
        res.status(503).json({
          error: "PRACTICE_ORDER_FLAGS_NOT_ACTIVE",
          message: "Practice order preview flags failed to activate."
        });
        return;
      }
      getT212OrderPreviewApp()(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Order preview API error";
      console.error("[apiT212OrderPreview]", redactSecrets(message));
      if (!res.headersSent) {
        res.status(503).json({
          error: "T212_ORDER_PREVIEW_UNAVAILABLE",
          message:
            "Trading 212 Practice order preview backend unavailable. Check secrets and try again.",
          environment: "T212 PRACTICE — ORDER PREVIEW"
        });
      }
    }
  }
);
