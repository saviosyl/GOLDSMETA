import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { approvedAccountGate } from "../middleware/accountAccess";
import { settingsPatchSchema, type UserSettings } from "../models/types";
import { DEFAULT_MANUAL_RISK } from "../models/manualRisk";
import type { GoldMetaStore } from "../services/storage/types";
import { nowIso } from "../utils/time";

const mergeManualRisk = (
  current: UserSettings["manualRisk"],
  patch: NonNullable<ReturnType<typeof settingsPatchSchema.parse>["manualRisk"]>
): UserSettings["manualRisk"] => ({
  ...current,
  ...patch,
  noAveragingDown: true,
  noMartingale: true,
  noAutomaticRecovery: true
});

export const buildSettingsRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/settings", requireAuth, ...approvedAccountGate, async (req, res) => {
    const settings = await store.getSettings(getAuthenticatedUserId(req));
    // Ensure Stage 3 defaults for older documents.
    if (!settings.manualRisk) {
      settings.manualRisk = { ...DEFAULT_MANUAL_RISK };
    }
    if (settings.liveForwardAckAt === undefined) settings.liveForwardAckAt = null;
    if (!settings.manualRiskLimitChangeLog) settings.manualRiskLimitChangeLog = [];
    res.json({ settings });
  });

  router.patch("/v1/settings", requireAuth, ...approvedAccountGate, async (req, res) => {
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_SETTINGS", message: "Invalid settings payload" } });
      return;
    }
    const userId = getAuthenticatedUserId(req);
    const current = await store.getSettings(userId);
    const base: UserSettings = {
      ...current,
      liveForwardAckAt: current.liveForwardAckAt ?? null,
      manualRisk: current.manualRisk ?? { ...DEFAULT_MANUAL_RISK },
      manualRiskLimitChangeLog: current.manualRiskLimitChangeLog ?? []
    };

    const changeLog = [...base.manualRiskLimitChangeLog];
    let nextManual = base.manualRisk;
    if (parsed.data.manualRisk) {
      nextManual = mergeManualRisk(base.manualRisk, parsed.data.manualRisk);
      for (const key of Object.keys(parsed.data.manualRisk) as Array<keyof typeof parsed.data.manualRisk>) {
        const from = base.manualRisk[key as keyof typeof base.manualRisk] as string | number | null;
        const to = nextManual[key as keyof typeof nextManual] as string | number | null;
        if (from !== to) {
          changeLog.unshift({ at: nowIso(), field: String(key), from, to });
        }
      }
    }

    const patch: Partial<Omit<UserSettings, "userId" | "updatedAt">> = {
      ...parsed.data,
      manualRisk: nextManual,
      manualRiskLimitChangeLog: changeLog.slice(0, 100),
      liveForwardAckAt:
        parsed.data.liveForwardAckAt !== undefined
          ? parsed.data.liveForwardAckAt
          : base.liveForwardAckAt
    };
    // Never allow enabling AI via client when server AI is off — fail closed on client toggle.
    if (parsed.data.aiEnabled === true) {
      patch.aiEnabled = false;
    }

    res.json({ settings: await store.updateSettings(userId, patch) });
  });

  return router;
};
