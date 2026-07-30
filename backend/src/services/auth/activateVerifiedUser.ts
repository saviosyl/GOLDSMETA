/**
 * Automatic basic-app activation after email verification.
 * Promotes USER_PENDING → USER_APPROVED when approvalRequired=false.
 * Never grants broker/AutoTrade/Live flags. Never touches OWNER/ADMIN.
 */

import { getAuth } from "firebase-admin/auth";
import { getFirebaseApp } from "../firebaseAdmin";
import { loadOwnerAuthConfig, maskUid } from "./ownerAuthConfig";
import { loadRegistrationConfig } from "./registrationConfig";
import {
  approvalStatusForRole,
  defaultBrokerFlags,
  type AccountRole
} from "./roles";
import type { UserProfileRecord } from "./userProfile";
import {
  getUserProfileStore,
  type UserProfileStore
} from "./userProfileStore";

export type ActivationResult = {
  activated: boolean;
  alreadyApproved: boolean;
  skipped: boolean;
  role: AccountRole;
  reason: string;
  profile: UserProfileRecord | null;
};

/** In-flight locks to collapse simultaneous /me + API activations. */
const inFlight = new Map<string, Promise<ActivationResult>>();

async function setApprovedClaims(uid: string): Promise<void> {
  const app = getFirebaseApp();
  if (!app) return;
  await getAuth(app).setCustomUserClaims(uid, {
    role: "USER_APPROVED",
    admin: false,
    ...defaultBrokerFlags()
  });
}

export function isEligibleForAutoActivation(
  profile: UserProfileRecord,
  args: {
    emailVerified: boolean;
    approvalRequired: boolean;
    pinnedOwnerUid: string | null;
  }
): { ok: true } | { ok: false; reason: string } {
  if (args.approvalRequired) {
    return { ok: false, reason: "APPROVAL_REQUIRED" };
  }
  if (!args.emailVerified) {
    return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
  }
  if (args.pinnedOwnerUid && profile.uid === args.pinnedOwnerUid) {
    return { ok: false, reason: "OWNER_PROTECTED" };
  }
  if (profile.role === "OWNER" || profile.role === "ADMIN") {
    return { ok: false, reason: "STAFF_EXCLUDED" };
  }
  if (profile.role === "USER_SUSPENDED" || profile.approvalStatus === "SUSPENDED") {
    return { ok: false, reason: "SUSPENDED" };
  }
  if (profile.role === "USER_APPROVED" && profile.approvalStatus === "APPROVED") {
    return { ok: false, reason: "ALREADY_APPROVED" };
  }
  if (profile.role !== "USER_PENDING") {
    return { ok: false, reason: "ROLE_NOT_PENDING" };
  }
  if (profile.approvalStatus === "REJECTED") {
    return { ok: false, reason: "MANUAL_REVIEW_REQUIRED" };
  }
  if (profile.registrationIncomplete || profile.approvalStatus === "REGISTRATION_INCOMPLETE") {
    return { ok: false, reason: "REGISTRATION_INCOMPLETE" };
  }
  return { ok: true };
}

/**
 * Idempotent promotion for a verified pending user when open registration mode
 * is enabled. Fail-closed: skips when ineligible; never grants broker flags.
 */
export async function tryActivateVerifiedPendingUser(args: {
  uid: string;
  emailVerified: boolean;
  profiles?: UserProfileStore;
  env?: NodeJS.ProcessEnv;
}): Promise<ActivationResult> {
  const existing = inFlight.get(args.uid);
  if (existing) return existing;

  const run = doActivate(args).finally(() => {
    inFlight.delete(args.uid);
  });
  inFlight.set(args.uid, run);
  return run;
}

