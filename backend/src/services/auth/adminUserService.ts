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

export async function applyAdminUserAction(args: {
  actorUid: string;
  actorRole: AccountRole;
  targetUid: string;
  action: AdminAction;
  profiles?: UserProfileStore;
  env?: NodeJS.ProcessEnv;
}): Promise<AdminActionResult> {
  if (!isStaffRole(args.actorRole)) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Admin access required" };
  }

  const env = args.env ?? process.env;
  const owner = loadOwnerAuthConfig(env);
  if (owner.pinnedOwnerUid && args.targetUid === owner.pinnedOwnerUid) {
    return {
      ok: false,
      status: 403,
      code: "OWNER_PROTECTED",
      message: "The pinned owner account cannot be modified by this action."
    };
  }

  if (args.action === "approve" && args.targetUid === args.actorUid && args.actorRole !== "OWNER") {
    // no-op special case unused; keep explicit
  }

  const profiles = args.profiles ?? getUserProfileStore();
  const profile = await profiles.getProfile(args.targetUid);
  if (!profile) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "User not found" };
  }
  if (profile.role === "OWNER") {
    return {
      ok: false,
      status: 403,
      code: "OWNER_PROTECTED",
      message: "The pinned owner account cannot be modified by this action."
    };
  }

  const now = new Date().toISOString();
  let nextRole: AccountRole = profile.role;

  switch (args.action) {
    case "approve":
      nextRole = "USER_APPROVED";
      profile.approvedAt = now;
      profile.approvedBy = maskUid(args.actorUid);
      profile.rejectedAt = null;
      profile.suspendedAt = null;
      break;
    case "reject":
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
  // Broker flags remain false for new users unless separately authorised later.
  Object.assign(profile, defaultBrokerFlags());

  await profiles.upsertProfile(profile);
  try {
    await setClaims(args.targetUid, nextRole);
  } catch {
    // Claims update best-effort in local/test without Admin.
  }

  await profiles.writeAudit({
    actorUidMasked: maskUid(args.actorUid) ?? "unknown",
    actorRole: args.actorRole,
    action: `USER_${args.action.toUpperCase()}`,
    targetUidMasked: maskUid(args.targetUid) ?? "unknown",
    detail: `role=${nextRole}; approval=${profile.approvalStatus}`
  });

  return {
    ok: true,
    user: adminUserListItem(profile, (uid) => maskUid(uid) ?? "unknown")
  };
}
