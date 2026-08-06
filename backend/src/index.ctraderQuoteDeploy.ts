/**
 * Slim Cloud Functions entry for Pepperstone live-quote deploy only.
 * Intentionally does NOT import previewApi / t212PreviewApi so Firebase
 * analysis does not require IG/T212 secrets.get during deploy.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { env } from "./config/env";
import { createApiApp } from "./apiApp";
import { createAutoTradeService } from "./services/autoTrade/runtime";
import { AiExplainer } from "./services/ai/explainer";
import { InMemoryTradingStore } from "./services/trading/inMemoryTradingStore";
import { TradingModeService } from "./services/trading/tradingModeService";
import { createStore } from "./services/storage/createStore";
import { runQuoteKeepalivePass } from "./services/broker/ctrader/quoteService";

const defaultStore = createStore();
const defaultTradingService = new TradingModeService(new InMemoryTradingStore());
const defaultAutoTradeService = createAutoTradeService();

const app = createApiApp({
  store: defaultStore,
  aiExplainer: new AiExplainer(),
  tradingService: defaultTradingService,
  autoTradeService: defaultAutoTradeService
});

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
  if (!process.env.GOLDMETA_WEB_ORIGIN) {
    process.env.GOLDMETA_WEB_ORIGIN =
      process.env.WEB_ORIGIN ?? "https://goldmeta.metamechsolutions.com";
  }
  process.env.CTRADER_ENVIRONMENT = "DEMO";
}

export const api = onRequest(
  {
    region: env.FIREBASE_REGION,
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

export { apiCTraderPreview } from "./cTraderPreviewApi";

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
