/**
 * Micro Edge read-only API — SHADOW ONLY.
 * No order / live-enable / Demo execution / Core settings endpoints.
 * OAuth is Micro-isolated (scope=accounts only).
 */
import { Router } from "express";
import { requireAuth, getAuthenticatedUserId } from "../middleware/auth";
import { approvedAccountGate } from "../middleware/accountAccess";
import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_COST_MODEL_VERSION,
  MICRO_FEATURE_VERSION,
  MICRO_LABEL_VERSION,
  MICRO_MODEL_VERSION,
  MICRO_NAMESPACE,
  MICRO_PRIMARY_HORIZON,
  MICRO_SHADOW_ONLY
} from "../services/microEdge/config";
import { MemoryMicroEdgeStore } from "../services/microEdge/storage/firestoreMicroEdgeStore";
import { aggregatePerformance } from "../services/microEdge/outcomes/metrics";
import { logisticTrainingMeta } from "../services/microEdge/models/logisticModel";
import {
  buildMarketDataDiagnosticsPayload,
  buildMarketDataStatusPayload,
  getMicroMarketClient
} from "../services/microEdge/marketData/marketDataService";
import {
  completeMicroOAuthCallback,
  disconnectMicroOAuth,
  getMicroOAuthStatus,
  selectMicroOAuthAccount,
  startMicroOAuth
} from "../services/microEdge/marketData/oauthService";
import { fetchMicroAuthorizedAccounts } from "../services/microEdge/marketData/fetchAuthorizedAccounts";
import { computeLabelReadyDiagnostics } from "../services/microEdge/marketData/historicalTicks";
import { getMicroMarketDataStore } from "../services/microEdge/marketData/marketDataService";
import { getGoldHunterStore } from "../services/microEdge/goldHunter/goldHunterStore";
import { buildDailySummary, buildDayExplanations, dublinDateKey } from "../services/microEdge/goldHunter/dailyPnL";
import { GOLD_HUNTER_STRATEGY_VERSION } from "../services/microEdge/goldHunter/config";

function microFetchAuthorizedAccounts() {
  return async (a: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    environment: "DEMO" | "LIVE";
  }) =>
    fetchMicroAuthorizedAccounts({
      clientId: a.clientId,
      clientSecret: a.clientSecret,
      accessToken: a.accessToken,
      environment: a.environment,
      requireViewScope: true
    });
}

/** Process-local shadow store for predictions until workers wire Firestore. */
const memoryStore = new MemoryMicroEdgeStore();
const marketClient = getMicroMarketClient();

export function getMicroEdgeMemoryStoreForTests(): MemoryMicroEdgeStore {
  return memoryStore;
}

export function getMicroEdgeMarketClientForTests() {
  return marketClient;
}

