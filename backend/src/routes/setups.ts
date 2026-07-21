import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { computeSetupAnalytics } from "../services/setup/analytics";
import type { GoldMetaStore } from "../services/storage/types";
import { setupLifecycleConfig, BACKEND_VERSION_PHASE3 } from "../config/setupLifecycleConfig";
import { BACKEND_VERSION, RULE_CONFIG_VERSION } from "../config/decisionConfig";
import { IG_DEMO_ADAPTER_PLAN, MockBrokerAdapter } from "../services/brokers/mockBrokerAdapter";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildSetupsRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/setups", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
    res.json({ setups: await store.listSetups(userId, limit) });
  });

  router.get("/v1/setups/active", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const env = req.query.environment === "TEST" ? "TEST" : req.query.environment === "LIVE" ? "LIVE" : undefined;
    res.json({ setups: await store.listActiveSetups(userId, env) });
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

  router.get("/v1/analytics/setups", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const environment = req.query.environment === "TEST" ? "TEST" : "LIVE";
    const setups = await store.listSetups(userId, 200);
    res.json({ analytics: computeSetupAnalytics(setups, environment) });
  });

  router.get("/v1/system/status", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const [latest, active, connections] = await Promise.all([
      store.latestDecision(userId),
      store.listActiveSetups(userId),
      store.listWebhookConnections(userId)
    ]);
    const activeConnection = connections.find((c) => c.status === "ACTIVE");
    res.json({
      status: {
        backendVersion: BACKEND_VERSION_PHASE3,
        decisionBackendVersion: BACKEND_VERSION,
        ruleConfigVersion: RULE_CONFIG_VERSION,
        setupRuleConfigVersion: setupLifecycleConfig.version,
        flags: setupLifecycleConfig.flags,
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
        brokerLiveExecutionEnabled: setupLifecycleConfig.flags.brokerLiveExecutionEnabled
      }
    });
  });

  router.get("/v1/admin/diagnostics", requireAuth, async (req, res) => {
    // Phase 3: any authenticated user can read their own diagnostics (no secrets).
    // Future: restrict via admin claim.
    const userId = getAuthenticatedUserId(req);
    const [latest, setups, connections, rejects] = await Promise.all([
      store.latestDecision(userId),
      store.listSetups(userId, 20),
      store.listWebhookConnections(userId),
      store.listRecentWebhookRejects?.(20) ?? Promise.resolve([])
    ]);
    const active = connections.filter((c) => c.status === "ACTIVE");
    res.json({
      diagnostics: {
        apiHealth: "ok",
        backendVersion: BACKEND_VERSION_PHASE3,
        ruleConfigVersion: RULE_CONFIG_VERSION,
        setupRuleConfigVersion: setupLifecycleConfig.version,
        pineVersionLastReceived: latest?.pineScriptVersion ?? null,
        flags: setupLifecycleConfig.flags,
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
