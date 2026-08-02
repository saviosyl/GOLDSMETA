import { randomUUID } from "crypto";
import { Router, type Request } from "express";
import { getAuthenticatedUserId, requireAuth, requireAdmin } from "../middleware/auth";
import { brokerGate } from "../middleware/accountAccess";
import type { TradingViewPayload } from "../models/types";
import type { GoldMetaStore, WebhookConnection } from "../services/storage/types";
import { buildStableEventId } from "../services/webhook/eventId";
import { enqueueWebhookEvent } from "../services/webhook/enqueueWebhookEvent";
import { buildTradingViewWebhookUrl } from "../services/webhook/publicWebhookUrl";
import { AiExplainer } from "../services/ai/explainer";
import {
  buildStandardAlertMessageGuide,
  getActiveStandardTemplate,
  getStandardTemplateById,
  listStandardTemplates,
  publicTemplateSummary,
  publishStandardTemplateVersion,
  STANDARD_TEMPLATE_ID
} from "../services/tradingview/standardTemplate";
import {
  ensureStandardDefaults,
  generateWebhookId,
  generateWebhookSecret,
  getUserTradingViewConnection,
  hashWebhookToken,
  publicConnectionView,
  restoreStandardSetup,
  saveCustomMapping,
  saveUserTradingViewConnection,
  validateCustomMappings,
  type FieldMapping
} from "../services/tradingview/userTradingViewConnection";

type PublicWebhookConnection = Omit<WebhookConnection, "secret" | "secretHash"> & {
  id: string;
  webhookUrl: string;
  webhookURL: string;
  payloadSecret?: string;
  hasSecret: boolean;
};

const webhookUrlFor = (req: Request, webhookId: string): string =>
  buildTradingViewWebhookUrl(webhookId, req);

const redactConnection = (
  req: Request,
  connection: WebhookConnection,
  payloadSecret?: string | null
): PublicWebhookConnection => {
  const publicConnection = { ...connection } as Partial<WebhookConnection> &
    Omit<WebhookConnection, "secret" | "secretHash">;
  delete publicConnection.secret;
  delete publicConnection.secretHash;
  return {
    ...publicConnection,
    id: connection.webhookId,
    webhookUrl: webhookUrlFor(req, connection.webhookId),
    webhookURL: webhookUrlFor(req, connection.webhookId),
    payloadSecret: payloadSecret ?? undefined,
    hasSecret: Boolean(connection.secretHash || connection.secret)
  };
};

const optionalStringField = (body: unknown, field: string): string | undefined => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const createConnection = async (
  store: GoldMetaStore,
  userId: string
): Promise<{ connection: WebhookConnection; plaintextSecret: string }> => {
  const plaintextSecret = generateWebhookSecret();
  const webhookId = generateWebhookId();
  const tpl = getActiveStandardTemplate();
  const connection = await store.createWebhookConnection({
    userId,
    webhookId,
    secret: null,
    secretHash: hashWebhookToken(plaintextSecret),
    templateId: tpl.id,
    templateMode: "standard"
  });
  const now = new Date().toISOString();
  await saveUserTradingViewConnection(userId, {
    webhookId,
    webhookTokenHash: hashWebhookToken(plaintextSecret),
    webhookCreatedAt: now,
    connectionStatus: "waiting_for_alert",
    templateMode: "standard",
    templateId: tpl.id,
    templateVersion: tpl.version
  });
  return { connection, plaintextSecret };
};

/**
 * TEST-only webhook body. OHLC ~2408 is a labelled fixture regime — never treat as LIVE.
 * Production Market Structure Map must not mix these with live ~4050 alert levels.
 */
const buildTestPayload = (_connection: WebhookConnection): TradingViewPayload => {
  const timestamp = new Date().toISOString();
  const indicatorName = `goldmeta-test-${randomUUID()}`;
  return {
    schemaVersion: "1.0",
    source: "manual",
    eventId: `test-${randomUUID()}`,
    webhookSecret: null,
    symbol: "XAUUSD",
    exchange: "TEST_FIXTURE",
    timeframe: "15",
    eventType: "TEST",
    barTime: timestamp,
    sentAt: timestamp,
    isConfirmedBar: true,
    indicatorName,
    ohlcv: {
      open: 2400,
      high: 2412,
      low: 2396,
      close: 2408,
      volume: 1
    },
    levels: {
      pocAll: 2408,
      vahAll: 2415,
      valAll: 2400
    },
    sessionVolumeProfile: null,
    marketProfile: null,
    trend: {
      direction: "NEUTRAL",
      strength: 50,
      components: []
    },
    confirmationCandle: null,
    optionalIndicators: null,
    metadata: {
      source: "goldmeta-api-test-fixture",
      templateId: STANDARD_TEMPLATE_ID,
      templateVersion: getActiveStandardTemplate().version,
      fixtureLabel: "TEST FIXTURE — NOT LIVE BROKER DATA"
    }
  };
};

