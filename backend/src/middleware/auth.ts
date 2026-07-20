import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { verifyFirebaseIdToken } from "../services/firebaseAdmin";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (env.NODE_ENV === "test") {
    const testUserId = req.header("x-test-user-id");
    if (testUserId) {
      req.userId = testUserId;
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
    next();
  } catch {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid authentication token" } });
  }
};

export const getAuthenticatedUserId = (req: Request): string => req.userId ?? "unknown-user";
