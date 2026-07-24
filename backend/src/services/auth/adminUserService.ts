import { getAuth } from "firebase-admin/auth";
import { getFirebaseApp } from "../firebaseAdmin";
import { loadOwnerAuthConfig, maskUid } from "./ownerAuthConfig";
import {
  approvalStatusForRole,
  defaultBrokerFlags,
  isStaffRole,
  type AccountRole
} from "./roles";
import { adminUserListItem } from "./userProfile";
import {
  getUserProfileStore,
  type UserProfileStore
} from "./userProfileStore";
import { checkAdminActionRateLimit } from "./registrationRateLimit";

export type AdminAction = "approve" | "reject" | "suspend" | "restore";

export type AdminActionResult =
  | { ok: true; user: ReturnType<typeof adminUserListItem> }
  | { ok: false; status: number; code: string; message: string };

async function setClaims(uid: string, role: AccountRole): Promise<void> {
  const app = getFirebaseApp();
  if (!app) return;
  const auth = getAuth(app);
  await auth.setCustomUserClaims(uid, {
    role,
    admin: role === "ADMIN" || role === "OWNER",
    ...defaultBrokerFlags()
  });
  if (role === "USER_SUSPENDED") {
    await auth.revokeRefreshTokens(uid);
  }
}

export async function listUsersForAdmin(args?: {
  profiles?: UserProfileStore;
}): Promise<ReturnType<typeof adminUserListItem>[]> {
  const profiles = args?.profiles ?? getUserProfileStore();
  const all = await profiles.listProfiles();
  return all.map((p) => adminUserListItem(p, (uid) => maskUid(uid) ?? "unknown"));
}

/**
 * @param authTimeSeconds Firebase token auth_time (seconds since epoch).
 * Recent authentication required for approve/suspend/restore (15 minutes).
 */
async function auditAttempt(
  profiles: UserProfileStore,
  args: {
    actorUid: string;
    actorRole: AccountRole;
    targetUid: string;
    action: AdminAction;
    result: string;
    detail?: string;
  }
): Promise<void> {
  await profiles.writeAudit({
    actorUidMasked: maskUid(args.actorUid) ?? "unknown",
    actorRole: args.actorRole,
    action: `USER_${args.action.toUpperCase()}_${args.result}`,
    targetUidMasked: maskUid(args.targetUid) ?? "unknown",
    detail: args.detail ?? args.result
  });
}

