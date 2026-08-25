import type { RequestHandler } from "express";
import { tryActivateVerifiedPendingUser } from "../services/auth/activateVerifiedUser";
import {
  BROKER_ACCESS_DISABLED_MESSAGE,
  canAccessApprovedApp,
  type AccountRole
} from "../services/auth/roles";
import { getUserProfileStore } from "../services/auth/userProfileStore";

function roleOf(req: { accountRole?: AccountRole }): AccountRole {
  return req.accountRole ?? "USER_PENDING";
}

/** Email must be verified (staff/owner exempt). */
export const requireEmailVerified: RequestHandler = (req, res, next) => {
  const role = roleOf(req);
  if (role === "OWNER" || role === "ADMIN") {
    next();
    return;
  }
  if (req.emailVerified === false) {
    res.status(403).json({
      error: {
        code: "EMAIL_NOT_VERIFIED",
        message: "Verify your email address before continuing."
      }
    });
    return;
  }
  next();
};

/** Suspended accounts cannot use the API (except auth status). */
export const rejectSuspended: RequestHandler = (req, res, next) => {
  if (roleOf(req) === "USER_SUSPENDED") {
    res.status(403).json({
      error: {
        code: "ACCOUNT_SUSPENDED",
        message: "This account has been suspended."
      }
    });
    return;
  }
  next();
};

/**
 * Full app surfaces — pending users blocked.
 * Legacy authenticated users (no role claim, no registration profile) retain
 * analysis access. Explicit USER_PENDING profiles/claims remain gated.
 */
export const requireApprovedAccount: RequestHandler = async (req, res, next) => {
  const role = roleOf(req);
  if (canAccessApprovedApp(role)) {
    next();
    return;
  }
  if (role === "USER_SUSPENDED") {
    res.status(403).json({
      error: {
        code: "ACCOUNT_SUSPENDED",
        message: "This account has been suspended."
      }
    });
    return;
  }

  const uid = req.userId;
  if (uid) {
    try {
      // Open registration: verified pending users activate on first gated request.
      const emailVerified = req.emailVerified !== false;
      if (role === "USER_PENDING" && emailVerified) {
        const activation = await tryActivateVerifiedPendingUser({
          uid,
          emailVerified
        });
        if (activation.activated || activation.alreadyApproved) {
          req.accountRole = "USER_APPROVED";
          next();
          return;
        }
      }

      const profile = await getUserProfileStore().getProfile(uid);
      if (profile) {
        if (canAccessApprovedApp(profile.role)) {
          next();
          return;
        }
        res.status(403).json({
          error: {
            code:
              profile.role === "USER_PENDING" || profile.approvalStatus === "PENDING"
                ? "AWAITING_APPROVAL"
                : "FORBIDDEN",
            message:
              profile.role === "USER_PENDING"
                ? "Your account is awaiting approval."
                : "Access denied."
          }
        });
        return;
      }
      // No registration profile: legacy pre-registration user.
      if (req.legacyUnclaimed) {
        next();
        return;
      }
    } catch {
      // Fail closed on store errors for pending-looking tokens.
    }
  }

  res.status(403).json({
    error: {
      code: role === "USER_PENDING" ? "AWAITING_APPROVAL" : "FORBIDDEN",
      message:
        role === "USER_PENDING"
          ? "Your account is awaiting approval."
          : "Access denied."
    }
  });
};

/**
 * Broker / webhook / AutoTrade connect surfaces.
 * - OWNER / ADMIN always allowed.
 * - USER_PENDING / SUSPENDED denied.
 * - USER_APPROVED (verified active) may configure AutoTrade and connect their own broker.
 * - brokerAccess=false no longer blocks configure/connect for approved users.
 * - Execution / order submission remains hard-disabled by feature flags.
 * - Legacy accounts without a registration profile keep prior route access.
 */
export const requireBrokerEligible: RequestHandler = async (req, res, next) => {
  const role = roleOf(req);
  if (role === "OWNER") {
    next();
    return;
  }
  if (role === "USER_SUSPENDED") {
    res.status(403).json({
      error: {
        code: "BROKER_ACCESS_DISABLED",
        message: BROKER_ACCESS_DISABLED_MESSAGE
      }
    });
    return;
  }
  // Explicit pending (has role claim or registration profile) — not legacy unclaimed.
  if (role === "USER_PENDING" && !req.legacyUnclaimed) {
    res.status(403).json({
      error: {
        code: "BROKER_ACCESS_DISABLED",
        message: BROKER_ACCESS_DISABLED_MESSAGE
      }
    });
    return;
  }
  const uid = req.userId;
  if (!uid) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    return;
  }
  try {
    const profile = await getUserProfileStore().getProfile(uid);
    if (profile) {
      if (profile.role === "USER_PENDING" || profile.role === "USER_SUSPENDED") {
        res.status(403).json({
          error: {
            code: "BROKER_ACCESS_DISABLED",
            message: BROKER_ACCESS_DISABLED_MESSAGE
          }
        });
        return;
      }
      // Verified active users may configure AutoTrade / connect brokers.
      // Execution remains hard-disabled by feature flags until separately approved.
      // brokerAccess=false no longer blocks the configure/connect UI for approved users.
      const approved =
        profile.role === "USER_APPROVED" ||
        profile.role === "OWNER" ||
        profile.role === "ADMIN";
      if (!approved && profile.brokerAccess !== true) {
        res.status(403).json({
          error: {
            code: "BROKER_ACCESS_DISABLED",
            message: BROKER_ACCESS_DISABLED_MESSAGE
          }
        });
        return;
      }
    }
    // No profile → legacy: allow broker *routes* but execution flags stay false.
  } catch {
    res.status(403).json({
      error: {
        code: "BROKER_ACCESS_DISABLED",
        message: BROKER_ACCESS_DISABLED_MESSAGE
      }
    });
    return;
  }
  next();
};

/** Convenience chain for approved analysis APIs. */
export const approvedAccountGate: RequestHandler[] = [
  rejectSuspended,
  requireEmailVerified,
  requireApprovedAccount
];

export const brokerGate: RequestHandler[] = [
  rejectSuspended,
  requireEmailVerified,
  requireBrokerEligible
];
