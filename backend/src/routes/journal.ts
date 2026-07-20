import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { journalCreateSchema, journalPatchSchema } from "../models/types";
import { calculateJournalStatistics } from "../services/journal/statistics";
import type { GoldMetaStore } from "../services/storage/types";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const buildJournalRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.post("/v1/journal", requireAuth, async (req, res) => {
    const parsed = journalCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_JOURNAL", message: "Invalid journal payload" } });
      return;
    }
    const entry = await store.createJournalEntry(getAuthenticatedUserId(req), parsed.data);
    res.status(201).json({ entry });
  });

  router.get("/v1/journal", requireAuth, async (req, res) => {
    const entries = await store.listJournalEntries(getAuthenticatedUserId(req));
    res.json({ entries });
  });

  router.patch("/v1/journal/:journalId", requireAuth, async (req, res) => {
    const journalId = firstParam(req.params.journalId);
    const parsed = journalPatchSchema.safeParse(req.body);
    if (!journalId || !parsed.success) {
      res.status(400).json({ error: { code: "INVALID_JOURNAL", message: "Invalid journal patch" } });
      return;
    }
    const updated = await store.patchJournalEntry(getAuthenticatedUserId(req), journalId, parsed.data);
    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Journal entry not found" } });
      return;
    }
    res.json({ entry: updated });
  });

  router.get("/v1/journal/statistics", requireAuth, async (req, res) => {
    const entries = await store.listJournalEntries(getAuthenticatedUserId(req));
    res.json({ statistics: calculateJournalStatistics(entries) });
  });

  return router;
};
