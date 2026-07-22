import { Router } from "express";
import { requireAuth, getAuthenticatedUserId } from "../middleware/auth";
import { computeSignalPerformance } from "../services/signalOutcome/analytics";
import { getSignalOutcomeStore } from "../services/signalOutcome/monitor";
import { SignalOutcomeStorageUnavailableError } from "../services/signalOutcome/storagePolicy";

/**
 * Signal Outcome Tracking API — hypothetical performance only.
 * Does not place or amend any broker orders.
 */
export const buildSignalOutcomesRouter = (): Router => {
  const router = Router();

  const safeStorageError = (res: import("express").Response, error: unknown): boolean => {
    if (error instanceof SignalOutcomeStorageUnavailableError) {
      res.status(503).json({
        error: {
          code: "SIGNAL_OUTCOME_STORAGE_UNAVAILABLE",
          message: "Signal outcome storage unavailable"
        }
      });
      return true;
    }
    return false;
  };

  router.get("/v1/signal-outcomes", requireAuth, async (req, res) => {
    try {
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
    } catch (error: unknown) {
      if (safeStorageError(res, error)) return;
      throw error;
    }
  });

  router.get("/v1/signal-outcomes/performance", requireAuth, async (req, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const store = getSignalOutcomeStore();
      const items = await store.listAllPaginated(userId, 200);
      const aggregates = await store.listDailyAggregates(userId);
      const summary = computeSignalPerformance(items, {
        aggregates,
        historyComplete: true
      });
      res.json(summary);
    } catch (error: unknown) {
      if (safeStorageError(res, error)) return;
      throw error;
    }
  });

  router.get("/v1/signal-outcomes/by-decision/:decisionId", requireAuth, async (req, res) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const store = getSignalOutcomeStore();
      const item = await store.getByDecisionId(userId, String(req.params.decisionId));
      if (!item) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Signal outcome not found" } });
        return;
      }
      res.json({ item });
    } catch (error: unknown) {
      if (safeStorageError(res, error)) return;
      throw error;
    }
  });

  router.get("/v1/signal-outcomes/:signalId", requireAuth, async (req, res) => {
    try {
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
    } catch (error: unknown) {
      if (safeStorageError(res, error)) return;
      throw error;
    }
  });

  return router;
};
