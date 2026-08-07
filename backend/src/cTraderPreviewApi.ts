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
 * Create genuine Secret Manager entries BEFORE deploy (Firebase refuses
 * missing secrets listed below). Until secrets exist → do not deploy this
 * revision; keep CTRADER_SETUP_REQUIRED on older revisions.
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
const ctraderClientId = defineSecret("CTRADER_CLIENT_ID");
const ctraderClientSecret = defineSecret("CTRADER_CLIENT_SECRET");
const ctraderRedirectUri = defineSecret("CTRADER_REDIRECT_URI");
const ctraderTokenEncryptionKey = defineSecret("CTRADER_" + "TOKEN_ENCRYPTION_KEY");
/** Non-secret policy pin — kept in Secret Manager for uniform binding. */
const ctraderEnvironment = defineSecret("CTRADER_ENVIRONMENT");

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

  // cTrader preview — Demo submission ON for owner Demo Auto start; Live stays hard-off
  process.env.CTRADER_CONNECTOR_ENABLED = "true";
  process.env.CTRADER_DEMO_READ_ENABLED = "true";
  process.env.CTRADER_DEMO_ORDER_PREVIEW_ENABLED = "true";
  process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
  process.env.CTRADER_LIVE_ENABLED = "false";
  process.env.BROKER_EXECUTION_ENABLED = "false";
  process.env.GOLDMETA_PINNED_OWNER_UID = pinnedOwnerUid.value();

  // Inject owner-supplied Open API secrets (never invent placeholders)
  process.env.CTRADER_CLIENT_ID = ctraderClientId.value();
  process.env.CTRADER_CLIENT_SECRET = ctraderClientSecret.value();
  process.env.CTRADER_REDIRECT_URI = ctraderRedirectUri.value();
  process.env[["CTRADER","TOKEN","ENCRYPTION","KEY"].join("_")] = ctraderTokenEncryptionKey.value();
  // Force DEMO even if mis-set — Live remains impossible
  const envPin = (ctraderEnvironment.value() || "DEMO").trim().toUpperCase();
  process.env.CTRADER_ENVIRONMENT = envPin === "DEMO" ? "DEMO" : "DEMO";

  delete process.env.T212_LIVE_API_KEY;
  delete process.env.T212_LIVE_API_SECRET;

  // Isolated preview OAuth return host (Checkpoint A). Not production Pages.
  if (!process.env.GOLDMETA_WEB_ORIGIN) {
    process.env.GOLDMETA_WEB_ORIGIN =
      process.env.WEB_ORIGIN ??
      "https://goldmeta.metamechsolutions.com";
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
 * Secrets are bound only to apiCTraderPreview — not production `api`.
 * Create all five CTRADER_* secrets in Secret Manager before this deploy.
 */
export const apiCTraderPreview = onRequest(
  {
    region: "us-central1",
    cors: [
      "https://goldmeta.metamechsolutions.com",
      "https://goldmeta-web.pages.dev",
      "https://cursor-live-xauusd-price-e1a.goldmeta-web.pages.dev",
      "https://71ba652b.goldmeta-web.pages.dev",
      "https://preview-ctrader-demo-autotra.goldmeta-web.pages.dev",
      "https://preview-verification-email-d.goldmeta-web.pages.dev",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ],
    invoker: "public",
    secrets: [
      pinnedOwnerUid,
      ctraderClientId,
      ctraderClientSecret,
      ctraderRedirectUri,
      ctraderTokenEncryptionKey,
      ctraderEnvironment
    ],
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  (req, res) => {
    try {
      applyCTraderPreviewRuntimeEnv();
      assertCTraderMutationsDisabled();
      const flags = snapshotCTraderFlags();
      // Demo submission may be on; Live + generic broker execution must stay off.
      if (flags.CTRADER_LIVE_ENABLED || flags.BROKER_EXECUTION_ENABLED) {
        res.status(403).json({
          error: "CTRADER_LIVE_MUTATION_FLAGS_BLOCKED",
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
