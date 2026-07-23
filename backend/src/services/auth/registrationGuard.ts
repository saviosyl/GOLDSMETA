/**
 * Pure decision logic for Auth beforeUserCreated blocking.
 * Rejects all public registration; allows owner email only with pinned UID
 * (controlled restore/import path that still goes through client/Identity Toolkit).
 */

import { normalizeEmail, type OwnerAuthConfig } from "./ownerAuthConfig";

export type RegistrationDecision =
  | { allow: true; reason: "PINNED_OWNER_RESTORE" }
  | {
      allow: false;
      code:
        | "CONFIGURATION_MISSING"
        | "REGISTRATION_CLOSED"
        | "OWNER_UID_MISMATCH"
        | "OWNER_EMAIL_REQUIRES_PINNED_UID";
      message: string;
    };

export function evaluateUserCreation(args: {
  email: string | null | undefined;
  uid: string | null | undefined;
  config: OwnerAuthConfig;
}): RegistrationDecision {
  const email = normalizeEmail(args.email);
  const uid = (args.uid ?? "").trim();
  const { ownerEmail, pinnedOwnerUid } = args.config;

  if (!ownerEmail || !pinnedOwnerUid) {
    return {
      allow: false,
      code: "CONFIGURATION_MISSING",
      message: "Account registration is currently closed."
    };
  }

  // GoldMeta is a private owner application — reject all random signups.
  if (!email || email !== ownerEmail) {
    return {
      allow: false,
      code: "REGISTRATION_CLOSED",
      message: "Account registration is currently closed."
    };
  }

  if (!uid) {
    return {
      allow: false,
      code: "OWNER_EMAIL_REQUIRES_PINNED_UID",
      message: "Account registration is currently closed."
    };
  }

  if (uid !== pinnedOwnerUid) {
    return {
      allow: false,
      code: "OWNER_UID_MISMATCH",
      message: "Account registration is currently closed."
    };
  }

  // Controlled restore/import of the exact pinned owner UID.
  return { allow: true, reason: "PINNED_OWNER_RESTORE" };
}
