/**
 * Isolated Pepperstone cTrader Demo preview HTTPS function.
 *
 * Deploy ONLY this function (never replace production `api`):
 *   firebase deploy --only functions:apiCTraderPreview
 *
 * Allowed: OAuth (Demo), account discovery, symbol/quote read, preview.
 * Forbidden: order submission, close, cancel, Live environment.
 *
 * Does NOT fabricate CTRADER_CLIENT_* secrets.
 * When the owner creates Secret Manager entries, bind them to this function and
 * redeploy so process.env receives CTRADER_CLIENT_ID / SECRET / REDIRECT_URI /
 * CTRADER_TOKEN_ENCRYPTION_KEY. Until then → CTRADER_SETUP_REQUIRED.
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import type { Express } from "express";
import { createApiApp } from "./apiApp";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import { redactSecrets } from "./services/autoTrade/redactSecrets";
import {
  assertCTraderMutationsDisabled,
  snapshotCTraderFlags
} from "./services/broker/ctrader/flags";

const pinnedOwnerUid = defineSecret("GOLDMETA_PINNED_OWNER_UID");

function applyCTraderPreviewRuntimeEnv(): void {
  // Shared app fail-closed (mirror apiT212Preview / apiV6Preview)
  process.env.AUTOTRADE_BROKER = "fake";
  process.env.BROKER_EXECUTION_ENABLED = "false";
  process.env.DEMO_ORDER_SUBMISSION_ENABLED = "false";
  process.env.LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.T212_PAPER_ORDER_SUBMISSION_ENABLED = "false";
  process.env.T212_LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.AUTOTRADE_STORE = "firestore";
  process.env.AUTOTRADE_FIRESTORE_ROOT = "autoTradeCTraderPreview";

  // cTrader preview capabilities — mutations hard-false
  process.env.CTRADER_CONNECTOR_ENABLED = "true";
  process.env.CTRADER_DEMO_READ_ENABLED = "true";
  process.env.CTRADER_DEMO_ORDER_PREVIEW_ENABLED = "true";
  process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "false";
  process.env.CTRADER_LIVE_ENABLED = "false";
  process.env.CTRADER_ENVIRONMENT = "DEMO";
  process.env.GOLDMETA_PINNED_OWNER_UID = pinnedOwnerUid.value();

  // Preserve owner-supplied CTRADER_* from Secret Manager binding when present.
  // Do not invent or delete valid injected values — only clear Live T212 keys.
  delete process.env.T212_LIVE_API_KEY;
  delete process.env.T212_LIVE_API_SECRET;

  if (!process.env.GOLDMETA_WEB_ORIGIN) {
    process.env.GOLDMETA_WEB_ORIGIN =
      process.env.WEB_ORIGIN ?? "https://goldmeta.metamechsolutions.com";
  }
}

let previewApp: Express | null = null;

function getCTraderPreviewApp(): Express {
  if (!previewApp) {
    applyCTraderPreviewRuntimeEnv();
    const autoTradeService = createAutoTradeService({ brokerMode: "fake" });
    previewApp = createApiApp({ autoTradeService });
  }
  return previewApp;
}

/**
 * Bind CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET, CTRADER_REDIRECT_URI,
 * CTRADER_TOKEN_ENCRYPTION_KEY here after the owner creates them in Secret Manager.
 * Listing missing secrets breaks deploy — keep them out until they exist.
 */
export const apiCTraderPreview = onRequest(
  {
    region: "us-central1",
    cors: [
      "https://goldmeta.metamechsolutions.com",
      "https://goldmeta-web.pages.dev",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ],
    invoker: "public",
    secrets: [pinnedOwnerUid],
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  (req, res) => {
    try {
      applyCTraderPreviewRuntimeEnv();
      assertCTraderMutationsDisabled();
      const flags = snapshotCTraderFlags();
      if (
        flags.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED ||
        flags.CTRADER_LIVE_ENABLED ||
        flags.BROKER_EXECUTION_ENABLED
      ) {
        res.status(403).json({
          error: "CTRADER_MUTATION_FLAGS_BLOCKED",
          flags
        });
        return;
      }
      getCTraderPreviewApp()(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "CTrader preview API error";
      console.error("[apiCTraderPreview]", redactSecrets(message));
      if (!res.headersSent) {
        res.status(503).json({
          error: "CTRADER_PREVIEW_UNAVAILABLE",
          message: "cTrader Demo preview backend unavailable.",
          environment: "PEPPERSTONE cTRADER DEMO — PREVIEW ONLY",
          orderSubmissionEnabled: false
        });
      }
    }
  }
);
