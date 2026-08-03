import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VERIFICATION_EMAIL_COOLDOWN_MS,
  clearVerificationEmailSessionState,
  formatResendCountdown,
  getVerificationCooldownRemainingMs,
  isVerificationResendAllowed,
  markVerificationEmailSent,
  wasInitialVerificationSentFor
} from "./verificationEmail";

describe("verificationEmail controls", () => {
  beforeEach(() => {
    clearVerificationEmailSessionState();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
  });

  afterEach(() => {
    clearVerificationEmailSessionState();
    vi.useRealTimers();
  });

  it("allows resend before any send", () => {
    expect(isVerificationResendAllowed()).toBe(true);
    expect(getVerificationCooldownRemainingMs()).toBe(0);
  });

  it("arms a 60s cooldown after a send and blocks reload-style repeats for same uid", () => {
    markVerificationEmailSent("uid-1");
    expect(wasInitialVerificationSentFor("uid-1")).toBe(true);
    expect(wasInitialVerificationSentFor("uid-2")).toBe(false);
    expect(isVerificationResendAllowed()).toBe(false);
    expect(getVerificationCooldownRemainingMs()).toBe(VERIFICATION_EMAIL_COOLDOWN_MS);

    vi.advanceTimersByTime(30_000);
    expect(isVerificationResendAllowed()).toBe(false);
    expect(formatResendCountdown(getVerificationCooldownRemainingMs())).toBe(
      "Resend available in 30s"
    );

    vi.advanceTimersByTime(30_000);
    expect(isVerificationResendAllowed()).toBe(true);
  });

  it("does not treat a different uid as already initially sent", () => {
    markVerificationEmailSent("uid-a");
    expect(wasInitialVerificationSentFor("uid-b")).toBe(false);
  });
});
