import { Router } from "express";
import { API_ARTIFACT_REVISION } from "../config/apiArtifactRevision";
import { env } from "../config/env";
import { BACKEND_VERSION, RULE_CONFIG_VERSION } from "../config/decisionConfig";

export const buildHealthRouter = (): Router => {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      backendVersion: BACKEND_VERSION,
      ruleConfigVersion: RULE_CONFIG_VERSION,
      appEnv: env.APP_ENV,
      storageBackend: env.STORAGE_BACKEND,
      apiArtifactRevision: API_ARTIFACT_REVISION
    });
  });

  return router;
};
