import { Router } from "express";
import { getAuthenticatedUserId, requireAuth, requireAdmin } from "../middleware/auth";
import type { GoldMetaStore } from "../services/storage/types";
import { v4Config, v4FlagSnapshot } from "../services/v4/config";
import { buildSyntheticSeries, experimentId, runV4Backtest } from "../services/v4/backtester";
import { evaluateV4 } from "../services/v4/engine";
import { computeV4ShadowAnalytics } from "../services/v4/shadowAnalytics";
import { fetchComexGcProfile, GC_DATA_SOURCE_OPTIONS } from "../services/v4/gcProvider";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const envParam = (raw: unknown): "LIVE" | "TEST" => {
  const value = typeof raw === "string" ? raw : firstParam(raw as string | string[] | undefined);
  return (value ?? "LIVE").toUpperCase() === "TEST" ? "TEST" : "LIVE";
};

export const buildV4Router = (store: GoldMetaStore): Router => {
  const router = Router();

  /** Research status — never claims actionable LIVE V4. */
  router.get("/v1/v4/status", requireAuth, (_req, res) => {
    res.json({
      v4: {
        strategyVersion: v4Config.strategyVersion,
        engineVersion: v4Config.engineVersion,
        configVersion: v4Config.configVersion,
        profileVersion: v4Config.profileVersion,
        deploymentStage: v4Config.deploymentStage,
        mode: v4Config.mode,
        actionableLiveEnabled: false,
        actionableSetupEnabled: v4Config.flags.actionableSetupEnabled,
        liveSetupCreation: v4Config.flags.liveSetupCreation,
        notificationsEnabled: v4Config.flags.notificationsEnabled,
        shadowComputeEnabled: v4Config.flags.shadowComputeEnabled,
        shadowLifecycleEnabled: v4Config.flags.shadowLifecycleEnabled,
        shadowPersistEnabled: v4Config.flags.shadowPersistEnabled,
        mlMetaFilterEnabled: v4Config.flags.mlMetaFilterEnabled,
        flags: v4FlagSnapshot(),
        brokerExecution: "DISABLED",
        productionStrategy: "legacy strategyVersion=3",
        banner: "V4 RESEARCH — LIVE SHADOW ONLY",
        disclaimer: "NOT A TRADE RECOMMENDATION",
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

  router.get("/v1/v4/analyses", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const analyses =
      (await store.listV4ShadowAnalyses?.(userId, environment, limit)) ?? [];
    res.json({ analyses, environment, actionable: false });
  });

  router.get("/v1/v4/candidates", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const candidates =
      (await store.listV4ShadowCandidates?.(userId, environment, limit)) ?? [];
    res.json({ candidates, environment, actionable: false });
  });

  router.get("/v1/v4/plans", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const plans = (await store.listV4ShadowPlans?.(userId, environment, limit)) ?? [];
    const open = plans.find(
      (p) =>
        p.status === "WAITING_FOR_ENTRY" ||
        p.status === "ENTERED" ||
        p.status === "TP1_HIT" ||
        p.status === "TP2_HIT"
    );
    res.json({
      plans,
      openPlan: open ?? null,
      environment,
      actionable: false,
      disclaimer: "Shadow plans are not trade recommendations. No BUY NOW / SELL NOW."
    });
  });

  router.get("/v1/v4/analytics", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const [analyses, candidates, plans, mutations] = await Promise.all([
      store.listV4ShadowAnalyses?.(userId, environment, 500) ?? Promise.resolve([]),
      store.listV4ShadowCandidates?.(userId, environment, 500) ?? Promise.resolve([]),
      store.listV4ShadowPlans?.(userId, environment, 500) ?? Promise.resolve([]),
      store.listV4PlanMutations?.(userId, 200) ?? Promise.resolve([])
    ]);
    const analytics = computeV4ShadowAnalytics({
      environment,
      analyses,
      candidates,
      plans
    });
    analytics.planMutationCount = Math.max(
      analytics.planMutationCount,
      mutations.length
    );
    res.json({
      analytics,
      actionable: false,
      disclaimer:
        "Separate from V3 analytics. Sample-size warnings apply. Not proof of profitability."
    });
  });

  router.get("/v1/v4/gc/status", requireAuth, (_req, res) => {
    const gc = fetchComexGcProfile();
    res.json({
      gc,
      dataSourceOptions: GC_DATA_SOURCE_OPTIONS,
      banner: gc.profileQuality === "UNAVAILABLE" ? "GC CONFIRMATION UNAVAILABLE" : "GC PROFILE",
      actionable: false
    });
  });

  /** Admin-only synthetic research smoke backtest — not production signals. */
  router.post("/v1/v4/research/smoke-backtest", requireAuth, requireAdmin, (_req, res) => {
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
  router.post("/v1/v4/research/evaluate", requireAuth, requireAdmin, (req, res) => {
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
