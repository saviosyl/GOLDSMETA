import { Router } from "express";
import { requireAuth, getAuthenticatedUserId } from "../middleware/auth";
import { computeSignalPerformance } from "../services/signalOutcome/analytics";
import { getSignalOutcomeStore } from "../services/signalOutcome/monitor";

/**
 * Signal Outcome Tracking API — hypothetical performance only.
 * Does not place or amend any broker orders.
 */
export const buildSignalOutcomesRouter = (): Router => {
  const router = Router();

  router.get("/v1/signal-outcomes", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const store = getSignalOutcomeStore();
    const items = await store.list(userId, limit);
    res.json({
      items,
      label: "HYPOTHETICAL SIGNAL PERFORMANCE",
      disclaimer: "Past hypothetical results do not guarantee future trading performance.",
      brokerExecution: false
    });
  });

  router.get("/v1/signal-outcomes/performance", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const store = getSignalOutcomeStore();
    const items = await store.list(userId, 500);
    const summary = computeSignalPerformance(items);
    res.json(summary);
  });

  router.get("/v1/signal-outcomes/by-decision/:decisionId", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const store = getSignalOutcomeStore();
    const item = await store.getByDecisionId(userId, String(req.params.decisionId));
    if (!item) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Signal outcome not found" } });
      return;
    }
    res.json({ item });
  });

  router.get("/v1/signal-outcomes/:signalId", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const store = getSignalOutcomeStore();
    const item = await store.get(userId, String(req.params.signalId));
    if (!item) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Signal outcome not found" } });
      return;
    }
    res.json({
      item,
      label: "HYPOTHETICAL SIGNAL PERFORMANCE",
      disclaimer: "Past hypothetical results do not guarantee future trading performance."
    });
  });

  return router;
};
