/**
 * Durable registration abuse limits — Firestore-backed with in-memory fallback.
 * Limits are server-authoritative and do not trust the browser.
 */

import { createHash } from "crypto";
import { getFirestoreDb } from "../firebaseAdmin";

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; code: "RATE_LIMITED"; message: string; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

const memory = new Map<string, Bucket>();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

/** Conservative production defaults from PR #34 security review. */
export const RATE_LIMITS = {
  registrationPerIpPerHour: 3,
  registrationPerEmailAttemptsPerHour: 3,
  registrationGlobalPerMinute: 20,
  verificationResendPerDay: 3,
  passwordResetPerEmailPerDay: 5,
  adminActionPerActorPerHour: 60
} as const;

function hashValue(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

function decisionDenied(resetAt: number): RateLimitDecision {
  return {
    allowed: false,
    code: "RATE_LIMITED",
    message: "Too many attempts. Please try again later.",
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
  };
}

async function touchDurable(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitDecision> {
  const now = Date.now();
  const db = getFirestoreDb();

  // Always update memory (test + multi-check within process).
  const mem = memory.get(key);
  if (!mem || mem.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
  } else if (mem.count >= max) {
    return decisionDenied(mem.resetAt);
  } else {
    mem.count += 1;
  }

  if (!db || process.env.APP_ENV === "test" || process.env.STORAGE_BACKEND === "memory") {
    const latest = memory.get(key)!;
    if (latest.count > max) return decisionDenied(latest.resetAt);
    return { allowed: true };
  }

  const ref = db.doc(`rateLimits/${key}`);
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as Bucket) : null;
      if (!data || data.resetAt <= now) {
        const next = { count: 1, resetAt: now + windowMs };
        tx.set(ref, next);
        return { allowed: true as const };
      }
      if (data.count >= max) {
        return { allowed: false as const, resetAt: data.resetAt };
      }
      tx.set(ref, { count: data.count + 1, resetAt: data.resetAt }, { merge: true });
      return { allowed: true as const };
    });
    if (!result.allowed) return decisionDenied(result.resetAt);
    return { allowed: true };
  } catch {
    // Fail closed on limiter errors in production.
    if (process.env.APP_ENV === "production") {
      return {
        allowed: false,
        code: "RATE_LIMITED",
        message: "Too many attempts. Please try again later.",
        retryAfterSeconds: 60
      };
    }
    return { allowed: true };
  }
}

export async function checkRegistrationRateLimit(args: {
  ip: string | null | undefined;
  email: string;
}): Promise<RateLimitDecision> {
  const ipKey = `reg-ip:${hashValue(args.ip ?? "unknown")}`;
  const emailKey = `reg-email:${hashValue(args.email)}`;
  const globalKey = `reg-global:burst`;

  const global = await touchDurable(
    globalKey,
    RATE_LIMITS.registrationGlobalPerMinute,
    MINUTE_MS
  );
  if (!global.allowed) return global;

  const ip = await touchDurable(ipKey, RATE_LIMITS.registrationPerIpPerHour, HOUR_MS);
  if (!ip.allowed) return ip;

  return touchDurable(emailKey, RATE_LIMITS.registrationPerEmailAttemptsPerHour, HOUR_MS);
}

export async function checkVerificationResendRateLimit(args: {
  uid: string;
}): Promise<RateLimitDecision> {
  return touchDurable(
    `verify:${hashValue(args.uid)}`,
    RATE_LIMITS.verificationResendPerDay,
    DAY_MS
  );
}

export async function checkPasswordResetRateLimit(args: {
  email: string;
  ip?: string | null;
}): Promise<RateLimitDecision> {
  const email = await touchDurable(
    `pwreset-email:${hashValue(args.email)}`,
    RATE_LIMITS.passwordResetPerEmailPerDay,
    DAY_MS
  );
  if (!email.allowed) return email;
  if (args.ip) {
    return touchDurable(
      `pwreset-ip:${hashValue(args.ip)}`,
      RATE_LIMITS.passwordResetPerEmailPerDay,
      DAY_MS
    );
  }
  return { allowed: true };
}

export async function checkAdminActionRateLimit(args: {
  actorUid: string;
}): Promise<RateLimitDecision> {
  return touchDurable(
    `admin:${hashValue(args.actorUid)}`,
    RATE_LIMITS.adminActionPerActorPerHour,
    HOUR_MS
  );
}

export function resetRegistrationRateLimits(): void {
  memory.clear();
}
