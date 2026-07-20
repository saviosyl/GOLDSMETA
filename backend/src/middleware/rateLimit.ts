import type { RequestHandler } from "express";
import { env } from "../config/env";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export const createRateLimit = (prefix: string): RequestHandler => {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${prefix}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + env.WEBHOOK_RATE_LIMIT_WINDOW_MS
      });
      next();
      return;
    }

    if (bucket.count >= env.WEBHOOK_RATE_LIMIT_MAX) {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
      return;
    }

    bucket.count += 1;
    next();
  };
};

export const resetRateLimits = (): void => {
  buckets.clear();
};
