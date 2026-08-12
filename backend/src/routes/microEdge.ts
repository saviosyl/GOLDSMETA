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
import { MicroCTraderReadOnlyClient } from "../services/microEdge/marketData/microCTraderClient";
import { getCollectorStatus } from "../services/microEdge/runtime/collector";

/** Process-local shadow store for V1 API until Firestore wiring is live in workers. */
const memoryStore = new MemoryMicroEdgeStore();

/** Scaffold client — LIVE_NOT_CONNECTED until genuine OpenAPI reads are wired. */
const marketClient = new MicroCTraderReadOnlyClient();

export function getMicroEdgeMemoryStoreForTests(): MemoryMicroEdgeStore {
  return memoryStore;
}

export function getMicroEdgeMarketClientForTests(): MicroCTraderReadOnlyClient {
  return marketClient;
}

export const buildMicroEdgeRouter = (): Router => {
  const router = Router();
  const gate = [requireAuth, ...approvedAccountGate];

  router.get("/v1/micro-edge/status", ...gate, async (_req, res) => {
    const latest = await memoryStore.getLatestPrediction();
    const collector = getCollectorStatus(marketClient, {
      lastQuoteTs: latest?.quoteTs ?? null,
      lastM1CloseTs: latest?.candleCloseTs ?? null,
      quote: null,
      lastM1: null,
      nowMs: Date.now()
    });
    const feedConnected = marketClient.isLiveMarketFeedConnected();
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
      disclaimer: "MICRO EDGE V1 HAS NO BROKER ORDER PATH",
      mutationSurface: "NONE",
      marketFeedConnected: feedConnected,
      marketFeedStatus: marketClient.marketFeedStatusMessage(),
      interfaceReady: marketClient.isInterfaceReady(),
      connectionState: marketClient.connectionState(),
      capabilityStates: marketClient.capabilityStates(),
      collector,
      overallMicroDecision: collector.healthy
        ? latest?.overallMicroDecision ?? "WAIT"
        : "WAIT",
      dataUnavailable: collector.dataUnavailable,
      degradedReason: collector.healthy ? null : "DATA UNAVAILABLE"
    });
  });

  router.get("/v1/micro-edge/latest", ...gate, async (_req, res) => {
    const latest = await memoryStore.getLatestPrediction();
    const feedConnected = marketClient.isLiveMarketFeedConnected();
    res.json({
      prediction: latest,
      shadowOnly: true,
      brokerExecutionEnabled: false,
      marketFeedConnected: feedConnected,
      marketFeedStatus: marketClient.marketFeedStatusMessage(),
      connectionState: marketClient.connectionState()
    });
  });

  router.get("/v1/micro-edge/history", ...gate, async (req, res) => {
    void getAuthenticatedUserId(req);
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const items = await memoryStore.listPredictions(limit);
    const outcomes = await memoryStore.listOutcomes(limit * 3);
    res.json({
      items,
      outcomes,
      shadowOnly: true,
      disclaimer: "Shadow signal history only — no broker orders.",
      marketFeedStatus: marketClient.marketFeedStatusMessage()
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
        "Hypothetical NET results after cost proxies. Not executable Pepperstone performance."
    });
  });

  router.get("/v1/micro-edge/models", ...gate, async (_req, res) => {
    res.json({
      champion: logisticTrainingMeta,
      baselines: ["baseline-always-no-edge-v1", "baseline-mom5-sign-v1"],
      challenger: { kind: "TREE_GBM_CHALLENGER", promoted: false },
      sequencePlaceholder: { implemented: false },
      shadowOnly: true
    });
  });

  return router;
};
