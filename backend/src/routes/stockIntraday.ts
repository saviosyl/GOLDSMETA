import { Router } from "express";
import { z } from "zod";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import type { StockIntradayService } from "../services/stockIntraday/stockIntradayService";
import { DEFAULT_STOCK_INTRADAY_LIMITS } from "../services/stockIntraday/featureFlags";

const modeSchema = z.enum(["OFF", "SHADOW", "T212_PAPER_AUTO", "T212_LIVE_AUTO"]);

const limitsSchema = z
  .object({
    dailyCapitalAllocation: z.number().positive().max(1_000_000).optional(),
    maxCapitalPerTrade: z.number().positive().max(1_000_000).optional(),
    maxSimultaneousPositions: z.number().int().min(1).max(20).optional(),
    minConfidence: z.number().min(1).max(100).optional(),
    minCashReserve: z.number().min(0).max(10_000_000).optional(),
    maxDailyLoss: z.number().positive().max(1_000_000).optional(),
    maxLossPerTrade: z.number().positive().max(1_000_000).optional(),
    maxTradesPerDay: z.number().int().min(1).max(100).optional(),
    maxLosingTradesPerDay: z.number().int().min(1).max(100).optional(),
    maxPortfolioExposure: z.number().positive().max(10_000_000).optional(),
    maxExposurePerSymbol: z.number().positive().max(10_000_000).optional(),
    maxSectorConcentration: z.number().positive().max(10_000_000).optional(),
    minLiquidityAdv: z.number().positive().optional(),
    maxSpreadBps: z.number().positive().max(500).optional(),
    maxVolatilityPct: z.number().positive().max(50).optional(),
    maxSlippageBps: z.number().positive().max(500).optional(),
    perSymbolCooldownMinutes: z.number().int().min(0).max(24 * 60).optional(),
    cooldownAfterLossMinutes: z.number().int().min(0).max(24 * 60).optional(),
    minRewardRisk: z.number().positive().max(20).optional(),
    maxPositionDurationMinutes: z.number().int().min(1).max(24 * 60).optional(),
    entryCutoffBeforeCloseMinutes: z.number().int().min(0).max(240).optional(),
    forceCloseBeforeCloseMinutes: z.number().int().min(0).max(240).optional(),
    extendedHoursEnabled: z.boolean().optional()
  })
  .strict();

export const buildStockIntradayRouter = (service: StockIntradayService): Router => {
  const router = Router();

  router.get("/v1/stock-intraday/status", requireAuth, async (req, res) => {
    const status = await service.getStatus(getAuthenticatedUserId(req));
    res.json({ status, defaults: DEFAULT_STOCK_INTRADAY_LIMITS });
  });

  router.patch("/v1/stock-intraday/limits", requireAuth, async (req, res) => {
    const parsed = limitsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_LIMITS", message: "Invalid limits" } });
      return;
    }
    try {
      const status = await service.updateLimits(getAuthenticatedUserId(req), parsed.data);
      res.json({ status });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "LIMITS_ERROR",
          message: error instanceof Error ? error.message : "Unable to update limits"
        }
      });
    }
  });

  router.post("/v1/stock-intraday/mode", requireAuth, async (req, res) => {
    const parsed = z.object({ mode: modeSchema }).strict().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_MODE", message: "Invalid mode" } });
      return;
    }
    try {
      const status = await service.setMode(getAuthenticatedUserId(req), parsed.data.mode);
      res.json({ status });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "MODE_ERROR",
          message: error instanceof Error ? error.message : "Unable to set mode"
        }
      });
    }
  });

  router.post("/v1/stock-intraday/connect/paper", requireAuth, async (req, res) => {
    try {
      const status = await service.connectPaper(getAuthenticatedUserId(req));
      res.json({ status });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "CONNECT_FAILED",
          message: error instanceof Error ? error.message : "Connect failed"
        }
      });
    }
  });

  router.post("/v1/stock-intraday/disconnect", requireAuth, async (req, res) => {
    const status = await service.disconnect(getAuthenticatedUserId(req));
    res.json({ status });
  });

  router.post("/v1/stock-intraday/emergency-stop", requireAuth, async (req, res) => {
    const status = await service.emergencyStop(getAuthenticatedUserId(req));
    res.json({ ok: true, status, message: "Kill switch engaged." });
  });

  router.post("/v1/stock-intraday/unlock", requireAuth, async (req, res) => {
    const status = await service.unlock(getAuthenticatedUserId(req));
    res.json({ status });
  });

  router.post("/v1/stock-intraday/reconcile", requireAuth, async (req, res) => {
    const status = await service.reconcileOnStartup(getAuthenticatedUserId(req));
    res.json({ status });
  });

  router.post("/v1/stock-intraday/shadow/scan", requireAuth, async (req, res) => {
    const symbols = z
      .object({ symbols: z.array(z.string().min(1)).min(1).max(40) })
      .safeParse(req.body);
    if (!symbols.success) {
      res.status(400).json({ error: { code: "INVALID_SCAN", message: "symbols required" } });
      return;
    }
    const status = await service.runShadowScan(
      getAuthenticatedUserId(req),
      symbols.data.symbols
    );
    res.json({ status });
  });

  /**
   * Authenticated stock-signal ingress (TradingView → GoldMeta).
   * Fast ACK; full analysis is asynchronous. Never calls broker adapters here.
   */
  router.post("/v1/stock-intraday/signals/tradingview", requireAuth, async (req, res) => {
    const ack = await service.acknowledgeStockSignal(getAuthenticatedUserId(req), req.body);
    if (!ack.accepted) {
      res.status(400).json({ error: { code: ack.code, message: ack.code } });
      return;
    }
    res.status(202).json({
      accepted: true,
      code: ack.code,
      signalId: ack.signalId,
      message: "Signal queued for asynchronous processing"
    });
  });

  return router;
};
