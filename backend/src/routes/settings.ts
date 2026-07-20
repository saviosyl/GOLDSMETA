import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { settingsPatchSchema } from "../models/types";
import type { GoldMetaStore } from "../services/storage/types";

export const buildSettingsRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/settings", requireAuth, async (req, res) => {
    res.json({ settings: await store.getSettings(getAuthenticatedUserId(req)) });
  });

  router.patch("/v1/settings", requireAuth, async (req, res) => {
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_SETTINGS", message: "Invalid settings payload" } });
      return;
    }
    res.json({ settings: await store.updateSettings(getAuthenticatedUserId(req), parsed.data) });
  });

  return router;
};
