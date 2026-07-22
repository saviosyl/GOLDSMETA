import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { verifyFirebaseIdToken } from "../services/firebaseAdmin";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      /** True when Firebase custom claim `admin: true` is present (or test header). */
      isAdmin?: boolean;
    }
  }
}

export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (env.ALLOW_TEST_AUTH_HEADER) {
    const testUserId = req.header("x-test-user-id");
    if (testUserId) {
      req.userId = testUserId;
      req.isAdmin = req.header("x-test-admin") === "true";
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
    req.userId = decoded.uid;
    req.isAdmin = decoded.admin === true;
    next();
  } catch {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid authentication token" } });
  }
};

/** Requires a prior successful `requireAuth` and Firebase claim `admin: true`. */
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
