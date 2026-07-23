/**
 * Isolated Trading 212 Practice read-only preview HTTPS function.
 *
 * Deploy ONLY this function (never replace production `api`):
 *   firebase deploy --only functions:apiT212Preview
 *
 * Secrets (Firebase Secret Manager):
 *   T212_DEMO_API_KEY, T212_DEMO_API_SECRET
 *   GOLDMETA_PINNED_OWNER_UID (Auth integrity endpoint only)
 *
 * Never binds T212_LIVE_* secrets.
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import type { Express } from "express";
import { createApiApp } from "./apiApp";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import {
  LIVE_EXECUTION_FEATURE_FLAG,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "./services/autoTrade/types";
import { redactSecrets } from "./services/autoTrade/redactSecrets";

const t212DemoApiKey = defineSecret("T212_DEMO_API_KEY");
const t212DemoApiSecret = defineSecret("T212_DEMO_API_SECRET");
const pinnedOwnerUid = defineSecret("GOLDMETA_PINNED_OWNER_UID");

function applyT212PreviewRuntimeEnv(): void {
  process.env.AUTOTRADE_BROKER = "fake";
  process.env.BROKER_EXECUTION_ENABLED = "false";
  process.env.DEMO_ORDER_SUBMISSION_ENABLED = "false";
  process.env.LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.T212_PAPER_ORDER_SUBMISSION_ENABLED = "false";
  process.env.T212_LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.AUTOTRADE_STORE = "firestore";
  process.env.AUTOTRADE_FIRESTORE_ROOT = "autoTradeT212Preview";
  process.env.T212_DEMO_API_KEY = t212DemoApiKey.value();
  process.env.T212_DEMO_API_SECRET = t212DemoApiSecret.value();
  process.env.GOLDMETA_PINNED_OWNER_UID = pinnedOwnerUid.value();
  // Explicitly clear any Live credential env so Practice cannot load Live secrets.
  delete process.env.T212_LIVE_API_KEY;
  delete process.env.T212_LIVE_API_SECRET;
}

let previewApp: Express | null = null;

function getT212PreviewApp(): Express {
  if (!previewApp) {
    applyT212PreviewRuntimeEnv();
    // IG adapter factory stays on "fake" — T212 uses dedicated credential loader/client.
    // Never loads IG Demo secrets in this preview.
    const autoTradeService = createAutoTradeService({ brokerMode: "fake" });
    previewApp = createApiApp({ autoTradeService });
  }
  return previewApp;
}

/**
 * Preview-only Trading 212 Practice AutoTrade API. Production `api` is unchanged.
 */
export const apiT212Preview = onRequest(
  {
    region: "us-central1",
    cors: [
      "https://goldmeta.metamechsolutions.com",
      "https://goldmeta-web.pages.dev",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ],
    invoker: "public",
    secrets: [t212DemoApiKey, t212DemoApiSecret, pinnedOwnerUid],
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  (req, res) => {
    try {
      if (
        LIVE_EXECUTION_FEATURE_FLAG ||
        T212_LIVE_EXECUTION_FEATURE_FLAG ||
        T212_PAPER_ORDER_SUBMISSION_ENABLED
      ) {
        res.status(403).json({
          error: "EXECUTION_BLOCKED",
          message: "Trading 212 order submission remains disabled."
        });
        return;
      }
      getT212PreviewApp()(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview API error";
      console.error("[apiT212Preview]", redactSecrets(message));
      if (!res.headersSent) {
        res.status(503).json({
          error: "T212_PREVIEW_API_UNAVAILABLE",
          message: "Trading 212 Practice preview backend unavailable. Check secrets and try again.",
          environment: "T212 PRACTICE — READ ONLY"
        });
      }
    }
  }
);
