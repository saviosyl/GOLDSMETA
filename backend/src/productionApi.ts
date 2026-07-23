/**
 * Production HTTPS `api` — Signal Outcome Tracking + AutoTrade Control Centre.
 *
 * IG Demo secrets are bound here so Connect IG Demo can establish a read-only
 * session. Order submission stays hard-disabled (all execution flags false).
 *
 * Do not deploy this change without explicit approval after review.
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import type { Express } from "express";
import { env } from "./config/env";
import { createApiApp } from "./apiApp";
import { AiExplainer } from "./services/ai/explainer";
import { createStore } from "./services/storage/createStore";
import { InMemoryTradingStore } from "./services/trading/inMemoryTradingStore";
import { TradingModeService } from "./services/trading/tradingModeService";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import {
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "./services/autoTrade/types";
import { redactSecrets } from "./services/autoTrade/redactSecrets";

const igDemoApiKey = defineSecret("IG_DEMO_API_KEY");
const igDemoUsername = defineSecret("IG_DEMO_USERNAME");
const igDemoPassword = defineSecret("IG_DEMO_PASSWORD");
const igDemoAccountId = defineSecret("IG_DEMO_ACCOUNT_ID");

function assertExecutionFlagsSafe(): void {
  process.env.BROKER_EXECUTION_ENABLED = "false";
  process.env.DEMO_ORDER_SUBMISSION_ENABLED = "false";
  process.env.LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.T212_PAPER_ORDER_SUBMISSION_ENABLED = "false";
  process.env.T212_LIVE_EXECUTION_FEATURE_FLAG = "false";
  if (
    DEMO_ORDER_SUBMISSION_ENABLED ||
    LIVE_EXECUTION_FEATURE_FLAG ||
    T212_PAPER_ORDER_SUBMISSION_ENABLED ||
    T212_LIVE_EXECUTION_FEATURE_FLAG
  ) {
    throw new Error("EXECUTION_FLAGS_MUST_REMAIN_FALSE");
  }
}

function applyProductionIgDemoEnv(): void {
  assertExecutionFlagsSafe();
  process.env.AUTOTRADE_BROKER = "ig_demo";
  process.env.IG_DEMO_API_KEY = igDemoApiKey.value();
  process.env.IG_DEMO_USERNAME = igDemoUsername.value();
  process.env.IG_DEMO_PASSWORD = igDemoPassword.value();
  process.env.IG_DEMO_ACCOUNT_ID = igDemoAccountId.value();
}

let productionApp: Express | null = null;

function getProductionApp(): Express {
  if (!productionApp) {
    applyProductionIgDemoEnv();
    // Create AutoTrade AFTER secrets are in process.env — fail closed on ig_demo.
    const autoTradeService = createAutoTradeService({ brokerMode: "ig_demo" });
    productionApp = createApiApp({
      store: createStore(),
      aiExplainer: new AiExplainer(),
      tradingService: new TradingModeService(new InMemoryTradingStore()),
      autoTradeService
    });
  }
  return productionApp;
}

/**
 * Production API. IG Demo connect is read-only; dealing/order paths stay blocked.
 * Fail-closed lock behaviour for failed IG sessions is unchanged.
 */
export const api = onRequest(
  {
    region: env.FIREBASE_REGION,
    cors: [
      "https://goldmeta.metamechsolutions.com",
      "https://goldmeta-web.pages.dev",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ],
    secrets: [igDemoApiKey, igDemoUsername, igDemoPassword, igDemoAccountId],
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  (req, res) => {
    try {
      assertExecutionFlagsSafe();
      getProductionApp()(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Production API error";
      console.error("[api]", redactSecrets(message));
      if (!res.headersSent) {
        res.status(503).json({
          error: "API_UNAVAILABLE",
          message: "Backend temporarily unavailable. Check IG Demo secrets and try again."
        });
      }
    }
  }
);
