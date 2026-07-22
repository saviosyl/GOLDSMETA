import { Router } from "express";
import { z } from "zod";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import type { AutoTradeService } from "../services/autoTrade/autoTradeService";
import { FIRST_PILOT_LIMITS } from "../services/autoTrade/types";

const modeSchema = z.enum(["OFF", "SHADOW", "IG_DEMO_AUTO", "IG_LIVE_AUTO"]);

const setModeSchema = z
  .object({
    mode: modeSchema,
    liveConfirmationPhrase: z.string().optional(),
    riskAcknowledged: z.boolean().optional(),
    accountVerified: z.boolean().optional()
  })
  .strict();

const limitsSchema = z
  .object({
    maxLossPerTrade: z.number().positive().max(1000).optional(),
    maxMarginPerPosition: z.number().positive().max(100_000).optional(),
    maxDailyLoss: z.number().positive().max(10_000).optional(),
    maxWeeklyLoss: z.number().positive().max(50_000).optional(),
    maxOpenPositions: z.number().int().min(1).max(5).optional(),
    maxTradesPerDay: z.number().int().min(1).max(20).optional(),
    maxConsecutiveLosses: z.number().int().min(1).max(20).optional(),
    cooldownAfterLossMinutes: z.number().int().min(0).max(24 * 60).optional(),
    minGoldMetaScore: z.number().min(0).max(100).optional(),
    minRiskReward: z.number().positive().max(20).optional(),
    maxSpread: z.number().positive().nullable().optional(),
    stopProtection: z
      .enum(["GUARANTEED_REQUIRED", "GUARANTEED_PREFERRED", "NORMAL_ALLOWED"])
      .optional(),
    allowedSessions: z
      .array(z.enum(["LONDON", "NEW_YORK", "LONDON_NY_OVERLAP", "CUSTOM"]))
      .optional()
  })
  .strict();

const connectSchema = z
  .object({
    environment: z.enum(["DEMO", "LIVE"]),
    credentialsRef: z.string().min(2).max(128).optional()
  })
  .strict();

const evaluateSchema = z
  .object({
    decisionId: z.string().min(4),
    decision: z.string().min(2),
    score: z.number().nullable(),
    entry: z.number().nullable(),
    stop: z.number().nullable(),
    takeProfit: z.number().nullable(),
    riskReward: z.number().nullable(),
    decisionAgeMs: z.number().nonnegative(),
    session: z.enum(["LONDON", "NEW_YORK", "LONDON_NY_OVERLAP", "CUSTOM", "OTHER"]),
    newsBlackoutActive: z.boolean().optional()
  })
  .strict();

export const buildAutoTradeRouter = (service: AutoTradeService): Router => {
  const router = Router();

  router.get("/v1/autotrade/status", requireAuth, async (req, res) => {
    const status = await service.getStatus(getAuthenticatedUserId(req));
    res.json({ status, defaults: FIRST_PILOT_LIMITS });
  });

  router.patch("/v1/autotrade/limits", requireAuth, async (req, res) => {
    const parsed = limitsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_LIMITS", message: "Invalid risk limits" } });
      return;
    }
    const status = await service.updateLimits(getAuthenticatedUserId(req), parsed.data);
    res.json({ status });
  });

  router.post("/v1/autotrade/mode", requireAuth, async (req, res) => {
    const parsed = setModeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_MODE", message: "Invalid mode payload" } });
      return;
    }
    try {
      const status = await service.setMode(getAuthenticatedUserId(req), parsed.data.mode, {
        liveConfirmationPhrase: parsed.data.liveConfirmationPhrase,
        riskAcknowledged: parsed.data.riskAcknowledged,
        accountVerified: parsed.data.accountVerified
      });
      res.json({ status });
    } catch (error) {
      const code = (error as { code?: string }).code ?? "MODE_ERROR";
      res.status(400).json({
        error: {
          code,
          message: error instanceof Error ? error.message : "Unable to set mode"
        }
      });
    }
  });

  router.post("/v1/autotrade/connect", requireAuth, async (req, res) => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_CONNECT", message: "Invalid connect payload" } });
      return;
    }
    try {
      const status = await service.connectBroker(
        getAuthenticatedUserId(req),
        parsed.data.environment,
        parsed.data.credentialsRef
      );
      res.json({ status });
    } catch (error) {
      res.status(400).json({
        error: {
          code: "CONNECT_FAILED",
          message: error instanceof Error ? error.message : "Connect failed"
        }
      });
    }
  });

  router.post("/v1/autotrade/emergency-stop", requireAuth, async (req, res) => {
    const status = await service.emergencyStop(getAuthenticatedUserId(req));
    res.json({
      ok: true,
      status,
      message: "Emergency STOP engaged. AutoTrade is OFF and locked."
    });
  });

  router.post("/v1/autotrade/unlock", requireAuth, async (req, res) => {
    const status = await service.unlock(getAuthenticatedUserId(req));
    res.json({ status });
  });

  /** Internal/dev evaluate endpoint — uses fake adapter in tests; never called from browser for APPROVED. */
  router.post("/v1/autotrade/evaluate", requireAuth, async (req, res) => {
    const parsed = evaluateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_SIGNAL", message: "Invalid evaluate payload" } });
      return;
    }
    const result = await service.evaluateAndMaybeExecute(getAuthenticatedUserId(req), parsed.data);
    res.json(result);
  });

  return router;
};
