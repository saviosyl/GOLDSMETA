/**
 * IP + email registration abuse limits (in-memory; fail-closed on excess).
 */

import { createHash } from "crypto";

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; code: "RATE_LIMITED"; message: string; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

const ipBuckets = new Map<string, Bucket>();
const emailBuckets = new Map<string, Bucket>();

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_PER_EMAIL = 5;
const VERIFY_RESEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_RESEND = 3;

const verifyBuckets = new Map<string, Bucket>();

function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);
}

function touch(
  map: Map<string, Bucket>,
  key: string,
  max: number,
  windowMs: number
): RateLimitDecision {
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (existing.count >= max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      allowed: false,
      code: "RATE_LIMITED",
      message: "Too many attempts. Please try again later.",
      retryAfterSeconds
    };
  }
  existing.count += 1;
  return { allowed: true };
}

export function checkRegistrationRateLimit(args: {
  ip: string | null | undefined;
  email: string;
}): RateLimitDecision {
  const ipKey = (args.ip ?? "unknown").trim() || "unknown";
  const ipDecision = touch(ipBuckets, `reg-ip:${ipKey}`, MAX_PER_IP, WINDOW_MS);
  if (!ipDecision.allowed) return ipDecision;
  return touch(emailBuckets, `reg-email:${hashEmail(args.email)}`, MAX_PER_EMAIL, WINDOW_MS);
}

export function checkVerificationResendRateLimit(args: {
  uid: string;
}): RateLimitDecision {
  return touch(
    verifyBuckets,
    `verify:${args.uid}`,
    MAX_VERIFY_RESEND,
    VERIFY_RESEND_WINDOW_MS
  );
}

export function resetRegistrationRateLimits(): void {
  ipBuckets.clear();
  emailBuckets.clear();
  verifyBuckets.clear();
}