export async function applyAdminUserAction(args: {
  actorUid: string;
  actorRole: AccountRole;
  targetUid: string;
  action: AdminAction;
  authTimeSeconds?: number | null;
  profiles?: UserProfileStore;
  env?: NodeJS.ProcessEnv;
}): Promise<AdminActionResult> {
  const profiles = args.profiles ?? getUserProfileStore();

  if (!isStaffRole(args.actorRole)) {
    await auditAttempt(profiles, {
      ...args,
      result: "DENIED",
      detail: "FORBIDDEN"
    });
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Admin access required" };
  }

  const rate = await checkAdminActionRateLimit({ actorUid: args.actorUid });
  if (!rate.allowed) {
    await auditAttempt(profiles, {
      ...args,
      result: "DENIED",
      detail: rate.code
    });
    return { ok: false, status: 429, code: rate.code, message: rate.message };
  }

  const sensitive = args.action === "approve" || args.action === "suspend" || args.action === "restore";
  if (sensitive && args.authTimeSeconds != null) {
    const ageSec = Math.floor(Date.now() / 1000) - args.authTimeSeconds;
    if (ageSec > 15 * 60) {
      await auditAttempt(profiles, {
        ...args,
        result: "DENIED",
        detail: "REAUTH_REQUIRED"
      });
      return {
        ok: false,
        status: 401,
        code: "REAUTH_REQUIRED",
        message: "Please sign in again before approving or suspending accounts."
      };
    }
  }

  const env = args.env ?? process.env;
  const owner = loadOwnerAuthConfig(env);
  if (owner.pinnedOwnerUid && args.targetUid === owner.pinnedOwnerUid) {
    await auditAttempt(profiles, {
      ...args,
      result: "DENIED",
      detail: "OWNER_PROTECTED"
    });
    return {
      ok: false,
      status: 403,
      code: "OWNER_PROTECTED",
      message: "The pinned owner account cannot be modified by this action."
    };
  }

  // ADMIN cannot modify their own role / unsuspend themselves.
  if (args.actorRole === "ADMIN" && args.targetUid === args.actorUid) {
    await auditAttempt(profiles, {
      ...args,
      result: "DENIED",
      detail: "SELF_ACTION_FORBIDDEN"
    });
    return {
      ok: false,
      status: 403,
      code: "SELF_ACTION_FORBIDDEN",
      message: "Administrators cannot modify their own account role or suspension state."
    };
  }

  const profile = await profiles.getProfile(args.targetUid);
  if (!profile) {
    await auditAttempt(profiles, {
      ...args,
      result: "DENIED",
      detail: "NOT_FOUND"
    });
    return { ok: false, status: 404, code: "NOT_FOUND", message: "User not found" };
  }
  if (profile.role === "OWNER") {
    await auditAttempt(profiles, {
      ...args,
      result: "DENIED",
      detail: "OWNER_PROTECTED"
    });
    return {
      ok: false,
      status: 403,
      code: "OWNER_PROTECTED",
      message: "The pinned owner account cannot be modified by this action."
    };
  }

  // ADMIN cannot approve/modify another ADMIN — OWNER-only role management.
  if (args.actorRole === "ADMIN" && profile.role === "ADMIN") {
    await auditAttempt(profiles, {
      ...args,
      result: "DENIED",
      detail: "ADMIN_PEER_FORBIDDEN"
    });
    return {
      ok: false,
      status: 403,
      code: "ADMIN_PEER_FORBIDDEN",
      message: "Only the owner can manage administrator accounts."
    };
  }

  const now = new Date().toISOString();
  let nextRole: AccountRole = profile.role;

  switch (args.action) {
    case "approve":
      if (profile.role === "USER_APPROVED" && profile.approvalStatus === "APPROVED") {
        // Idempotent approve.
        return {
          ok: true,
          user: adminUserListItem(profile, (uid) => maskUid(uid) ?? "unknown")
        };
      }
      nextRole = "USER_APPROVED";
      profile.approvedAt = now;
      profile.approvedBy = maskUid(args.actorUid);
      profile.rejectedAt = null;
      profile.suspendedAt = null;
      profile.registrationIncomplete = false;
      break;
    case "reject":
      // Prefer REJECTED status — do not hard-delete Auth.
      nextRole = "USER_PENDING";
      profile.rejectedAt = now;
      profile.approvedAt = null;
      profile.approvalStatus = "REJECTED";
      break;
    case "suspend":
      nextRole = "USER_SUSPENDED";
      profile.suspendedAt = now;
      break;
    case "restore":
      if (args.actorRole !== "OWNER" && profile.role === "USER_SUSPENDED" && args.targetUid === args.actorUid) {
        return {
          ok: false,
          status: 403,
          code: "SELF_ACTION_FORBIDDEN",
          message: "Administrators cannot unsuspend themselves."
        };
      }
      nextRole = "USER_APPROVED";
      profile.suspendedAt = null;
      profile.rejectedAt = null;
      profile.approvedAt = profile.approvedAt ?? now;
      break;
    default:
      return { ok: false, status: 400, code: "INVALID_ACTION", message: "Unknown action" };
  }

  if ((nextRole as string) === "OWNER") {
    return {
      ok: false,
      status: 403,
      code: "OWNER_PROMOTION_FORBIDDEN",
      message: "Cannot promote any user to OWNER."
    };
  }

  profile.role = nextRole;
  if (args.action !== "reject") {
    profile.approvalStatus = approvalStatusForRole(nextRole);
  }
  profile.updatedAt = now;
  Object.assign(profile, defaultBrokerFlags());

  await profiles.upsertProfile(profile);
  try {
    await setClaims(args.targetUid, nextRole);
    if (args.action === "approve" || args.action === "restore") {
      // Force fresh token before elevated access is usable.
      const app = getFirebaseApp();
      if (app) await getAuth(app).revokeRefreshTokens(args.targetUid);
    }
  } catch {
    // Claims update best-effort in local/test without Admin.
  }

  await profiles.writeAudit({
    actorUidMasked: maskUid(args.actorUid) ?? "unknown",
    actorRole: args.actorRole,
    action: `USER_${args.action.toUpperCase()}_COMPLETED`,
    targetUidMasked: maskUid(args.targetUid) ?? "unknown",
    detail: `role=${nextRole}; approval=${profile.approvalStatus}`
  });

  return {
    ok: true,
    user: adminUserListItem(profile, (uid) => maskUid(uid) ?? "unknown")
  };
}
