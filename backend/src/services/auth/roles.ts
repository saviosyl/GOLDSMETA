/**
 * Server-authoritative account roles for GoldMeta registration/approval.
 * Only the pinned owner UID may hold OWNER. Browser cannot choose roles.
 */

export const ACCOUNT_ROLES = [
  "OWNER",
  "ADMIN",
  "USER_APPROVED",
  "USER_PENDING",
  "USER_SUSPENDED"
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED"
  | "REGISTRATION_INCOMPLETE";

export const OWNER_EXISTS_MESSAGE =
  "This account already exists. Please use Sign In or Forgot Password.";

export const OWNER_EXISTS_REGISTER_HINT =
  "This account already exists. Use Forgot Password to recover access.";

export const REGISTRATION_COMPLETE_MESSAGE =
  "Account created. Please verify your email. Your account activates automatically after verification.";

export const REGISTRATION_COMPLETE_APPROVAL_MESSAGE =
  "Account created. Please verify your email. Your account will then be reviewed before full access is enabled.";

export const ACCOUNT_READY_MESSAGE =
  "Your email has been verified and your GoldMeta account is now active.";

export const BROKER_ACCESS_DISABLED_MESSAGE =
  "Broker access has not been enabled for this account.";

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === "string" && (ACCOUNT_ROLES as readonly string[]).includes(value);
}

/**
 * Resolve role from token claims only.
 * Returns null when no trusted role claim is present — callers must distinguish
 * legacy pre-registration users (allow analysis) from explicit USER_PENDING.
 */
export function roleFromClaims(claims: {
  role?: unknown;
  admin?: unknown;
  uid?: string;
  pinnedOwnerUid?: string | null;
}): AccountRole | null {
  const pinned = (claims.pinnedOwnerUid ?? "").trim();
  const uid = (claims.uid ?? "").trim();
  if (pinned && uid && uid === pinned) {
    return "OWNER";
  }
  if (isAccountRole(claims.role)) {
    return claims.role;
  }
  // Legacy admin claim without role → ADMIN (never OWNER).
  if (claims.admin === true) {
    return "ADMIN";
  }
  return null;
}

/**
 * Effective request role:
 * - explicit claims / pinned owner win
 * - otherwise USER_PENDING (fail-closed for gated surfaces unless a gate
 *   confirms legacy: no registration profile).
 */
export function effectiveRequestRole(claimsRole: AccountRole | null): AccountRole {
  return claimsRole ?? "USER_PENDING";
}

export function isStaffRole(role: AccountRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canAccessApprovedApp(role: AccountRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "USER_APPROVED";
}

export function canAccessAccountPages(role: AccountRole): boolean {
  return role !== "USER_SUSPENDED";
}

export function defaultBrokerFlags() {
  return {
    brokerAccess: false,
    brokerExecution: false,
    autoTrade: false,
    liveTrading: false,
    demoOrderSubmission: false
  } as const;
}

export function approvalStatusForRole(role: AccountRole): ApprovalStatus {
  switch (role) {
    case "OWNER":
    case "ADMIN":
    case "USER_APPROVED":
      return "APPROVED";
    case "USER_SUSPENDED":
      return "SUSPENDED";
    case "USER_PENDING":
    default:
      return "PENDING";
  }
}