export const buildMicroEdgeRouter = (): Router => {
  const router = Router();
  const gate = [requireAuth, ...approvedAccountGate];

  router.get("/v1/micro-edge/status", ...gate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    const latest = await memoryStore.getLatestPrediction();
    const oauth = await getMicroOAuthStatus(uid);
    const marketData = await buildMarketDataStatusPayload(Date.now(), {
      vaultOAuthConfigured: Boolean(oauth.oauth?.configured)
    });
    const healthy = Boolean(marketData.collectorHealthy);
    res.json({
      shadowOnly: MICRO_SHADOW_ONLY,
      brokerExecutionEnabled: MICRO_BROKER_EXECUTION_ENABLED,
      namespace: MICRO_NAMESPACE,
      modelVersion: MICRO_MODEL_VERSION,
      featureVersion: MICRO_FEATURE_VERSION,
      costModelVersion: MICRO_COST_MODEL_VERSION,
      labelVersion: MICRO_LABEL_VERSION,
      primaryResearchHorizon: MICRO_PRIMARY_HORIZON,
      lastPredictionId: latest?.predictionId ?? null,
      lastCandleCloseTs: latest?.candleCloseTs ?? null,
      disclaimer: "MICRO EDGE MARKET DATA V1 IS READ-ONLY. NO BROKER ORDER PATH EXISTS.",
      mutationSurface: "NONE",
      marketFeedConnected: marketData.liveConnected,
      marketFeedStatus: marketData.marketFeedStatus,
      interfaceReady: true,
      connectionState: marketData.connectionState,
      capabilityStates: marketData.capabilityStates,
      marketData,
      collector: marketData.collector,
      oauth: oauth.oauth,
      oauthAppConfigured: oauth.appConfigured,
      authorizationStatus: oauth.authorizationStatus,
      overallMicroDecision: healthy ? latest?.overallMicroDecision ?? "WAIT" : "WAIT",
      dataUnavailable: !healthy,
      degradedReason: healthy ? null : "DATA UNAVAILABLE",
      dataCollectionActive: marketData.dataCollectionActive,
      modelStatus: "DATA COLLECTION / NOT TRAINED ON REAL DATA",
      realConnectionStatus: oauth.realConnectionStatus,
      collectorHealthLabel: healthy ? "HEALTHY" : "OFFLINE"
    });
  });

  router.get("/v1/micro-edge/oauth/status", ...gate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    const status = await getMicroOAuthStatus(uid);
    res.json({
      ...status,
      disclaimer:
        "READ-ONLY CONNECTION. Micro Edge cannot place trades. Market/account-data access only.",
      accessToken: undefined,
      refreshToken: undefined,
      clientSecret: undefined
    });
  });

  router.post("/v1/micro-edge/oauth/start", ...gate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    try {
      const started = await startMicroOAuth(uid);
      res.json({
        ...started,
        disclaimer:
          "Permission requested: VIEW-ONLY ACCOUNT ACCESS. Trading permission: NOT REQUESTED. Broker orders: IMPOSSIBLE FROM MICRO EDGE."
      });
    } catch (e) {
      res.status(400).json({
        ok: false,
        code: (e as { code?: string }).code ?? "oauth_start_failed",
        message: (e as Error).message,
        missing: (e as { missing?: string[] }).missing
      });
    }
  });

  /**
   * OAuth callback — frontend lands on /micro-edge/connect/callback then POSTs here
   * with { code, sessionId }. Authorization code is single-use.
   */
  router.post("/v1/micro-edge/oauth/callback", ...gate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    const body = (req.body ?? {}) as {
      code?: unknown;
      sessionId?: unknown;
      accountId?: unknown;
    };
    const code = String(body.code ?? "").trim();
    const sessionId = String(body.sessionId ?? "").trim();
    const explicitAccountId =
      body.accountId != null ? String(body.accountId).trim() : null;
    if (!code || !sessionId) {
      res.status(400).json({
        ok: false,
        code: "oauth_missing",
        message: "code and sessionId are required"
      });
      return;
    }
    const result = await completeMicroOAuthCallback({
      uid,
      code,
      sessionId,
      explicitAccountId,
      deps: {
        fetchAuthorizedAccounts: microFetchAuthorizedAccounts()
      }
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ...result,
      disclaimer: "READ-ONLY CONNECTION established locally. No broker orders possible.",
      accessToken: undefined,
      refreshToken: undefined
    });
  });

  /** Public browser redirect target helper — exchanges via authenticated POST preferred. */
  router.get("/v1/micro-edge/oauth/callback", ...gate, async (req, res) => {
    // Prefer SPA route; this exists for redirect_uri registration flexibility.
    const code = String(req.query.code ?? "").trim();
    const sessionId = String(req.query.session_id ?? req.query.sessionId ?? "").trim();
    res.json({
      ok: Boolean(code),
      codePresent: Boolean(code),
      sessionIdPresent: Boolean(sessionId),
      next: "POST /v1/micro-edge/oauth/callback with { code, sessionId } from authenticated SPA",
      disclaimer: "Do not paste tokens. Complete via Micro Edge UI."
    });
  });

  router.post("/v1/micro-edge/oauth/select-account", ...gate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    const body = (req.body ?? {}) as { accountId?: unknown };
    const accountId = String(body.accountId ?? "").trim();
    if (!accountId) {
      res.status(400).json({ ok: false, code: "account_missing" });
      return;
    }
    // Always revalidate against live cTrader account-list (authoritative isLive).
    const result = await selectMicroOAuthAccount({
      uid,
      accountId,
      deps: { fetchAuthorizedAccounts: microFetchAuthorizedAccounts() }
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  router.post("/v1/micro-edge/oauth/disconnect", ...gate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    const result = await disconnectMicroOAuth(uid);
    res.json({
      ...result,
      disclaimer: "Micro local token cleared. Core cTrader connection unaffected."
    });
  });

  router.get("/v1/micro-edge/market-data/diagnostics", ...gate, async (_req, res) => {
    const diagnostics = await buildMarketDataDiagnosticsPayload();
    const store = getMicroMarketDataStore();
    const boundaries = await store.listBoundaryQuotes(50_000);
    const labelReady = computeLabelReadyDiagnostics(boundaries);
    res.json({
      ...diagnostics,
      labelReady,
      boundaryQuoteCount: await store.countBoundaryQuotes(),
      shadowOnly: true,
      brokerExecutionEnabled: false,
      disclaimer: "Read-only diagnostics. No tokens. No trading endpoints.",
      accessToken: undefined,
      refreshToken: undefined,
      clientSecret: undefined
    });
  });

  router.get("/v1/micro-edge/latest", ...gate, async (_req, res) => {
    const latest = await memoryStore.getLatestPrediction();
    const marketData = await buildMarketDataStatusPayload();
    res.json({
      prediction: latest,
      shadowOnly: true,
      brokerExecutionEnabled: false,
      marketFeedConnected: marketData.liveConnected,
      marketFeedStatus: marketData.marketFeedStatus,
      connectionState: marketData.connectionState,
      modelStatus: "DATA COLLECTION / NOT TRAINED ON REAL DATA"
    });
  });

  router.get("/v1/micro-edge/history", ...gate, async (req, res) => {
    void getAuthenticatedUserId(req);
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const items = await memoryStore.listPredictions(limit);
    const outcomes = await memoryStore.listOutcomes(limit * 3);
    const marketData = await buildMarketDataStatusPayload();
    res.json({
      items,
      outcomes,
      shadowOnly: true,
      disclaimer: "Shadow signal history only — no broker orders.",
      marketFeedStatus: marketData.marketFeedStatus
    });
  });

  router.get("/v1/micro-edge/performance", ...gate, async (_req, res) => {
    const preds = await memoryStore.listPredictions(500);
    const outs = await memoryStore.listOutcomes(2000);
    const summary = aggregatePerformance("all", preds, outs);
    res.json({
      summary,
      shadowOnly: true,
      disclaimer:
        "Hypothetical NET results after cost proxies. Not executable Pepperstone performance. Model not trained on live Micro data."
    });
  });

  router.get("/v1/micro-edge/models", ...gate, async (_req, res) => {
    res.json({
      champion: {
        ...logisticTrainingMeta,
        status: "DATA COLLECTION / NOT TRAINED ON REAL DATA"
      },
      baselines: ["baseline-always-no-edge-v1", "baseline-mom5-sign-v1"],
      challenger: { kind: "TREE_GBM_CHALLENGER", promoted: false },
      sequencePlaceholder: { implemented: false },
      shadowOnly: true
    });
  });

  // ---------- GOLD_HUNTER (SHADOW ONLY — no broker orders) ----------
  router.get("/v1/micro-edge/gold-hunter/status", ...gate, async (_req, res) => {
    const store = getGoldHunterStore();
    const status = store.getStatus();
    const marketData = await buildMarketDataStatusPayload();
    res.json({
      ...status,
      brand: "GOLD_HUNTER",
      subtitle: "Continuous XAUUSD Opportunity Engine",
      poweredBy: "Micro Edge Research",
      banner: "SHADOW — NO BROKER ORDERS",
      pepperstoneDemoBalance: status.accountBalance,
      shadowPnlSeparateFromBrokerBalance: true,
      marketData: {
        symbol: marketData.symbol,
        liveConnected: marketData.liveConnected,
        marketFeedStatus: marketData.marketFeedStatus,
        quoteAgeMs: marketData.quoteAgeMs
      },
      disclaimer:
        "GOLD_HUNTER SHADOW P/L is hypothetical research. It does not change Pepperstone DEMO balance."
    });
  });

  router.get("/v1/micro-edge/gold-hunter/forecast", ...gate, async (_req, res) => {
    const store = getGoldHunterStore();
    res.json({
      forecast: store.getForecast(),
      shadowOnly: true,
      brokerExecutionEnabled: false,
      mutationSurface: "NONE"
    });
  });

  router.get("/v1/micro-edge/gold-hunter/trades", ...gate, async (req, res) => {
    const store = getGoldHunterStore();
    const date =
      typeof req.query.date === "string" && req.query.date
        ? req.query.date
        : dublinDateKey(Date.now());
    const strategyVersion =
      typeof req.query.strategyVersion === "string" && req.query.strategyVersion
        ? req.query.strategyVersion
        : GOLD_HUNTER_STRATEGY_VERSION;
    const trades = store.listTrades({ date, strategyVersion, limit: 500 });
    res.json({
      date,
      strategyVersion,
      trades,
      shadowOnly: true,
      disclaimer: "Hypothetical SHADOW trades only — no broker orders."
    });
  });

  router.get("/v1/micro-edge/gold-hunter/daily", ...gate, async (req, res) => {
    const store = getGoldHunterStore();
    const date =
      typeof req.query.date === "string" && req.query.date
        ? req.query.date
        : dublinDateKey(Date.now());
    const strategyVersion =
      typeof req.query.strategyVersion === "string" && req.query.strategyVersion
        ? req.query.strategyVersion
        : GOLD_HUNTER_STRATEGY_VERSION;
    let summary = store.getDaily(date, strategyVersion);
    if (!summary) {
      const trades = store.listTrades({ date, strategyVersion });
      summary = buildDailySummary(trades, { date, strategyVersion });
      store.upsertDaily(summary);
    }
    const explanations = buildDayExplanations(summary);
    const dates = store.listDailyDates(strategyVersion);
    res.json({
      summary,
      explanations,
      availableDates: dates,
      equityCurve: store
        .listTrades({ strategyVersion, limit: 2000 })
        .filter((t) => t.date === date)
        .sort((a, b) => a.entryTimestampMs - b.entryTimestampMs)
        .reduce<Array<{ t: number; equity: number }>>((acc, t) => {
          const prev = acc.length ? acc[acc.length - 1]!.equity : 0;
          acc.push({ t: t.exitTimestampMs, equity: prev + t.netMove });
          return acc;
        }, []),
      shadowOnly: true,
      disclaimer:
        "SHADOW equity curve is research P/L in price units — not broker account balance."
    });
  });

  router.get("/v1/micro-edge/gold-hunter/model", ...gate, async (_req, res) => {
    const store = getGoldHunterStore();
    const artifact = store.getArtifact();
    const dq = store.getDataQuality();
    res.json({
      artifact,
      dataQuality: dq,
      qualificationStatus: artifact?.qualificationStatus ?? "NOT_TRAINED",
      neverQualifiedForLive: true,
      shadowOnly: true,
      brokerExecutionEnabled: false,
      mutationSurface: "NONE"
    });
  });

  return router;
};
