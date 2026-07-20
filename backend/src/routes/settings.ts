import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { settingsPatchSchema } from "../models/types";
import type { InMemoryStore } from "../services/storage/inMemoryStore";

export const buildSettingsRouter = (store: InMemoryStore): Router => {
  const router = Router();

  router.get("/v1/settings", requireAuth, (req, res) => {
    res.json({ settings: store.getSettings(getAuthenticatedUserId(req)) });
  });

  router.patch("/v1/settings", requireAuth, (req, res) => {
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_SETTINGS", message: "Invalid settings payload" } });
      return;
    }
    res.json({ settings: store.updateSettings(getAuthenticatedUserId(req), parsed.data) });
  });

  return router;
};
