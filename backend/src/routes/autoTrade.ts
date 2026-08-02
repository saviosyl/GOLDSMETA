import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { getAuthenticatedUserId, requireAuth, requireAdmin } from "../middleware/auth";
import { approvedAccountGate, brokerGate } from "../middleware/accountAccess";
import type { AutoTradeService } from "../services/autoTrade/autoTradeService";
import { FIRST_PILOT_LIMITS } from "../services/autoTrade/types";
import type { GoldMetaStore } from "../services/storage/types";

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
      .optional(),
    confirmIncrease: z.boolean().optional()
  })
  .strict();

const connectSchema = z
  .object({
    environment: z.enum(["DEMO", "LIVE"]),
    credentialsRef: z.string().min(2).max(128).optional()
  })
  .strict();

const internalEvaluateSchema = z
  .object({
    decisionId: z.string().min(4)
  })
  .strict();

function internalEvaluateAllowed(): boolean {
  return (
    env.APP_ENV === "test" ||
    process.env.ALLOW_AUTOTRADE_INTERNAL_EVALUATE === "true" ||
    process.env.FUNCTIONS_EMULATOR === "true"
  );
}

export const buildAutoTradeRouter = (
  service: AutoTradeService,
  goldMetaStore: GoldMetaStore
): Router => {
  const router = Router();

  router.get("/v1/autotrade/status", requireAuth, ...approvedAccountGate, async (req, res) => {
    const status = await service.getStatus(getAuthenticatedUserId(req));
    res.json({ status, defaults: FIRST_PILOT_LIMITS });
  });

  router.patch("/v1/autotrade/limits", requireAuth, ...brokerGate, async (req, res) => {
    const parsed = limitsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_LIMITS", message: "Invalid risk limits" } });
      return;
    }
    const { confirmIncrease, ...patch } = parsed.data;
    try {
      const status = await service.updateLimits(getAuthenticatedUserId(req), patch, {
        confirmIncrease,
        actorUserId: getAuthenticatedUserId(req)
      });
      res.json({ status });
    } catch (error) {
      const code = (error as { code?: string }).code ?? "LIMITS_ERROR";
      res.status(400).json({
        error: {
          code,
          message: error instanceof Error ? error.message : "Unable to update limits",
          increases: (error as { increases?: unknown }).increases
        }
      });
    }
  });

  router.post("/v1/autotrade/mode", requireAuth, ...brokerGate, async (req, res) => {
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

  router.post("/v1/autotrade/connect", requireAuth, ...brokerGate, async (req, res) => {
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
          code: (error as { code?: string }).code ?? "CONNECT_FAILED",
          message: error instanceof Error ? error.message : "Connect failed"
        }
      });
    }
  });

  router.post("/v1/autotrade/demo/diagnostics", requireAuth, ...brokerGate, async (req, res) => {
    try {
      const status = await service.refreshDemoDiagnostics(getAuthenticatedUserId(req));
      res.json({
        status,
        report: status.lastDiagnosticReport,
        readOnly: true,
        ordersEnabled: false,
        environment: "IG DEMO — READ ONLY",
        demoOrderSubmissionEnabled: false,
        liveExecutionFeatureEnabled: false
      });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "DIAGNOSTICS_FAILED",
          message: error instanceof Error ? error.message : "Diagnostics failed"
        }
      });
    }
  });

  router.post("/v1/autotrade/disconnect", requireAuth, ...brokerGate, async (req, res) => {
    try {
      const status = await service.disconnectBroker(getAuthenticatedUserId(req));
      res.json({ status });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "DISCONNECT_FAILED",
          message: error instanceof Error ? error.message : "Disconnect failed"
        }
      });
    }
  });

  const brokerSelectSchema = z
    .object({
      broker: z.enum(["MANUAL", "T212_INVEST", "PEPPERSTONE_CTRADER", "IG_DEMO"])
    })
    .strict();

  router.post("/v1/autotrade/broker", requireAuth, ...brokerGate, async (req, res) => {
    const parsed = brokerSelectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "INVALID_BROKER", message: "Invalid broker selection" }
      });
      return;
    }
    try {
      const status = await service.selectBroker(
        getAuthenticatedUserId(req),
        parsed.data.broker
      );
      res.json({ status });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "BROKER_SELECT_FAILED",
          message: error instanceof Error ? error.message : "Broker select failed"
        }
      });
    }
  });

  const t212ConnectSchema = z
    .object({
      environment: z.enum(["PRACTICE", "LIVE"]).default("PRACTICE")
    })
    .strict();

  router.post("/v1/autotrade/t212/connect", requireAuth, ...brokerGate, async (req, res) => {
    const parsed = t212ConnectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "INVALID_T212_CONNECT", message: "Invalid Trading 212 connect payload" }
      });
      return;
    }
    try {
      const status = await service.connectTrading212(
        getAuthenticatedUserId(req),
        parsed.data.environment
      );
      res.json({
        status,
        readOnly: true,
        ordersEnabled: false,
        paperOrderSubmissionEnabled: false,
        liveExecutionFeatureEnabled: false
      });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "T212_CONNECT_FAILED",
          message: error instanceof Error ? error.message : "Trading 212 connect failed"
        }
      });
    }
  });

  router.post("/v1/autotrade/t212/disconnect", requireAuth, ...brokerGate, async (req, res) => {
    try {
      const status = await service.disconnectTrading212(getAuthenticatedUserId(req));
      res.json({ status });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "T212_DISCONNECT_FAILED",
          message: error instanceof Error ? error.message : "Disconnect failed"
        }
      });
    }
  });

  router.post("/v1/autotrade/t212/diagnostics", requireAuth, ...brokerGate, async (req, res) => {
    try {
      const status = await service.refreshT212Diagnostics(getAuthenticatedUserId(req));
      res.json({
        status,
        report: status.t212LastDiagnosticReport,
        readOnly: true,
        ordersEnabled: false,
        orderEndpointsCalled: false
      });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "T212_DIAGNOSTICS_FAILED",
          message: error instanceof Error ? error.message : "Diagnostics failed"
        }
      });
    }
  });

  const t212SearchSchema = z
    .object({
      query: z.string().max(120).optional()
    })
    .strict();

  router.post("/v1/autotrade/t212/instruments/search", requireAuth, ...brokerGate, async (req, res) => {
    const parsed = t212SearchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "INVALID_SEARCH", message: "Invalid instrument search" }
      });
      return;
    }
    try {
      const result = await service.searchT212GoldInstruments(
        getAuthenticatedUserId(req),
        parsed.data.query
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "T212_SEARCH_FAILED",
          message: error instanceof Error ? error.message : "Search failed"
        }
      });
    }
  });

  const t212ConfirmInstrumentSchema = z
    .object({
      instrumentId: z.string().min(1).max(64),
      ticker: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      currency: z.string().min(1).max(8),
      isin: z.string().max(32).nullable().optional(),
      exchange: z.string().max(64).nullable().optional(),
      fractionalSupported: z.boolean().nullable().optional(),
      minOrderQuantity: z.number().nullable().optional(),
      minOrderValue: z.number().nullable().optional()
    })
    .strict();

  router.post("/v1/autotrade/t212/instruments/confirm", requireAuth, ...brokerGate, async (req, res) => {
    const parsed = t212ConfirmInstrumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "INVALID_INSTRUMENT",
          message: "Explicit gold instrument confirmation required"
        }
      });
      return;
    }
    try {
      const status = await service.confirmT212Instrument(
        getAuthenticatedUserId(req),
        parsed.data
      );
      res.json({ status });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "T212_INSTRUMENT_CONFIRM_FAILED",
          message: error instanceof Error ? error.message : "Confirm failed"
        }
      });
    }
  });

  const t212ProposalSchema = z
    .object({
      decisionId: z.string().min(4),
      decision: z.string().min(1),
      confidence: z.number().nullable().optional(),
      score: z.number().nullable().optional(),
      generatedAt: z.string().nullable().optional(),
      marketOpen: z.boolean().nullable().optional()
      // holdingQuantity intentionally omitted — server uses portfolio holdings only
    })
    .strict();

  router.post("/v1/autotrade/t212/proposals", requireAuth, ...brokerGate, async (req, res) => {
    const parsed = t212ProposalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "INVALID_PROPOSAL", message: "Invalid proposal payload" }
      });
      return;
    }
    try {
      const result = await service.createT212ExecutionProposal(
        getAuthenticatedUserId(req),
        {
          decisionId: parsed.data.decisionId,
          decision: parsed.data.decision,
          confidence: parsed.data.confidence,
          score: parsed.data.score,
          generatedAt: parsed.data.generatedAt
        },
        {
          marketOpen: parsed.data.marketOpen
        }
      );
      res.json({
        ...result,
        orderSubmitted: false,
        paperOrderSubmissionEnabled: false,
        liveExecutionFeatureEnabled: false
      });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "T212_PROPOSAL_FAILED",
          message: error instanceof Error ? error.message : "Proposal failed"
        }
      });
    }
  });

  const t212ApproveSchema = z
    .object({
      proposalId: z.string().min(4),
      confirmMethod: z.enum(["manual", "biometric_future"]).optional()
    })
    .strict();

  router.post("/v1/autotrade/t212/proposals/approve-dry-run", requireAuth, ...brokerGate, async (req, res) => {
    const parsed = t212ApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "INVALID_APPROVAL", message: "Invalid dry-run approval payload" }
      });
      return;
    }
    try {
      const result = await service.approveT212ProposalDryRun(
        getAuthenticatedUserId(req),
        parsed.data.proposalId,
        { confirmMethod: parsed.data.confirmMethod }
      );
      res.json({
        ...result,
        orderSubmitted: false,
        statusCode: "DRY_RUN_APPROVED"
      });
    } catch (error) {
      res.status(400).json({
        error: {
          code: (error as { code?: string }).code ?? "T212_APPROVE_FAILED",
          message: error instanceof Error ? error.message : "Approve failed"
        }
      });
    }
  });

  router.post("/v1/autotrade/emergency-stop", requireAuth, ...brokerGate, async (req, res) => {
    const status = await service.emergencyStop(getAuthenticatedUserId(req));
    res.json({
      ok: true,
      status,
      message: "Emergency STOP engaged. AutoTrade is OFF and locked."
    });
  });

  router.post("/v1/autotrade/unlock", requireAuth, ...brokerGate, async (req, res) => {
    const status = await service.unlock(getAuthenticatedUserId(req));
    res.json({ status });
  });

  /**
   * Admin/emulator-only: evaluate using a stored decision id.
   * Browser clients must not send executable decision fields.
   * Disabled outside test/emulator unless ALLOW_AUTOTRADE_INTERNAL_EVALUATE=true.
   */
  router.post(
    "/v1/autotrade/internal/evaluate-decision",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      if (!internalEvaluateAllowed()) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Internal AutoTrade evaluate is not enabled in this environment."
          }
        });
        return;
      }
      const parsed = internalEvaluateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: "INVALID_SIGNAL", message: "decisionId is required" }
        });
        return;
      }
      try {
        const result = await service.evaluateFromStoredDecision(
          getAuthenticatedUserId(req),
          parsed.data.decisionId,
          goldMetaStore
        );
        res.json(result);
      } catch (error) {
        res.status(400).json({
          error: {
            code: (error as { code?: string }).code ?? "EVALUATE_FAILED",
            message: error instanceof Error ? error.message : "Evaluate failed"
          }
        });
      }
    }
  );

  /** Explicitly blocked — former public evaluate endpoint. */
  router.post("/v1/autotrade/evaluate", requireAuth, (_req, res) => {
    res.status(410).json({
      error: {
        code: "EVALUATE_REMOVED",
        message:
          "Public AutoTrade evaluate was removed. Execution is triggered from trusted server decision documents only."
      }
    });
  });

  return router;
};