export const buildTradingViewRouter = (
  store: GoldMetaStore,
  aiExplainer = new AiExplainer()
): Router => {
  const router = Router();

  /** Standard template (public to verified users) — no secrets. */
  router.get("/v1/tradingview/template", requireAuth, ...brokerGate, async (_req, res) => {
    res.json({
      template: publicTemplateSummary(),
      templates: listStandardTemplates().map((t) => publicTemplateSummary(t))
    });
  });

  /** Per-user setup status for wizard / status card. */
  router.get("/v1/tradingview/setup", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const profile = await ensureStandardDefaults(userId);
    const connections = await store.listWebhookConnections(userId);
    const active = connections.find((c) => c.status === "ACTIVE") ?? null;
    const webhookId = profile.webhookId ?? active?.webhookId ?? null;
    res.json({
      setup: publicConnectionView(profile),
      template: publicTemplateSummary(
        getStandardTemplateById(profile.templateId) ?? getActiveStandardTemplate()
      ),
      webhookUrl: webhookId ? webhookUrlFor(req, webhookId) : null,
      alertGuide: buildStandardAlertMessageGuide({
        templateVersion: profile.templateVersion,
        symbolAlias: profile.selectedSymbolAlias,
        timeframe: profile.selectedTimeframes[0] ?? "15"
      }),
      connections: connections.map((c) => redactConnection(req, c)),
      autoTrade: "OFF",
      orderSubmissionEnabled: false
    });
  });

  router.patch("/v1/tradingview/setup", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const body = (req.body ?? {}) as {
      templateMode?: "standard" | "custom";
      selectedSymbolAlias?: string;
      selectedTimeframes?: string[];
      staleSignalLimitSeconds?: number;
    };
    const patch: Parameters<typeof saveUserTradingViewConnection>[1] = {};
    if (body.templateMode === "standard") {
      await restoreStandardSetup(userId);
    } else if (body.templateMode === "custom") {
      patch.templateMode = "custom";
    }
    if (typeof body.selectedSymbolAlias === "string") {
      patch.selectedSymbolAlias = body.selectedSymbolAlias.trim().toUpperCase() || "XAUUSD";
    }
    if (Array.isArray(body.selectedTimeframes)) {
      patch.selectedTimeframes = body.selectedTimeframes.map(String);
    }
    if (typeof body.staleSignalLimitSeconds === "number") {
      patch.staleSignalLimitSeconds = body.staleSignalLimitSeconds;
    }
    const profile = await saveUserTradingViewConnection(userId, patch);
    res.json({
      setup: publicConnectionView(profile),
      autoTrade: "OFF",
      orderSubmissionEnabled: false
    });
  });

  router.post("/v1/tradingview/setup/restore-standard", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const profile = await restoreStandardSetup(userId);
    res.json({
      setup: publicConnectionView(profile),
      template: publicTemplateSummary(),
      message: "Restored GoldMeta Standard Setup. Your private webhook URL is unchanged."
    });
  });

  router.post("/v1/tradingview/setup/custom-mapping", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const body = (req.body ?? {}) as {
      fieldMappings?: FieldMapping[];
      staleSignalLimitSeconds?: number;
      name?: string;
    };
    try {
      const result = await saveCustomMapping(
        userId,
        body.fieldMappings ?? [],
        body.staleSignalLimitSeconds ??
          getActiveStandardTemplate().validationRules.staleSignalLimitSeconds,
        body.name
      );
      res.json({
        setup: publicConnectionView(result.profile),
        mappingId: result.mapping.id,
        message: "Custom mapping saved. Server validation still applies."
      });
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(400).json({
        error: {
          code: err.code ?? "CUSTOM_MAPPING_INVALID",
          message: err.message
        }
      });
    }
  });

  router.post("/v1/tradingview/setup/validate-mapping", requireAuth, ...brokerGate, async (req, res) => {
    const body = (req.body ?? {}) as {
      fieldMappings?: FieldMapping[];
      staleSignalLimitSeconds?: number;
    };
    const result = validateCustomMappings(
      body.fieldMappings ?? [],
      body.staleSignalLimitSeconds ??
        getActiveStandardTemplate().validationRules.staleSignalLimitSeconds
    );
    if (!result.ok) {
      res.status(400).json({ valid: false, error: { code: result.code, message: result.message } });
      return;
    }
    res.json({ valid: true, message: "Mapping looks valid. Send a test payload next." });
  });

  router.post("/v1/tradingview/connections", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    await ensureStandardDefaults(userId);
    const { connection, plaintextSecret } = await createConnection(store, userId);
    res.status(201).json({
      connection: redactConnection(req, connection, plaintextSecret),
      webhookUrl: webhookUrlFor(req, connection.webhookId),
      secret: plaintextSecret,
      template: publicTemplateSummary(),
      notice:
        "Copy the webhook URL now. The secret is shown only once and is stored as a hash."
    });
  });

  router.get("/v1/tradingview/connections", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const connections = await store.listWebhookConnections(userId);
    const profile = await getUserTradingViewConnection(userId);
    res.json({
      connections: connections.map((connection) => redactConnection(req, connection)),
      setup: publicConnectionView(profile)
    });
  });

  router.post("/v1/tradingview/connections/:webhookId/rotate", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const webhookId = firstParam(req.params.webhookId);
    const plaintextSecret = generateWebhookSecret();
    const secretHash = hashWebhookToken(plaintextSecret);
    const connection = webhookId
      ? await store.rotateWebhookConnection(userId, webhookId, plaintextSecret, secretHash)
      : undefined;

    if (!connection) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
      return;
    }

    await saveUserTradingViewConnection(userId, {
      webhookId: connection.webhookId,
      webhookTokenHash: secretHash,
      webhookRotatedAt: new Date().toISOString(),
      connectionStatus: "waiting_for_alert"
    });

    res.json({
      connection: redactConnection(req, connection, plaintextSecret),
      webhookUrl: webhookUrlFor(req, connection.webhookId),
      secret: plaintextSecret,
      notice: "Secret rotated. Update TradingView if you embed the secret. Hash-only storage."
    });
  });

  router.delete("/v1/tradingview/connections/:webhookId", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const webhookId = firstParam(req.params.webhookId);
    const connection = webhookId
      ? await store.revokeWebhookConnection(userId, webhookId)
      : undefined;

    if (!connection) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
      return;
    }

    await saveUserTradingViewConnection(userId, {
      webhookId: null,
      webhookTokenHash: null,
      connectionStatus: "not_connected"
    });

    res.json({ connection: redactConnection(req, connection) });
  });

  router.post("/v1/tradingview/test", requireAuth, ...brokerGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const requestedWebhookId =
      optionalStringField(req.body as unknown, "webhookId") ??
      optionalStringField(req.body as unknown, "connectionId");
    let connection = requestedWebhookId
      ? await store.getWebhookConnection(userId, requestedWebhookId)
      : (await store.listWebhookConnections(userId)).find(
          (candidate) => candidate.status === "ACTIVE"
        );

    let revealedSecret: string | undefined;
    if (!connection) {
      const created = await createConnection(store, userId);
      connection = created.connection;
      revealedSecret = created.plaintextSecret;
    }

    const payload = buildTestPayload(connection);
    const stableEventId = buildStableEventId(payload);
    const result = await enqueueWebhookEvent({
      store,
      userId,
      webhookId: connection.webhookId,
      payload,
      stableEventId,
      environment: "TEST",
      isTestDecision: true,
      aiExplainer
    });

    await saveUserTradingViewConnection(userId, {
      lastSignalAt: new Date().toISOString(),
      lastValidSignalAt: new Date().toISOString(),
      connectionStatus: "connected",
      lastRejectReason: null
    });

    res.status(202).json({
      ok: true,
      message:
        "Test alert accepted. Open Dashboard or History to confirm the TEST decision appears.",
      connection: redactConnection(req, connection, revealedSecret),
      ...result,
      autoTrade: "OFF",
      orderSubmissionEnabled: false
    });
  });

  // —— Admin template management (role-gated, not email-only) ——
  router.get("/v1/admin/tradingview/template", requireAuth, requireAdmin, async (_req, res) => {
    const templates = listStandardTemplates();
    res.json({
      active: publicTemplateSummary(),
      templates: templates.map((t) => ({
        ...publicTemplateSummary(t),
        full: t
      })),
      aggregateNote:
        "Aggregate connection health is available from operational metrics; raw user webhook secrets are never shown."
    });
  });

  router.post("/v1/admin/tradingview/template", requireAuth, requireAdmin, async (req, res) => {
    const body = (req.body ?? {}) as Partial<{
      id: string;
      version: string;
      releaseNotes: string;
      instructions: string[];
      defaultAlertMessageBody: string;
    }>;
    const base = getActiveStandardTemplate();
    const published = publishStandardTemplateVersion({
      ...base,
      id: body.id ?? `goldmeta-standard-v${Number(base.version) + 1}`,
      version: body.version ?? String(Number(base.version) + 1),
      releaseNotes: body.releaseNotes ?? "Admin-published template update.",
      instructions: body.instructions ?? base.instructions,
      defaultAlertMessageBody: body.defaultAlertMessageBody ?? base.defaultAlertMessageBody
    });
    res.status(201).json({
      template: publicTemplateSummary(published),
      message:
        "Published new standard template version. User webhook tokens were not modified. Custom setups are not overwritten."
    });
  });

  return router;
};

// Re-export FieldMapping type usage for tests
export type { FieldMapping };
