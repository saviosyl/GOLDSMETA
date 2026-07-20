import { Router } from "express";
import { BACKEND_VERSION, RULE_CONFIG_VERSION } from "../config/decisionConfig";

export const buildHealthRouter = (): Router => {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      backendVersion: BACKEND_VERSION,
      ruleConfigVersion: RULE_CONFIG_VERSION
    });
  });

  return router;
};
