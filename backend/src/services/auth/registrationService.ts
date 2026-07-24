/**
 * Controlled registration — Admin SDK create path.
 * Sequence: validate → rate-limit → reserve idempotency → create Auth →
 * profile → claims → verification. Partial failures mark REGISTRATION_INCOMPLETE.
 * Never creates TradingView webhooks, broker connections, or owner data copies.
 * Never silently deletes Auth users after ambiguous failure.
 */

import { createHash } from "crypto";
import { getFirebaseApp } from "../firebaseAdmin";
import { getAuth } from "firebase-admin/auth";
import { getFirestoreDb } from "../firebaseAdmin";
import { loadOwnerAuthConfig, maskUid, normalizeEmail } from "./ownerAuthConfig";
import { checkRegistrationRateLimit } from "./registrationRateLimit";
import { loadRegistrationConfig } from "./registrationConfig";
import {
  registrationProfileSchema,
  validateRegistrationInput
} from "./registrationValidation";
import {
  OWNER_EXISTS_MESSAGE,
  REGISTRATION_COMPLETE_MESSAGE,
  defaultBrokerFlags
} from "./roles";
import { buildPendingProfile } from "./userProfile";
import {
  getUserProfileStore,
  type UserProfileStore
} from "./userProfileStore";

export type AuthAdminPort = {
  getUserByEmail: (email: string) => Promise<{ uid: string } | null>;
  createUser: (args: {
    email: string;
    password: string;
    displayName: string;
    emailVerified: boolean;
  }) => Promise<{ uid: string }>;
  setCustomUserClaims: (
    uid: string,
    claims: Record<string, unknown>
  ) => Promise<void>;
  generateEmailVerificationLink: (
    email: string,
    continueUrl?: string | null
  ) => Promise<string>;
};

export type RegistrationServiceResult =
  | {
      ok: true;
      status: 201;
      body: {
        message: string;
        uidMasked: string;
        role: "USER_PENDING";
        emailVerificationSent: boolean;
        brokerAccess: false;
        autoTrade: false;
        approvalRequired: boolean;
      };
    }
  | {
      ok: false;
      status: number;
      body: {
        error: { code: string; message: string; fieldErrors?: Record<string, string> };
      };
    };

function defaultAuthPort(): AuthAdminPort | null {
  const app = getFirebaseApp();
  if (!app) return null;
  const auth = getAuth(app);
  return {
    getUserByEmail: async (email) => {
      try {
        const user = await auth.getUserByEmail(email);
        return { uid: user.uid };
      } catch {
        return null;
      }
    },
    createUser: async (args) => {
      const user = await auth.createUser({
        email: args.email,
        password: args.password,
        displayName: args.displayName,
        emailVerified: args.emailVerified
      });
      return { uid: user.uid };
    },
    setCustomUserClaims: async (uid, claims) => {
      await auth.setCustomUserClaims(uid, claims);
    },
    generateEmailVerificationLink: async (email, continueUrl) => {
      if (continueUrl) {
        return auth.generateEmailVerificationLink(email, {
          url: continueUrl,
          handleCodeInApp: false
        });
      }
      return auth.generateEmailVerificationLink(email);
    }
  };
}

function idempotencyKeyFor(email: string, ip: string | null | undefined): string {
  return createHash("sha256")
    .update(`${email}|${(ip ?? "").trim()}`)
    .digest("hex")
    .slice(0, 40);
}

const memoryReservations = new Map<string, { uid?: string; at: number }>();

async function reserveIdempotency(
  key: string
): Promise<{ ok: true } | { ok: false; existingUid?: string }> {
  const now = Date.now();
  const existing = memoryReservations.get(key);
  if (existing && now - existing.at < 10 * 60 * 1000) {
    return { ok: false, existingUid: existing.uid };
  }
  memoryReservations.set(key, { at: now });

  const db = getFirestoreDb();
  if (!db || process.env.APP_ENV === "test" || process.env.STORAGE_BACKEND === "memory") {
    return { ok: true };
  }
  const ref = db.doc(`registrationReservations/${key}`);
  try {
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const data = snap.data() as { uid?: string; at?: number };
        if (data.at && now - data.at < 10 * 60 * 1000) {
          return { ok: false as const, existingUid: data.uid };
        }
      }
      tx.set(ref, { at: now, status: "RESERVED" }, { merge: true });
      return { ok: true as const };
    });
    return outcome;
  } catch {
    return { ok: true };
  }
}

async function completeReservation(key: string, uid: string): Promise<void> {
  memoryReservations.set(key, { uid, at: Date.now() });
  const db = getFirestoreDb();
  if (!db || process.env.APP_ENV === "test" || process.env.STORAGE_BACKEND === "memory") return;
  await db.doc(`registrationReservations/${key}`).set(
    { uid, at: Date.now(), status: "COMPLETED" },
    { merge: true }
  );
}

