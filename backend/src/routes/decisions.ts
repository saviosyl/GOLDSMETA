import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { approvedAccountGate } from "../middleware/accountAccess";
import { buildIntradayPlan } from "../services/decision/intradayPlan";
import {
  getOrEmptySessionPlan,
  sanitizeSessionPlanForApi
} from "../services/decision/sessionPlanLifecycle";
import { resolveMarketStructureView } from "../services/decision/strategySignal";
import { evaluateSharedFeedHealth, publicMarketFeedHealth } from "../services/marketFeed/feedHealth";
import { resolveSharedFeedUserId } from "../services/marketFeed/sharedFeed";
import type { GoldMetaStore } from "../services/storage/types";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildDecisionsRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/decisions/latest", requireAuth, ...approvedAccountGate, async (req, res) => {
    const requestUserId = getAuthenticatedUserId(req);
    const sharedFeedUserId = resolveSharedFeedUserId();
    const marketFeedHealth = publicMarketFeedHealth(await evaluateSharedFeedHealth(store));
    // Shared authoritative feed first; fall back to the caller's own store only when
    // the shared feed has never received decisions (release-safe cutover).
    let feedUserId = sharedFeedUserId;
    let recent = await store.listDecisions(feedUserId, 40);
    if (recent.length === 0 && requestUserId !== sharedFeedUserId) {
      recent = await store.listDecisions(requestUserId, 40);
      if (recent.length > 0) {
        feedUserId = requestUserId;
      }
    }
    // Prefer non-test decisions so TradingView TEST fixture OHLC (~2408) cannot
    // become the LIVE dashboard "live price" next to a real ~4050 alert profile.
    const view = resolveMarketStructureView(recent);
    const latest = view.quoteDecision ?? recent[0];
    if (!latest) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "No shared feed decisions found" },
        marketFeedHealth
      });
      return;
    }
    const intradayPlan = buildIntradayPlan({
      quote: view.quoteDecision,
      structure: view.structureDecision,
      mode: view.marketStructureMode,
      quoteAgeSeconds: view.diagnostics.quoteAgeSeconds,
      signalAgeSeconds: view.diagnostics.signalAgeSeconds
    });
    const rawSessionPlan = await getOrEmptySessionPlan(store, feedUserId);
    // Central geometry gate — never return actionable levels that fail safety validation.
    const sessionPlan = sanitizeSessionPlanForApi(rawSessionPlan);
    const actionable =
      sessionPlan?.geometryValid === true &&
      sessionPlan.lifecycleState !== "NO_VALID_PLAN" &&
      sessionPlan.lifecycleState !== "NO_TRADE" &&
      sessionPlan.planQuality?.grade !== "NO_PLAN" &&
      sessionPlan.planQuality?.grade !== "C";
    res.json({
      decision: latest,
      latestQuote: view.latestQuote,
      latestCompleteStrategySignal: view.latestCompleteStrategySignal,
      marketStructureMode: view.marketStructureMode,
      marketStructureDiagnostics: view.diagnostics,
      structureDecisionId: view.structureDecision?.decisionId ?? null,
      intradayPlan,
      sessionPlan,
      marketFeedHealth,
      /** Stable plan fields for web consumers (Pine 3.0 lifecycle). */
      stablePlan: sessionPlan
        ? {
            planId: sessionPlan.planId,
            planSourceKey: sessionPlan.planSourceKey,
            lifecycleState: sessionPlan.lifecycleState,
            planMutation: sessionPlan.planMutation,
            planStabilityLabel: sessionPlan.planStabilityLabel,
            direction: actionable ? sessionPlan.direction : null,
            entry: actionable ? sessionPlan.entry : null,
            stopLoss: actionable ? sessionPlan.stopLoss : null,
            takeProfits: actionable ? sessionPlan.takeProfits : [],
            riskReward: actionable
              ? sessionPlan.riskReward
              : { tp1: null, tp2: null, tp3: null },
            confirmationState: sessionPlan.confirmationState,
            currentPrice: sessionPlan.currentPrice,
            distanceToEntryPoints: actionable ? sessionPlan.distanceToEntryPoints : null,
            distanceToStopPoints: actionable ? sessionPlan.distanceToStopPoints : null,
            distanceToTp1Points: actionable ? sessionPlan.distanceToTp1Points : null,
            planQuality: sessionPlan.planQuality,
            quickTarget: actionable
              ? sessionPlan.quickTarget
              : {
                  enabled: true,
                  tp1: null,
                  tp1Label: null,
                  tp1Reason: null,
                  roomPoints: null,
                  roomOk: false,
                  riskReward: null,
                  rrOk: false,
                  structuralLevelUsed: null
                },
            fourHourContext: sessionPlan.fourHourContext,
            quoteAgeSeconds: sessionPlan.quoteAgeSeconds,
            signalAgeSeconds: sessionPlan.signalAgeSeconds,
            geometryValid: sessionPlan.geometryValid ?? actionable,
            geometryReasonCodes: sessionPlan.geometryReasonCodes ?? [],
            geometryMessage: sessionPlan.geometryMessage ?? null,
            safety: sessionPlan.safety
          }
        : null
    });
  });

  router.get("/v1/decisions", requireAuth, ...approvedAccountGate, async (req, res) => {
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
    const userId = getAuthenticatedUserId(req);
    res.json({
      decisions: await store.listDecisions(userId, limit)
    });
  });

  router.get("/v1/decisions/:decisionId", requireAuth, ...approvedAccountGate, async (req, res) => {
    const decisionId = firstParam(req.params.decisionId);
    const userId = getAuthenticatedUserId(req);
    const decision = decisionId ? await store.getDecision(userId, decisionId) : undefined;
    if (!decision || decision.userId !== userId) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Decision not found" } });
      return;
    }
    res.json({ decision });
  });

  return router;
};
