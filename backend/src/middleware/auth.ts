import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { verifyFirebaseIdToken } from "../services/firebaseAdmin";
import { loadOwnerAuthConfig } from "../services/auth/ownerAuthConfig";
import {
  isAccountRole,
  isStaffRole,
  roleFromClaims,
  type AccountRole
} from "../services/auth/roles";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      /** True when Firebase custom claim `admin: true` or staff role. */
      isAdmin?: boolean;
      accountRole?: AccountRole;
      emailVerified?: boolean;
    }
  }
}

function applyRoleToRequest(
  req: Request,
  args: { uid: string; roleHint?: unknown; adminClaim?: boolean; emailVerified?: boolean }
): void {
  const owner = loadOwnerAuthConfig();
  const role = roleFromClaims({
    role: args.roleHint,
    admin: args.adminClaim,
    uid: args.uid,
    pinnedOwnerUid: owner.pinnedOwnerUid
  });
  req.userId = args.uid;
  req.accountRole = role;
  req.isAdmin = args.adminClaim === true || isStaffRole(role);
  req.emailVerified = args.emailVerified ?? true;
}

export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (env.ALLOW_TEST_AUTH_HEADER) {
    const testUserId = req.header("x-test-user-id");
    if (testUserId) {
      const roleHeader = req.header("x-test-role");
      const roleHint = isAccountRole(roleHeader)
        ? roleHeader
        : req.header("x-test-admin") === "true"
          ? "ADMIN"
          : "USER_APPROVED";
      applyRoleToRequest(req, {
        uid: testUserId,
        roleHint,
        adminClaim: req.header("x-test-admin") === "true" || roleHint === "ADMIN" || roleHint === "OWNER",
        emailVerified: req.header("x-test-email-verified") !== "false"
      });
      next();
      return;
    }
  }

  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    return;
  }

  try {
    const decoded = await verifyFirebaseIdToken(token);
    if (!decoded) {
      res.status(503).json({ error: { code: "AUTH_UNAVAILABLE", message: "Auth service unavailable" } });
      return;
    }
    applyRoleToRequest(req, {
      uid: decoded.uid,
      roleHint: (decoded as { role?: unknown }).role,
      adminClaim: decoded.admin === true,
      emailVerified: decoded.email_verified === true
    });
    next();
  } catch {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid authentication token" } });
  }
};

/** Requires a prior successful `requireAuth` and staff role (OWNER/ADMIN) or admin claim. */
export const requireAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userId) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    return;
  }
  if (!req.isAdmin) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin access required" } });
    return;
  }
  next();
};

export const getAuthenticatedUserId = (req: Request): string => req.userId ?? "unknown-user";
