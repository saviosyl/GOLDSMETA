/**
 * Pure decision logic for Auth beforeUserCreated blocking.
 * - Allows controlled restore of the pinned owner UID.
 * - Rejects any new Auth user for the protected owner email.
 * - Allows public registration for other emails when enabled.
 */

import { normalizeEmail, type OwnerAuthConfig } from "./ownerAuthConfig";
import { OWNER_EXISTS_MESSAGE } from "./roles";

export type RegistrationDecision =
  | { allow: true; reason: "PINNED_OWNER_RESTORE" | "PUBLIC_REGISTRATION" }
  | {
      allow: false;
      code:
        | "CONFIGURATION_MISSING"
        | "REGISTRATION_CLOSED"
        | "OWNER_UID_MISMATCH"
        | "OWNER_EMAIL_REQUIRES_PINNED_UID"
        | "OWNER_ACCOUNT_EXISTS";
      message: string;
    };

import { loadRegistrationConfig } from "./registrationConfig";

export function isPublicRegistrationEnabled(
  source: NodeJS.ProcessEnv = process.env
): boolean {
  return loadRegistrationConfig(source).registrationEnabled;
}

export function evaluateUserCreation(args: {
  email: string | null | undefined;
  uid: string | null | undefined;
  config: OwnerAuthConfig;
  publicRegistrationEnabled?: boolean;
}): RegistrationDecision {
  const email = normalizeEmail(args.email);
  const uid = (args.uid ?? "").trim();
  const { ownerEmail, pinnedOwnerUid } = args.config;
  const publicEnabled =
    args.publicRegistrationEnabled ?? isPublicRegistrationEnabled();

  if (!ownerEmail || !pinnedOwnerUid) {
    return {
      allow: false,
      code: "CONFIGURATION_MISSING",
      message: "Account registration is temporarily unavailable."
    };
  }

  // Protected owner email: never create a replacement Auth user.
  if (email && email === ownerEmail) {
    if (uid && uid === pinnedOwnerUid) {
      return { allow: true, reason: "PINNED_OWNER_RESTORE" };
    }
    return {
      allow: false,
      code: uid ? "OWNER_UID_MISMATCH" : "OWNER_EMAIL_REQUIRES_PINNED_UID",
      message: OWNER_EXISTS_MESSAGE
    };
  }

  if (!publicEnabled) {
    return {
      allow: false,
      code: "REGISTRATION_CLOSED",
      message: "Account registration is currently closed."
    };
  }

  if (!email) {
    return {
      allow: false,
      code: "REGISTRATION_CLOSED",
      message: "Account registration requires a valid email address."
    };
  }

  // Never allow binding a non-owner email onto the pinned owner UID.
  if (uid && uid === pinnedOwnerUid) {
    return {
      allow: false,
      code: "OWNER_UID_MISMATCH",
      message: OWNER_EXISTS_MESSAGE
    };
  }

  return { allow: true, reason: "PUBLIC_REGISTRATION" };
}
