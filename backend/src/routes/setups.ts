import { Router } from "express";
import { getAuthenticatedUserId, requireAuth, requireAdmin } from "../middleware/auth";
import { computeSetupAnalytics } from "../services/setup/analytics";
import type { DecisionEnvironment, GoldMetaStore } from "../services/storage/types";
import { setupLifecycleConfig, BACKEND_VERSION_PHASE3 } from "../config/setupLifecycleConfig";
import { BACKEND_VERSION, RULE_CONFIG_VERSION } from "../config/decisionConfig";
import { env } from "../config/env";
import { IG_DEMO_ADAPTER_PLAN, MockBrokerAdapter } from "../services/brokers/mockBrokerAdapter";
import { manualExecutionSchema } from "../models/manualRisk";
import { nowIso } from "../utils/time";
import { v4Config, v4FlagSnapshot } from "../services/v4/config";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const parseEnvironmentQuery = (
  raw: unknown
): { ok: true; environment?: DecisionEnvironment } | { ok: false; message: string } => {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, environment: undefined };
  }
  if (typeof raw !== "string") {
    return { ok: false, message: "environment must be TEST or LIVE" };
  }
  const value = raw.trim().toUpperCase();
  if (value === "TEST" || value === "LIVE") {
    return { ok: true, environment: value };
  }
  return { ok: false, message: "environment must be TEST or LIVE" };
};

