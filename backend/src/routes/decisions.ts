import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import type { DecisionRecord } from "../models/types";
import type { InMemoryStore } from "../services/storage/inMemoryStore";

const belongsToUser = (userId: string) => (decision: DecisionRecord): boolean =>
  decision.userId === userId;

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildDecisionsRouter = (store: InMemoryStore): Router => {
  const router = Router();

  router.get("/v1/decisions/latest", requireAuth, (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const latest = store.listDecisions().find(belongsToUser(userId));
    if (!latest) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No decisions found" } });
      return;
    }
    res.json({ decision: latest });
  });

  router.get("/v1/decisions", requireAuth, (req, res) => {
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
    const userId = getAuthenticatedUserId(req);
    res.json({
      decisions: store.listDecisions(limit).filter(belongsToUser(userId))
    });
  });

  router.get("/v1/decisions/:decisionId", requireAuth, (req, res) => {
    const decisionId = firstParam(req.params.decisionId);
    const userId = getAuthenticatedUserId(req);
    const decision = decisionId ? store.getDecision(decisionId) : undefined;
    if (!decision || decision.userId !== userId) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Decision not found" } });
      return;
    }
    res.json({ decision });
  });

  return router;
};
