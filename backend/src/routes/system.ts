import { Router } from "express";
import { env } from "../config/env";
import { BACKEND_VERSION, RULE_CONFIG_VERSION } from "../config/decisionConfig";
import { requireAuth } from "../middleware/auth";
import { getFirebaseApp } from "../services/firebaseAdmin";

export const buildSystemRouter = (): Router => {
  const router = Router();

  router.get("/v1/system/status", requireAuth, (_req, res) => {
    res.json({
      status: "ok",
      backendVersion: BACKEND_VERSION,
      ruleConfigVersion: RULE_CONFIG_VERSION,
      appEnv: env.APP_ENV,
      storageBackend: env.STORAGE_BACKEND,
      firebaseAdminAvailable: getFirebaseApp() !== null
    });
  });

  router.post("/v1/manual-analysis", requireAuth, (_req, res) => {
    res.status(501).json({
      status: "not_implemented",
      mode: "manual",
      message: "Manual screenshot analysis is labelled manual and will be implemented after MVP."
    });
  });

  return router;
};
