import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  applyAdminUserAction,
  listUsersForAdmin,
  type AdminAction
} from "../services/auth/adminUserService";
import { getUserProfileStore } from "../services/auth/userProfileStore";
import type { AccountRole } from "../services/auth/roles";

const ACTIONS = new Set<AdminAction>(["approve", "reject", "suspend", "restore"]);

export const buildAdminUsersRouter = (): Router => {
  const router = Router();

  router.get("/v1/admin/users", requireAuth, requireAdmin, async (_req, res) => {
    const users = await listUsersForAdmin();
    res.status(200).json({ users });
  });

  router.get("/v1/admin/users/audit", requireAuth, requireAdmin, async (req, res) => {
    const limit = Math.min(100, Number(req.query.limit ?? 50) || 50);
    const events = await getUserProfileStore().listAudit(limit);
    res.status(200).json({ events });
  });

  router.post(
    "/v1/admin/users/:uid/:action",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const action = req.params.action as AdminAction;
      if (!ACTIONS.has(action)) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown action" } });
        return;
      }
      // Never accept role escalation body fields.
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (body.role || body.makeOwner || body.ownerUid) {
        res.status(403).json({
          error: {
            code: "ROLE_ESCALATION_REJECTED",
            message: "Role changes must use approved admin actions only. OWNER promotion is forbidden."
          }
        });
        return;
      }

      const targetUid = Array.isArray(req.params.uid) ? req.params.uid[0] : req.params.uid;
      if (!targetUid) {
        res.status(400).json({ error: { code: "INVALID_UID", message: "User id required" } });
        return;
      }
      const result = await applyAdminUserAction({
        actorUid: req.userId!,
        actorRole: (req.accountRole ?? "ADMIN") as AccountRole,
        targetUid,
        action
      });
      if (!result.ok) {
        res.status(result.status).json({
          error: { code: result.code, message: result.message }
        });
        return;
      }
      res.status(200).json({ user: result.user });
    }
  );

  return router;
};
