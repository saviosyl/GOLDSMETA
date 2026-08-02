import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { approvedAccountGate } from "../middleware/accountAccess";
import type { GoldMetaStore } from "../services/storage/types";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildDecisionsRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/decisions/latest", requireAuth, ...approvedAccountGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    // Prefer non-test decisions so TradingView TEST fixture OHLC (~2408) cannot
    // become the LIVE dashboard "live price" next to a real ~4050 alert profile.
    const recent = await store.listDecisions(userId, 30);
    const latest =
      recent.find((d) => !d.isTestDecision && d.environment !== "TEST") ?? recent[0];
    if (!latest) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No decisions found" } });
      return;
    }
    res.json({ decision: latest });
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