export const buildSetupsRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/setups", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const parsedEnv = parseEnvironmentQuery(req.query.environment);
    if (!parsedEnv.ok) {
      res.status(400).json({ error: { code: "INVALID_ENVIRONMENT", message: parsedEnv.message } });
      return;
    }
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
    res.json({ setups: await store.listSetups(userId, limit, parsedEnv.environment) });
  });

  router.get("/v1/setups/active", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const parsedEnv = parseEnvironmentQuery(req.query.environment);
    if (!parsedEnv.ok) {
      res.status(400).json({ error: { code: "INVALID_ENVIRONMENT", message: parsedEnv.message } });
      return;
    }
    res.json({ setups: await store.listActiveSetups(userId, parsedEnv.environment) });
  });

  router.get("/v1/setups/:setupId", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const setupId = firstParam(req.params.setupId);
    const setup = setupId ? await store.getSetup(userId, setupId) : undefined;
    if (!setup) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Setup not found" } });
      return;
    }
    res.json({ setup });
  });

  /** Manual trade journal — never mutates system outcome fields. */
  router.patch("/v1/setups/:setupId/manual-execution", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const setupId = firstParam(req.params.setupId);
    if (!setupId) {
      res.status(400).json({ error: { code: "INVALID_SETUP", message: "setupId required" } });
      return;
    }
    const parsed = manualExecutionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_MANUAL_EXECUTION", message: "Invalid payload" } });
      return;
    }
    const settings = await store.getSettings(userId);
    if (!settings.liveForwardAckAt && (parsed.data.action === "ENTERED" || parsed.data.action === "ENTERED_LATE")) {
      res.status(403).json({
        error: {
          code: "LIVE_ACK_REQUIRED",
          message: "Acknowledge LIVE forward-testing before journaling entered trades"
        }
      });
      return;
    }
    const record = {
      ...parsed.data,
      updatedAt: nowIso(),
      systemOutcomeUntouched: true as const
    };
    const setup = await store.saveManualExecution(userId, setupId, record);
    if (!setup) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Setup not found" } });
      return;
    }
    res.json({ setup });
  });

  router.get("/v1/analytics/setups", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const parsedEnv = parseEnvironmentQuery(req.query.environment);
    if (!parsedEnv.ok) {
      res.status(400).json({ error: { code: "INVALID_ENVIRONMENT", message: parsedEnv.message } });
      return;
    }
    const environment: DecisionEnvironment = parsedEnv.environment ?? "LIVE";
    const setups = await store.listSetups(userId, 200, environment);
    res.json({ analytics: computeSetupAnalytics(setups, environment) });
  });

  router.get("/v1/system/status", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const [latest, active, connections, skips, settings] = await Promise.all([
      store.latestDecision(userId),
      store.listActiveSetups(userId),
      store.listWebhookConnections(userId),
      store.listRecentSetupSkips(userId, 5),
      store.getSettings(userId)
    ]);
    const activeConnection = connections.find((c) => c.status === "ACTIVE");
    res.json({
      status: {
        backendVersion: BACKEND_VERSION_PHASE3,
        decisionBackendVersion: BACKEND_VERSION,
        ruleConfigVersion: RULE_CONFIG_VERSION,
        setupRuleConfigVersion: setupLifecycleConfig.version,
        flags: {
          ...setupLifecycleConfig.flags,
          aiEnabled: env.AI_ENABLED,
          v4: v4FlagSnapshot()
        },
        v4: {
          strategyVersion: v4Config.strategyVersion,
          engineVersion: v4Config.engineVersion,
          deploymentStage: v4Config.deploymentStage,
          mode: v4Config.mode,
          actionable: false,
          flags: v4FlagSnapshot()
        },
        tradingView: {
          connectionStatus: activeConnection?.status ?? "NONE",
          webhookId: activeConnection?.webhookId ?? null,
          lastAlertAt: activeConnection?.lastAlertAt ?? null
        },
        latestDecision: latest
          ? {
              decisionId: latest.decisionId,
              decision: latest.decision,
              generatedAt: latest.generatedAt,
              barTime: latest.barTime,
              environment: latest.environment,
              dataQuality: latest.dataQuality
            }
          : null,
        activeSetups: active.map((s) => ({
          setupId: s.setupId,
          status: s.status,
          direction: s.direction,
          environment: s.environment
        })),
        latestSetupSkip: skips[0] ?? null,
        liveForwardAckAt: settings.liveForwardAckAt ?? null,
        manualRisk: settings.manualRisk ?? null,
        brokerLiveExecutionEnabled: setupLifecycleConfig.flags.brokerLiveExecutionEnabled,
        brokerExecutionEnabled: setupLifecycleConfig.flags.brokerExecutionEnabled,
        brokerMode: setupLifecycleConfig.flags.brokerMode
      }
    });
  });

  router.get("/v1/admin/diagnostics", requireAuth, requireAdmin, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const [latest, setups, connections, rejects, skips] = await Promise.all([
      store.latestDecision(userId),
      store.listSetups(userId, 20),
      store.listWebhookConnections(userId),
      store.listRecentWebhookRejects?.(20) ?? Promise.resolve([]),
      store.listRecentSetupSkips(userId, 10)
    ]);
    const active = connections.filter((c) => c.status === "ACTIVE");
    res.json({
      diagnostics: {
        apiHealth: "ok",
        backendVersion: BACKEND_VERSION_PHASE3,
        ruleConfigVersion: RULE_CONFIG_VERSION,
        setupRuleConfigVersion: setupLifecycleConfig.version,
        pineVersionLastReceived: latest?.pineScriptVersion ?? null,
        flags: {
          setupTrackingEnabled: setupLifecycleConfig.flags.setupTrackingEnabled,
          setupTrackingEnvironments: setupLifecycleConfig.flags.setupTrackingEnvironments,
          brokerMode: setupLifecycleConfig.flags.brokerMode,
          brokerExecutionEnabled: setupLifecycleConfig.flags.brokerExecutionEnabled,
          brokerLiveExecutionEnabled: setupLifecycleConfig.flags.brokerLiveExecutionEnabled,
          aiEnabled: env.AI_ENABLED,
          analysisGenerationEnabled: setupLifecycleConfig.flags.analysisGenerationEnabled,
          newSetupCreationEnabled: setupLifecycleConfig.flags.newSetupCreationEnabled,
          v4: v4FlagSnapshot()
        },
        v4: {
          strategyVersion: v4Config.strategyVersion,
          engineVersion: v4Config.engineVersion,
          configVersion: v4Config.configVersion,
          deploymentStage: v4Config.deploymentStage,
          mode: v4Config.mode,
          actionable: false,
          flags: v4FlagSnapshot()
        },
        webhookConnections: active.map((c) => ({
          webhookId: c.webhookId,
          status: c.status,
          lastAlertAt: c.lastAlertAt,
          hasSecret: c.secret !== null
        })),
        latestDecision: latest
          ? {
              decisionId: latest.decisionId,
              decision: latest.decision,
              generatedAt: latest.generatedAt,
              environment: latest.environment
            }
          : null,
        latestSetupTransition: setups[0]?.statusHistory.slice(-1)[0] ?? null,
        recentSetupSkips: skips.map((s) => ({
          id: s.id,
          decisionId: s.decisionId,
          environment: s.environment,
          reason: s.reason,
          at: s.at
        })),
        recentRejects: rejects,
        igDemoPlan: IG_DEMO_ADAPTER_PLAN,
        mockBrokerReady: new MockBrokerAdapter().name
      }
    });
  });

  router.post("/v1/broker/demo/preview", requireAuth, async (req, res) => {
    const adapter = new MockBrokerAdapter();
    const body = (req.body ?? {}) as {
      idempotencyKey?: unknown;
      direction?: unknown;
      size?: unknown;
    };
    const result = await adapter.previewOrder({
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : `preview-${Date.now()}`,
      symbol: "XAUUSD",
      direction: body.direction === "SELL" ? "SELL" : "BUY",
      size: typeof body.size === "number" ? body.size : 0.1
    });
    res.json({ result });
  });

  return router;
};
