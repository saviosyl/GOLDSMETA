import { Router } from "express";
import { deviceRegistrationSchema } from "../models/types";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import type { GoldMetaStore } from "../services/storage/types";
import { nowIso } from "../utils/time";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildDevicesRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.post("/v1/devices/register", requireAuth, async (req, res) => {
    const parsed = deviceRegistrationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_DEVICE", message: "Invalid device payload" } });
      return;
    }

    const device = await store.registerDevice({
      ...parsed.data,
      userId: getAuthenticatedUserId(req),
      registeredAt: nowIso()
    });
    res.status(201).json({ device });
  });

  router.delete("/v1/devices/:deviceId", requireAuth, async (req, res) => {
    const deviceId = firstParam(req.params.deviceId);
    if (!deviceId) {
      res.status(400).json({ error: { code: "MISSING_DEVICE_ID", message: "Device ID required" } });
      return;
    }

    const deleted = await store.deleteDevice(getAuthenticatedUserId(req), deviceId);
    res.status(deleted ? 204 : 404).send();
  });

  return router;
};
