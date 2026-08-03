/**
 * Client-side verification email send controls.
 * Ensures one initial send per registration and a 60s UI cooldown on resend.
 * Does not store passwords or verification links.
 */

export const VERIFICATION_EMAIL_COOLDOWN_MS = 60_000;

export const VERIFICATION_SENT_MESSAGE =
  "A verification email has been sent. Please check your inbox and spam folder.";

const COOLDOWN_KEY = "gm.verifyEmail.cooldownUntil";
const INITIAL_SENT_KEY = "gm.verifyEmail.initialSentUid";

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function getVerificationCooldownRemainingMs(now = Date.now()): number {
  const raw = storage()?.getItem(COOLDOWN_KEY);
  if (!raw) return 0;
  const until = Number(raw);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - now);
}

export function isVerificationResendAllowed(now = Date.now()): boolean {
  return getVerificationCooldownRemainingMs(now) <= 0;
}

export function markVerificationEmailSent(uid: string | null | undefined, now = Date.now()): void {
  const store = storage();
  if (!store) return;
  store.setItem(COOLDOWN_KEY, String(now + VERIFICATION_EMAIL_COOLDOWN_MS));
  if (uid) store.setItem(INITIAL_SENT_KEY, uid);
}

export function wasInitialVerificationSentFor(uid: string | null | undefined): boolean {
  if (!uid) return false;
  return storage()?.getItem(INITIAL_SENT_KEY) === uid;
}

export function formatResendCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `Resend available in ${seconds}s`;
}

export function clearVerificationEmailSessionState(): void {
  const store = storage();
  if (!store) return;
  store.removeItem(COOLDOWN_KEY);
  store.removeItem(INITIAL_SENT_KEY);
}
