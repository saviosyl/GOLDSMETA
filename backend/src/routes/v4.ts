import { Router } from "express";
import { getAuthenticatedUserId, requireAuth, requireAdmin } from "../middleware/auth";
import type { GoldMetaStore } from "../services/storage/types";
import { v4Config } from "../services/v4/config";
import { buildSyntheticSeries, experimentId, runV4Backtest } from "../services/v4/backtester";
import { evaluateV4 } from "../services/v4/engine";

export const buildV4Router = (store: GoldMetaStore): Router => {
  const router = Router();

  /** Research status — never claims actionable LIVE V4. */
  router.get("/v1/v4/status", requireAuth, async (_req, res) => {
    res.json({
      v4: {
        strategyVersion: v4Config.strategyVersion,
        engineVersion: v4Config.engineVersion,
        configVersion: v4Config.configVersion,
        profileVersion: v4Config.profileVersion,
        deploymentStage: v4Config.deploymentStage,
        actionableLiveEnabled: v4Config.flags.actionableLiveEnabled,
        shadowComputeEnabled: v4Config.flags.shadowComputeEnabled,
        shadowPersistEnabled: v4Config.flags.shadowPersistEnabled,
        mlMetaFilterEnabled: v4Config.flags.mlMetaFilterEnabled,
        brokerExecution: "DISABLED",
        productionStrategy: "legacy strategyVersion=3",
        note: "V4 is research/shadow only. Profit is not guaranteed. V3 remains production."
      }
    });
  });

  router.get("/v1/v4/shadows", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const shadows = (await store.listV4ShadowResults?.(userId, limit)) ?? [];
    res.json({
      shadows,
      actionable: false,
      disclaimer: "Shadow results are not trade recommendations."
    });
  });

  /** Admin-only synthetic research smoke backtest — not production signals. */
  router.post("/v1/v4/research/smoke-backtest", requireAuth, requireAdmin, async (_req, res) => {
    const series = buildSyntheticSeries(7, 160);
    const report = runV4Backtest(series, {
      sample: "in_sample",
      foldId: experimentId("smoke", v4Config.configVersion),
      spreadPoints: 0.35,
      embargoBars: 8,
      maxExperimentsNote: "Smoke research only — not an acceptance run."
    });
    res.json({
      report,
      recommendation: report.meetsAcceptanceGates
        ? "Synthetic smoke met numeric gates — still insufficient for LIVE promotion (need real OOS + shadow)."
        : "Do not progress V4 to manual testing on this smoke run alone.",
      actionable: false
    });
  });

  /** Evaluate a research payload without touching production decisions. */
  router.post("/v1/v4/research/evaluate", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = evaluateV4({
        ...(req.body as Parameters<typeof evaluateV4>[0]),
        environment: "RESEARCH"
      });
      res.json({ result, actionable: false });
    } catch {
      res.status(400).json({
        error: { code: "INVALID_V4_INPUT", message: "Invalid V4 research payload" }
      });
    }
  });

  return router;
};
