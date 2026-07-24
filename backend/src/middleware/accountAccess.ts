import type { RequestHandler } from "express";
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
 * - OWNER always allowed (existing production owner).
 * - USER_PENDING / SUSPENDED denied.
 * - Profiles with brokerAccess=false denied (new registrations).
 * - Legacy accounts without a registration profile keep prior access
 *   (execution flags remain server-disabled).
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
      if (profile.brokerAccess !== true) {
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