async function doActivate(args: {
  uid: string;
  emailVerified: boolean;
  profiles?: UserProfileStore;
  env?: NodeJS.ProcessEnv;
}): Promise<ActivationResult> {
  const env = args.env ?? process.env;
  const profiles = args.profiles ?? getUserProfileStore();
  const cfg = loadRegistrationConfig(env);
  const owner = loadOwnerAuthConfig(env);

  const profile = await profiles.getProfile(args.uid);
  if (!profile) {
    return {
      activated: false,
      alreadyApproved: false,
      skipped: true,
      role: "USER_PENDING",
      reason: "NO_PROFILE",
      profile: null
    };
  }

  const eligibility = isEligibleForAutoActivation(profile, {
    emailVerified: args.emailVerified,
    approvalRequired: cfg.approvalRequired,
    pinnedOwnerUid: owner.pinnedOwnerUid
  });

  if (!eligibility.ok) {
    const already = eligibility.reason === "ALREADY_APPROVED";
    return {
      activated: false,
      alreadyApproved: already,
      skipped: true,
      role: profile.role,
      reason: eligibility.reason,
      profile
    };
  }

  const now = new Date().toISOString();
  const next: UserProfileRecord = {
    ...profile,
    role: "USER_APPROVED",
    approvalStatus: approvalStatusForRole("USER_APPROVED"),
    emailVerified: true,
    ...defaultBrokerFlags(),
    approvedAt: profile.approvedAt ?? now,
    approvedBy: profile.approvedBy ?? "system:email_verified",
    rejectedAt: null,
    suspendedAt: null,
    registrationIncomplete: false,
    updatedAt: now
  };

  await profiles.upsertProfile(next);

  try {
    await setApprovedClaims(args.uid);
  } catch {
    // Claims best-effort in local/test without Admin SDK.
  }

  await profiles.writeAudit({
    actorUidMasked: "system",
    actorRole: "USER_APPROVED",
    action: "USER_AUTO_ACTIVATED_EMAIL_VERIFIED",
    targetUidMasked: maskUid(args.uid) ?? "unknown",
    detail: "role=USER_APPROVED; brokerAccess=false; autoTrade=false"
  });

  return {
    activated: true,
    alreadyApproved: false,
    skipped: false,
    role: "USER_APPROVED",
    reason: "ACTIVATED",
    profile: next
  };
}

export type PendingActivationReport = {
  eligibleCount: number;
  totalPending: number;
  excluded: {
    unverified: number;
    rejected: number;
    incomplete: number;
    suspended: number;
    staff: number;
    other: number;
  };
  /** Masked UIDs only — never full UID or email. */
  eligibleUidMaskedSample: string[];
  migrationExecuted: false;
  note: string;
};

/**
 * Dry-run count of verified USER_PENDING accounts eligible for one-time
 * backfill. Does not mutate any account.
 */
export async function reportEligiblePendingActivations(args?: {
  profiles?: UserProfileStore;
  env?: NodeJS.ProcessEnv;
  sampleLimit?: number;
}): Promise<PendingActivationReport> {
  const profiles = args?.profiles ?? getUserProfileStore();
  const env = args?.env ?? process.env;
  const owner = loadOwnerAuthConfig(env);
  const sampleLimit = args?.sampleLimit ?? 10;
  const all = await profiles.listProfiles();

  const excluded = {
    unverified: 0,
    rejected: 0,
    incomplete: 0,
    suspended: 0,
    staff: 0,
    other: 0
  };
  let totalPending = 0;
  const eligibleUidMaskedSample: string[] = [];
  let eligibleCount = 0;

  for (const profile of all) {
    if (profile.role !== "USER_PENDING") continue;
    totalPending += 1;

    const eligibility = isEligibleForAutoActivation(profile, {
      emailVerified: profile.emailVerified === true,
      approvalRequired: false, // count as if open-mode backfill were approved
      pinnedOwnerUid: owner.pinnedOwnerUid
    });

    if (eligibility.ok) {
      eligibleCount += 1;
      if (eligibleUidMaskedSample.length < sampleLimit) {
        eligibleUidMaskedSample.push(maskUid(profile.uid) ?? "unknown");
      }
      continue;
    }

    switch (eligibility.reason) {
      case "EMAIL_NOT_VERIFIED":
        excluded.unverified += 1;
        break;
      case "MANUAL_REVIEW_REQUIRED":
        excluded.rejected += 1;
        break;
      case "REGISTRATION_INCOMPLETE":
        excluded.incomplete += 1;
        break;
      case "SUSPENDED":
        excluded.suspended += 1;
        break;
      case "STAFF_EXCLUDED":
      case "OWNER_PROTECTED":
        excluded.staff += 1;
        break;
      default:
        excluded.other += 1;
    }
  }

  return {
    eligibleCount,
    totalPending,
    excluded,
    eligibleUidMaskedSample,
    migrationExecuted: false,
    note: "Dry-run only. Do not migrate without separate owner approval."
  };
}
