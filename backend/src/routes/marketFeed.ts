import { Router } from "express";
import { approvedAccountGate } from "../middleware/accountAccess";
import { requireAdmin, requireAuth } from "../middleware/auth";
import {
  evaluateSharedFeedHealth,
  publicMarketFeedHealth
} from "../services/marketFeed/feedHealth";
import type { GoldMetaStore } from "../services/storage/types";

export const buildMarketFeedRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/market-feed/health", requireAuth, ...approvedAccountGate, async (_req, res) => {
    const health = await evaluateSharedFeedHealth(store);
    res.json({ marketFeedHealth: publicMarketFeedHealth(health) });
  });

  router.get("/v1/admin/market-feed/status", requireAuth, requireAdmin, async (_req, res) => {
    res.json({ marketFeed: await evaluateSharedFeedHealth(store) });
  });

  return router;
};
