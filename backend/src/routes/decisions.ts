import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { approvedAccountGate } from "../middleware/accountAccess";
import { buildIntradayPlan } from "../services/decision/intradayPlan";
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
    res.json({
      decision: latest,
      latestQuote: view.latestQuote,
      latestCompleteStrategySignal: view.latestCompleteStrategySignal,
      marketStructureMode: view.marketStructureMode,
      marketStructureDiagnostics: view.diagnostics,
      structureDecisionId: view.structureDecision?.decisionId ?? null,
      intradayPlan
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
