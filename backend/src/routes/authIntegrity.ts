/**
 * Admin-only Auth integrity status route.
 * Read-only — never mutates Auth or Firestore ownership.
 */

import { Router } from "express";
import { getAuth } from "firebase-admin/auth";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { loadOwnerAuthConfig } from "../services/auth/ownerAuthConfig";
import {
  checkOwnerAuthIntegrity,
  type AuthLookupPort
} from "../services/auth/authIntegrity";
import type { GoldMetaStore } from "../services/storage/types";

function createFirebaseAuthLookup(store: GoldMetaStore): AuthLookupPort {
  return {
    async getUserByEmail(email) {
      try {
        const user = await getAuth().getUserByEmail(email);
        return { uid: user.uid, email: user.email };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "auth/user-not-found") return null;
        throw error;
      }
    },
    async getUser(uid) {
      try {
        const user = await getAuth().getUser(uid);
        return { uid: user.uid, email: user.email };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "auth/user-not-found") return null;
        throw error;
      }
    },
    async listWebhookConnectionsForUser(userId) {
      const list = await store.listWebhookConnections(userId);
      return list.map((c) => ({ webhookId: c.webhookId, status: c.status }));
    }
  };
}

export const buildAuthIntegrityRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/admin/auth-integrity", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await checkOwnerAuthIntegrity({
        config: loadOwnerAuthConfig(),
        auth: createFirebaseAuthLookup(store)
      });
      res.json({
        integrity: result,
        mutatedAuth: false,
        publicUidsExposed: false
      });
    } catch (error) {
      res.status(500).json({
        error: {
          code: "AUTH_INTEGRITY_CHECK_FAILED",
          message: error instanceof Error ? error.message : "Integrity check failed"
        }
      });
    }
  });

  return router;
};