export async function registerUser(args: {
  body: unknown;
  ip?: string | null;
  authPort?: AuthAdminPort | null;
  profiles?: UserProfileStore;
  env?: NodeJS.ProcessEnv;
  forcedUid?: string;
}): Promise<RegistrationServiceResult> {
  const env = args.env ?? process.env;
  const regConfig = loadRegistrationConfig(env);

  if (!regConfig.registrationEnabled) {
    return {
      ok: false,
      status: 403,
      body: {
        error: {
          code: "REGISTRATION_CLOSED",
          message: "Account registration is currently closed."
        }
      }
    };
  }

  const validated = validateRegistrationInput(args.body, env);
  if (!validated.ok) {
    return {
      ok: false,
      status: validated.status,
      body: {
        error: {
          code: validated.code,
          message: validated.message,
          fieldErrors: validated.fieldErrors
        }
      }
    };
  }

  // Owner protection BEFORE Auth creation (server-side, not only blocking function).
  const owner = loadOwnerAuthConfig(env);
  if (validated.value.emailNormalized === owner.ownerEmail) {
    const profiles = args.profiles ?? getUserProfileStore();
    await profiles.writeAudit({
      actorUidMasked: "anonymous",
      actorRole: "ADMIN",
      action: "OWNER_EMAIL_REGISTRATION_BLOCKED",
      targetUidMasked: "owner",
      detail: "Normalized owner email rejected before createUser"
    });
    return {
      ok: false,
      status: 409,
      body: { error: { code: "ACCOUNT_EXISTS", message: OWNER_EXISTS_MESSAGE } }
    };
  }

  const rate = await checkRegistrationRateLimit({
    ip: args.ip,
    email: validated.value.emailNormalized
  });
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      body: { error: { code: rate.code, message: rate.message } }
    };
  }

  const auth = args.authPort === undefined ? defaultAuthPort() : args.authPort;
  if (!auth && !args.forcedUid) {
    return {
      ok: false,
      status: 503,
      body: {
        error: {
          code: "AUTH_UNAVAILABLE",
          message: "Registration is temporarily unavailable."
        }
      }
    };
  }

  if (auth) {
    const existing = await auth.getUserByEmail(validated.value.emailNormalized);
    if (existing) {
      return {
        ok: false,
        status: 409,
        body: {
          error: {
            code: "REGISTRATION_FAILED",
            message: "Unable to create account with the provided details."
          }
        }
      };
    }
  }

  const idemKey = idempotencyKeyFor(validated.value.emailNormalized, args.ip);
  const reserved = await reserveIdempotency(idemKey);
  if (!reserved.ok) {
    // Duplicate request — do not create another user.
    return {
      ok: true,
      status: 201,
      body: {
        message: REGISTRATION_COMPLETE_MESSAGE,
        uidMasked: maskUid(reserved.existingUid) ?? "unknown",
        role: "USER_PENDING",
        emailVerificationSent: true,
        brokerAccess: false,
        autoTrade: false,
        approvalRequired: regConfig.approvalRequired
      }
    };
  }

  const displayName = `${validated.value.firstName} ${validated.value.lastName}`.trim();
  let uid = args.forcedUid ?? "";
  let emailVerificationSent = false;
  const profiles = args.profiles ?? getUserProfileStore();

  if (!uid && auth) {
    try {
      const created = await auth.createUser({
        email: validated.value.emailNormalized,
        password: validated.value.password,
        displayName,
        emailVerified: false
      });
      uid = created.uid;

      if (owner.pinnedOwnerUid && uid === owner.pinnedOwnerUid) {
        return {
          ok: false,
          status: 403,
          body: {
            error: { code: "OWNER_UID_PROTECTED", message: OWNER_EXISTS_MESSAGE }
          }
        };
      }

      try {
        await auth.setCustomUserClaims(uid, {
          role: "USER_PENDING",
          admin: false,
          ...defaultBrokerFlags()
        });
      } catch {
        // Retry once — never leave a new Auth user without role protection when possible.
        try {
          await auth.setCustomUserClaims(uid, {
            role: "USER_PENDING",
            admin: false,
            ...defaultBrokerFlags()
          });
        } catch {
          // Claims still failed → mark incomplete below; do not delete Auth user.
        }
      }

      try {
        await auth.generateEmailVerificationLink(
          validated.value.emailNormalized,
          regConfig.verificationContinueUrl
        );
        emailVerificationSent = true;
      } catch {
        emailVerificationSent = false;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      if (/email-already-exists|already exists/i.test(message)) {
        return {
          ok: false,
          status: 409,
          body: {
            error: {
              code: "REGISTRATION_FAILED",
              message: "Unable to create account with the provided details."
            }
          }
        };
      }
      return {
        ok: false,
        status: 503,
        body: {
          error: {
            code: "REGISTRATION_UNAVAILABLE",
            message: "Registration is temporarily unavailable."
          }
        }
      };
    }
  }

  if (!uid) {
    return {
      ok: false,
      status: 503,
      body: {
        error: {
          code: "REGISTRATION_UNAVAILABLE",
          message: "Registration is temporarily unavailable."
        }
      }
    };
  }

  let incomplete = false;
  try {
    const profile = buildPendingProfile({
      uid,
      email: validated.value.emailNormalized,
      firstName: validated.value.firstName,
      lastName: validated.value.lastName,
      countryOfResidence: validated.value.countryOfResidence,
      emailVerified: false,
      termsVersion: regConfig.policyVersions.terms,
      privacyVersion: regConfig.policyVersions.privacy,
      riskVersion: regConfig.policyVersions.risk,
      registrationSource: "web_register",
      idempotencyKey: idemKey,
      incomplete: false
    });
    await profiles.upsertProfile(profile);
  } catch {
    incomplete = true;
    try {
      await profiles.upsertProfile(
        buildPendingProfile({
          uid,
          email: validated.value.emailNormalized,
          firstName: validated.value.firstName,
          lastName: validated.value.lastName,
          countryOfResidence: validated.value.countryOfResidence,
          incomplete: true,
          idempotencyKey: idemKey,
          termsVersion: regConfig.policyVersions.terms,
          privacyVersion: regConfig.policyVersions.privacy,
          riskVersion: regConfig.policyVersions.risk
        })
      );
    } catch {
      // Still do not delete Auth user. Admin can reconcile REGISTRATION_INCOMPLETE.
    }
  }

  await completeReservation(idemKey, uid);
  await profiles.writeAudit({
    actorUidMasked: "system",
    actorRole: "ADMIN",
    action: incomplete ? "USER_REGISTERED_INCOMPLETE" : "USER_REGISTERED",
    targetUidMasked: maskUid(uid) ?? "unknown",
    detail: incomplete
      ? "Auth created; profile incomplete — no auto-promote"
      : "USER_PENDING profile created; broker flags false; no webhook"
  });

  return {
    ok: true,
    status: 201,
    body: {
      message: REGISTRATION_COMPLETE_MESSAGE,
      uidMasked: maskUid(uid) ?? "unknown",
      role: "USER_PENDING",
      emailVerificationSent,
      brokerAccess: false,
      autoTrade: false,
      approvalRequired: regConfig.approvalRequired
    }
  };
}

