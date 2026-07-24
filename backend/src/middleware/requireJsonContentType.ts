import type { RequestHandler } from "express";

/**
 * Strict JSON content-type for registration / password-reset abuse surfaces.
 * Webhook routes keep separate text/plain allowance at the app level.
 */
export const requireJsonContentType: RequestHandler = (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const raw = (req.header("content-type") ?? "").toLowerCase();
  if (!raw.includes("application/json")) {
    res.status(415).json({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json."
      }
    });
    return;
  }
  next();
};
