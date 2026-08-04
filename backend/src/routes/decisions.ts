import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { approvedAccountGate } from "../middleware/accountAccess";
import { buildIntradayPlan } from "../services/decision/intradayPlan";
import { getOrEmptySessionPlan } from "../services/decision/sessionPlanLifecycle";
import { resolveMarketStructureView } from "../services/decision/strategySignal";
import type { GoldMetaStore } from "../services/storage/types";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildDecisionsRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/decisions/latest", requireAuth, ...approvedAccountGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    // Prefer non-test decisions so TradingView TEST fixture OHLC (~2408) cannot
    // become the LIVE dashboard "live price" next to a real ~4050 alert profile.
    const recent = await store.listDecisions(userId, 40);
    const view = resolveMarketStructureView(recent);
    const latest = view.quoteDecision ?? recent[0];
    if (!latest) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No decisions found" } });
      return;
    }
    const intradayPlan = buildIntradayPlan({
      quote: view.quoteDecision,
      structure: view.structureDecision,
      mode: view.marketStructureMode,
      quoteAgeSeconds: view.diagnostics.quoteAgeSeconds,
      signalAgeSeconds: view.diagnostics.signalAgeSeconds
    });
    const sessionPlan = await getOrEmptySessionPlan(store, userId);
    res.json({
      decision: latest,
      latestQuote: view.latestQuote,
      latestCompleteStrategySignal: view.latestCompleteStrategySignal,
      marketStructureMode: view.marketStructureMode,
      marketStructureDiagnostics: view.diagnostics,
      structureDecisionId: view.structureDecision?.decisionId ?? null,
      intradayPlan,
      sessionPlan,
      /** Stable plan fields for web consumers (Pine 3.0 lifecycle). */
      stablePlan: sessionPlan
        ? {
            planId: sessionPlan.planId,
            planSourceKey: sessionPlan.planSourceKey,
            lifecycleState: sessionPlan.lifecycleState,
            planMutation: sessionPlan.planMutation,
            planStabilityLabel: sessionPlan.planStabilityLabel,
            direction: sessionPlan.direction,
            entry: sessionPlan.entry,
            stopLoss: sessionPlan.stopLoss,
            takeProfits: sessionPlan.takeProfits,
            riskReward: sessionPlan.riskReward,
            confirmationState: sessionPlan.confirmationState,
            currentPrice: sessionPlan.currentPrice,
            distanceToEntryPoints: sessionPlan.distanceToEntryPoints,
            distanceToStopPoints: sessionPlan.distanceToStopPoints,
            distanceToTp1Points: sessionPlan.distanceToTp1Points,
            planQuality: sessionPlan.planQuality,
            quickTarget: sessionPlan.quickTarget,
            fourHourContext: sessionPlan.fourHourContext,
            quoteAgeSeconds: sessionPlan.quoteAgeSeconds,
            signalAgeSeconds: sessionPlan.signalAgeSeconds,
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
