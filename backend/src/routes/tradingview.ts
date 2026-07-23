import { randomBytes, randomUUID } from "crypto";
import { Router, type Request } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import type { TradingViewPayload } from "../models/types";
import type { GoldMetaStore, WebhookConnection } from "../services/storage/types";
import { buildStableEventId } from "../services/webhook/eventId";
import { enqueueWebhookEvent } from "../services/webhook/enqueueWebhookEvent";
import { buildTradingViewWebhookUrl } from "../services/webhook/publicWebhookUrl";
import { AiExplainer } from "../services/ai/explainer";

type PublicWebhookConnection = Omit<WebhookConnection, "secret"> & {
  id: string;
  webhookUrl: string;
  webhookURL: string;
  payloadSecret?: string;
  hasSecret: boolean;
};

const randomToken = (bytes: number): string => randomBytes(bytes).toString("base64url");

const webhookUrlFor = (req: Request, webhookId: string): string =>
  buildTradingViewWebhookUrl(webhookId, req);

const redactConnection = (
  req: Request,
  connection: WebhookConnection,
  payloadSecret?: string | null
): PublicWebhookConnection => {
  const { secret, ...publicConnection } = connection;
  return {
    ...publicConnection,
    id: connection.webhookId,
    webhookUrl: webhookUrlFor(req, connection.webhookId),
    webhookURL: webhookUrlFor(req, connection.webhookId),
    payloadSecret: payloadSecret ?? undefined,
    hasSecret: secret !== null
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
): Promise<WebhookConnection> =>
  store.createWebhookConnection({
    userId,
    webhookId: randomToken(18),
    secret: randomToken(24)
  });

const buildTestPayload = (connection: WebhookConnection): TradingViewPayload => {
  const timestamp = new Date().toISOString();
  const indicatorName = `goldmeta-test-${randomUUID()}`;
  return {
    schemaVersion: "1.0",
    source: "manual",
    eventId: `test-${randomUUID()}`,
    webhookSecret: connection.secret,
    symbol: "XAUUSD",
    exchange: "TEST",
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
    levels: null,
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
      source: "goldmeta-api-test"
    }
  };
};

export const buildTradingViewRouter = (
  store: GoldMetaStore,
  aiExplainer = new AiExplainer()
): Router => {
  const router = Router();

  router.post("/v1/tradingview/connections", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const connection = await createConnection(store, userId);
    res.status(201).json({
      connection: redactConnection(req, connection, connection.secret),
      webhookUrl: webhookUrlFor(req, connection.webhookId),
      secret: connection.secret
    });
  });

  router.get("/v1/tradingview/connections", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const connections = await store.listWebhookConnections(userId);
    res.json({
      connections: connections.map((connection) => redactConnection(req, connection))
    });
  });

  router.post("/v1/tradingview/connections/:webhookId/rotate", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const webhookId = firstParam(req.params.webhookId);
    const secret = randomToken(24);
    const connection = webhookId
      ? await store.rotateWebhookConnection(userId, webhookId, secret)
      : undefined;

    if (!connection) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
      return;
    }

    res.json({
      connection: redactConnection(req, connection, secret),
      webhookUrl: webhookUrlFor(req, connection.webhookId),
      secret
    });
  });

  router.delete("/v1/tradingview/connections/:webhookId", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const webhookId = firstParam(req.params.webhookId);
    const connection = webhookId
      ? await store.revokeWebhookConnection(userId, webhookId)
      : undefined;

    if (!connection) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
      return;
    }

    res.json({ connection: redactConnection(req, connection) });
  });

  router.post("/v1/tradingview/test", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const requestedWebhookId =
      optionalStringField(req.body as unknown, "webhookId") ??
      optionalStringField(req.body as unknown, "connectionId");
    const connection = requestedWebhookId
      ? await store.getWebhookConnection(userId, requestedWebhookId)
      : (await store.listWebhookConnections(userId)).find(
          (candidate) => candidate.status === "ACTIVE"
        ) ?? (await createConnection(store, userId));

    if (!connection) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
      return;
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

    res.status(202).json({
      ok: true,
      message: "TradingView test alert accepted. Open Dashboard or History to confirm the TEST decision appears.",
      connection: redactConnection(req, connection),
      ...result
    });
  });

  return router;
};