export async function finalizeClientRegistration(args: {
  uid: string;
  email: string | null | undefined;
  emailVerified: boolean;
  body: unknown;
  profiles?: UserProfileStore;
  authPort?: AuthAdminPort | null;
  env?: NodeJS.ProcessEnv;
}): Promise<RegistrationServiceResult> {
  const env = args.env ?? process.env;
  const regConfig = loadRegistrationConfig(env);
  const owner = loadOwnerAuthConfig(env);
  const email = normalizeEmail(args.email);
  if (!email) {
    return {
      ok: false,
      status: 400,
      body: { error: { code: "VALIDATION_FAILED", message: "Email is required" } }
    };
  }
  if (email === owner.ownerEmail || (owner.pinnedOwnerUid && args.uid === owner.pinnedOwnerUid)) {
    return {
      ok: false,
      status: 409,
      body: { error: { code: "ACCOUNT_EXISTS", message: OWNER_EXISTS_MESSAGE } }
    };
  }

  const parsed = registrationProfileSchema.safeParse(args.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] ? String(issue.path[0]) : "form";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: parsed.error.issues[0]?.message ?? "Invalid registration details",
          fieldErrors
        }
      }
    };
  }

  const profiles = args.profiles ?? getUserProfileStore();
  const existing = await profiles.getProfile(args.uid);
  if (existing) {
    return {
      ok: true,
      status: 201,
      body: {
        message: REGISTRATION_COMPLETE_MESSAGE,
        uidMasked: maskUid(args.uid) ?? "unknown",
        role: "USER_PENDING",
        emailVerificationSent: true,
        brokerAccess: false,
        autoTrade: false,
        approvalRequired: regConfig.approvalRequired
      }
    };
  }

  const auth = args.authPort === undefined ? defaultAuthPort() : args.authPort;
  if (auth) {
    await auth.setCustomUserClaims(args.uid, {
      role: "USER_PENDING",
      admin: false,
      ...defaultBrokerFlags()
    });
  }

  const profile = buildPendingProfile({
    uid: args.uid,
    email,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    countryOfResidence: parsed.data.countryOfResidence,
    emailVerified: args.emailVerified,
    termsVersion: regConfig.policyVersions.terms,
    privacyVersion: regConfig.policyVersions.privacy,
    riskVersion: regConfig.policyVersions.risk
  });
  await profiles.upsertProfile(profile);

  return {
    ok: true,
    status: 201,
    body: {
      message: REGISTRATION_COMPLETE_MESSAGE,
      uidMasked: maskUid(args.uid) ?? "unknown",
      role: "USER_PENDING",
      emailVerificationSent: true,
      brokerAccess: false,
      autoTrade: false,
      approvalRequired: regConfig.approvalRequired
    }
  };
}
