import type { Message } from "firebase-admin/messaging";
import { Router } from "express";
import { z } from "zod";
import { approvedAccountGate } from "../middleware/accountAccess";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferenceSchema
} from "../models/types";
import { sendFirebaseMessages } from "../services/firebaseAdmin";
import { sendWebPushToUser } from "../services/notifications/webPush";
import type { GoldMetaStore } from "../services/storage/types";

const preferencePatchSchema = notificationPreferenceSchema.partial().strict();

const readSchema = z
  .object({
    notificationIds: z.array(z.string().min(1)).max(100).optional(),
    notificationId: z.string().min(1).optional(),
    markAll: z.boolean().optional()
  })
  .strict();

const limitFromQuery = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : 50;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;
};

export const buildNotificationsRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/notifications/preferences", requireAuth, ...approvedAccountGate, async (req, res) => {
    const settings = await store.getSettings(getAuthenticatedUserId(req));
    res.json({
      notificationPreferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...settings.notificationPreferences
      },
      notificationsEnabled: settings.notificationsEnabled === true
    });
  });

  router.patch("/v1/notifications/preferences", requireAuth, ...approvedAccountGate, async (req, res) => {
    const parsed = preferencePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "INVALID_NOTIFICATION_PREFERENCES",
          message: "Invalid notification preferences payload"
        }
      });
      return;
    }
    const userId = getAuthenticatedUserId(req);
    const current = await store.getSettings(userId);
    const next = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...current.notificationPreferences,
      ...parsed.data
    };
    const settings = await store.updateSettings(userId, {
      notificationPreferences: next
    });
    res.json({
      notificationPreferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...settings.notificationPreferences
      },
      notificationsEnabled: settings.notificationsEnabled === true
    });
  });

  router.get("/v1/notifications", requireAuth, ...approvedAccountGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const limit = limitFromQuery(req.query.limit);
    res.json({
      notifications: store.listInAppNotifications
        ? await store.listInAppNotifications(userId, limit)
        : []
    });
  });

  router.post("/v1/notifications/read", requireAuth, ...approvedAccountGate, async (req, res) => {
    const parsed = readSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "INVALID_NOTIFICATION_READ", message: "Invalid notification read payload" }
      });
      return;
    }
    const ids = parsed.data.markAll
      ? undefined
      : parsed.data.notificationIds ?? (parsed.data.notificationId ? [parsed.data.notificationId] : undefined);
    const updated = store.markInAppNotificationsRead
      ? await store.markInAppNotificationsRead(getAuthenticatedUserId(req), ids)
      : 0;
    res.json({ updated });
  });

  router.post("/v1/notifications/test", requireAuth, ...approvedAccountGate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const title = "GoldMeta — Test notification";
    const message = "Notifications are connected for this device.";
    const data = { event: "TEST_NOTIFICATION" };
    const notification = store.createInAppNotification
      ? await store.createInAppNotification(userId, {
          event: "TEST_NOTIFICATION",
          direction: null,
          title,
          message,
          planId: null,
          data
        })
      : null;
    const devices = await store.listDevices(userId);
    const fcmMessages: Message[] = devices.map((device) => ({
      token: device.fcmToken,
      notification: { title, body: message },
      data
    }));
    const fcmSent = await sendFirebaseMessages(fcmMessages);
    const webSent = await sendWebPushToUser(store, userId, { title, body: message, data });
    res.json({ ok: true, notification, fcmSent, webSent });
  });

  return router;
};
