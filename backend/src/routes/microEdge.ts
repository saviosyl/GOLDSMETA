/**
 * Micro Edge read-only API — SHADOW ONLY.
 * No order / live-enable / Demo execution / Core settings endpoints.
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

  router.get("/v1/micro-edge/status", ...gate, async (_req, res) => {
    const latest = await memoryStore.getLatestPrediction();
    const marketData = await buildMarketDataStatusPayload();
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
      overallMicroDecision: healthy ? latest?.overallMicroDecision ?? "WAIT" : "WAIT",
      dataUnavailable: !healthy,
      degradedReason: healthy ? null : "DATA UNAVAILABLE",
      dataCollectionActive: marketData.dataCollectionActive,
      modelStatus: "RESEARCH / NOT TRAINED ON LIVE DATA"
    });
  });

  router.get("/v1/micro-edge/market-data/diagnostics", ...gate, async (_req, res) => {
    const diagnostics = await buildMarketDataDiagnosticsPayload();
    res.json({
      ...diagnostics,
      shadowOnly: true,
      brokerExecutionEnabled: false,
      disclaimer: "Read-only diagnostics. No tokens. No trading endpoints."
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
      modelStatus: "UNTRAINED PLACEHOLDER — NOT FOR TRADING"
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
        status: "RESEARCH / NOT TRAINED ON LIVE DATA"
      },
      baselines: ["baseline-always-no-edge-v1", "baseline-mom5-sign-v1"],
      challenger: { kind: "TREE_GBM_CHALLENGER", promoted: false },
      sequencePlaceholder: { implemented: false },
      shadowOnly: true
    });
  });

  return router;
};
