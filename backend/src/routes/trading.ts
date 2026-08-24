import { Router } from "express";
import { z } from "zod";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { proposeOrderRequestSchema, tradingControlsPatchSchema } from "../models/trading";
import { listBrokerAdapters } from "../services/brokers/registry";
import type { TradingModeService } from "../services/trading/tradingModeService";

const brokerCredentialsSchema = z
  .object({
    brokerId: z.string().min(2),
    apiKey: z.string().min(4),
    apiSecret: z.string().min(4)
  })
  .strict();

const closeDemoSchema = z
  .object({
    orderId: z.string().min(4),
    realizedR: z.number()
  })
  .strict();

export const buildTradingRouter = (trading: TradingModeService): Router => {
  const router = Router();

  router.get("/v1/trading/controls", requireAuth, async (req, res) => {
    const controls = await trading.getControls(getAuthenticatedUserId(req));
    res.json({
      controls,
      policy: {
        noGuaranteedProfits: true,
        forbidMartingale: true,
        forbidGridRecovery: true,
        forbidAveragingDown: true,
        trading212XauusdCfdApiSupported: false
      }
    });
  });

  router.patch("/v1/trading/controls", requireAuth, async (req, res) => {
    const parsed = tradingControlsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_CONTROLS", message: "Invalid trading controls payload" } });
      return;
    }
    try {
      const controls = await trading.patchControls(getAuthenticatedUserId(req), parsed.data);
      res.json({ controls });
    } catch (error) {
      const code = (error as { code?: string }).code ?? "CONTROLS_ERROR";
      res.status(400).json({
        error: { code, message: error instanceof Error ? error.message : "Unable to update trading controls" }
      });
    }
  });

  router.post("/v1/trading/emergency-stop", requireAuth, async (req, res) => {
    const result = await trading.emergencyStop(getAuthenticatedUserId(req));
    res.json({
      ok: true,
      controls: result.controls,
      cancelResult: result.cancelResult,
      message: "Auto trading stopped. New orders are blocked; cancel was attempted on the active adapter."
    });
  });

  router.get("/v1/trading/brokers", requireAuth, (_req, res) => {
    res.json({
      brokers: listBrokerAdapters().map((adapter) => ({
        id: adapter.id,
        displayName: adapter.displayName,
        capabilities: adapter.capabilities()
      })),
      note: "Trading 212 is manual-only for XAUUSD until an official CFD API exists."
    });
  });

  router.post("/v1/trading/propose", requireAuth, async (req, res) => {
    const parsed = proposeOrderRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_PROPOSAL", message: "Invalid propose payload" } });
      return;
    }
    const result = await trading.proposeOrExecute(getAuthenticatedUserId(req), parsed.data);
    res.status(result.proposal.status === "EXECUTED" ? 200 : 202).json(result);
  });

  router.post("/v1/trading/confirm", requireAuth, async (req, res) => {
    const parsed = proposeOrderRequestSchema
      .extend({ confirmationToken: z.string().min(8) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "CONFIRMATION_REQUIRED",
          message: "Confirm mode requires an explicit confirmation token from Face ID or user confirmation."
        }
      });
      return;
    }
    const result = await trading.proposeOrExecute(getAuthenticatedUserId(req), parsed.data);
    res.json(result);
  });

  router.get("/v1/trading/demo/performance", requireAuth, async (req, res) => {
    res.json({ performance: await trading.getDemoPerformance(getAuthenticatedUserId(req)) });
  });

  router.get("/v1/trading/demo/orders", requireAuth, async (req, res) => {
    res.json({ orders: await trading.listDemoOrders(getAuthenticatedUserId(req)) });
  });

  router.post("/v1/trading/demo/close", requireAuth, async (req, res) => {
    const parsed = closeDemoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_CLOSE", message: "Invalid demo close payload" } });
      return;
    }
    try {
      const performance = await trading.closeDemoTrade(
        getAuthenticatedUserId(req),
        parsed.data.orderId,
        parsed.data.realizedR
      );
      res.json({ performance });
    } catch (error) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: error instanceof Error ? error.message : "Demo order not found" }
      });
    }
  });

  router.put("/v1/trading/brokers/:brokerId/credentials", requireAuth, async (req, res) => {
    const body = z
      .object({
        apiKey: z.string().min(4),
        apiSecret: z.string().min(4)
      })
      .safeParse(req.body);
    const parsed = brokerCredentialsSchema.safeParse({
      brokerId: req.params.brokerId,
      apiKey: body.success ? body.data.apiKey : undefined,
      apiSecret: body.success ? body.data.apiSecret : undefined
    });
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid broker credential payload" } });
      return;
    }
    try {
      const result = await trading.storeBrokerCredentials(
        getAuthenticatedUserId(req),
        parsed.data.brokerId,
        parsed.data.apiKey,
        parsed.data.apiSecret
      );
      // Never echo secrets back.
      res.json({
        stored: result.stored,
        brokerId: result.brokerId,
        message: "Credentials stored as encrypted backend secrets only."
      });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "SECRET_STORE_FAILED",
          message: error instanceof Error ? error.message : "Unable to store broker credentials"
        }
      });
    }
  });

  return router;
};
