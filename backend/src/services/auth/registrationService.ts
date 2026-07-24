/**
 * Controlled registration — Admin SDK create path (does not use client createUser).
 * Never creates TradingView webhooks, broker connections, or owner data copies.
 */

import { getFirebaseApp } from "../firebaseAdmin";
import { getAuth } from "firebase-admin/auth";
import { loadOwnerAuthConfig, maskUid, normalizeEmail } from "./ownerAuthConfig";
import { checkRegistrationRateLimit } from "./registrationRateLimit";
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
  generateEmailVerificationLink: (email: string) => Promise<string>;
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
    generateEmailVerificationLink: async (email) => {
      return auth.generateEmailVerificationLink(email);
    }
  };
}

export async function registerUser(args: {
  body: unknown;
  ip?: string | null;
  authPort?: AuthAdminPort | null;
  profiles?: UserProfileStore;
  env?: NodeJS.ProcessEnv;
  /** Test-only: skip Auth create and use fixed uid */
  forcedUid?: string;
}): Promise<RegistrationServiceResult> {
  const env = args.env ?? process.env;
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

  const rate = checkRegistrationRateLimit({
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

  const owner = loadOwnerAuthConfig(env);
  if (validated.value.emailNormalized === owner.ownerEmail) {
    return {
      ok: false,
      status: 409,
      body: { error: { code: "ACCOUNT_EXISTS", message: OWNER_EXISTS_MESSAGE } }
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
      // Generic — do not confirm arbitrary emails exist except owner message above.
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

  const displayName = `${validated.value.firstName} ${validated.value.lastName}`.trim();
  let uid = args.forcedUid ?? "";
  let emailVerificationSent = false;

  if (!uid && auth) {
    try {
      const created = await auth.createUser({
        email: validated.value.emailNormalized,
        password: validated.value.password,
        displayName,
        emailVerified: false
      });
      uid = created.uid;
      await auth.setCustomUserClaims(uid, {
        role: "USER_PENDING",
        admin: false,
        ...defaultBrokerFlags()
      });
      try {
        await auth.generateEmailVerificationLink(validated.value.emailNormalized);
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

  // Never allow creating a second Auth user for the pinned owner UID.
  if (owner.pinnedOwnerUid && uid === owner.pinnedOwnerUid) {
    return {
      ok: false,
      status: 403,
      body: {
        error: {
          code: "OWNER_UID_PROTECTED",
          message: OWNER_EXISTS_MESSAGE
        }
      }
    };
  }

  const profiles = args.profiles ?? getUserProfileStore();
  const profile = buildPendingProfile({
    uid,
    email: validated.value.emailNormalized,
    firstName: validated.value.firstName,
    lastName: validated.value.lastName,
    countryOfResidence: validated.value.countryOfResidence,
    emailVerified: false
  });
  await profiles.upsertProfile(profile);
  await profiles.writeAudit({
    actorUidMasked: "system",
    actorRole: "ADMIN",
    action: "USER_REGISTERED",
    targetUidMasked: maskUid(uid) ?? "unknown",
    detail: "USER_PENDING profile created; broker flags false; no webhook"
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
      autoTrade: false
    }
  };
}

/** Client finalize path after createUserWithEmailAndPassword + verification send. */
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
        autoTrade: false
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
    emailVerified: args.emailVerified
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
      autoTrade: false
    }
  };
}
