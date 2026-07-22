import { createHash } from "crypto";
import { Router } from "express";
import { webPushSubscriptionSchema } from "../models/types";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import type { GoldMetaStore } from "../services/storage/types";
import { nowIso } from "../utils/time";

const subscriptionIdFor = (userId: string, endpoint: string): string =>
  createHash("sha256").update(`${userId}:${endpoint}`).digest("hex").slice(0, 40);

export const buildPushRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/push/vapid-public-key", requireAuth, (_req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
    res.json({ publicKey });
  });

  router.post("/v1/push/web-subscriptions", requireAuth, async (req, res) => {
    const parsed = webPushSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "INVALID_PUSH_SUBSCRIPTION", message: "Invalid Web Push subscription" }
      });
      return;
    }

    const userId = getAuthenticatedUserId(req);
    const now = nowIso();
    const subscriptionId = subscriptionIdFor(userId, parsed.data.endpoint);
    const existing = (await store.listWebPushSubscriptions(userId)).find(
      (item) => item.endpoint === parsed.data.endpoint
    );

    const record = await store.upsertWebPushSubscription({
      ...parsed.data,
      userId,
      subscriptionId,
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: now
    });

    res.status(existing ? 200 : 201).json({ subscription: record });
  });

  router.delete("/v1/push/web-subscriptions", requireAuth, async (req, res) => {
    const bodyEndpoint =
      typeof req.body === "object" &&
      req.body !== null &&
      "endpoint" in req.body &&
      typeof (req.body as { endpoint?: unknown }).endpoint === "string"
        ? (req.body as { endpoint: string }).endpoint
        : null;
    const queryEndpoint = typeof req.query.endpoint === "string" ? req.query.endpoint : null;
    const endpoint = bodyEndpoint ?? queryEndpoint;
    if (!endpoint) {
      res.status(400).json({ error: { code: "MISSING_ENDPOINT", message: "endpoint required" } });
      return;
    }

    const deleted = await store.deleteWebPushSubscription(getAuthenticatedUserId(req), endpoint);
    res.status(deleted ? 204 : 404).send();
  });

  return router;
};
