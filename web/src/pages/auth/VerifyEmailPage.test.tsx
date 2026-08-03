import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { VerifyEmailPage } from "./StatusPages";
import {
  clearVerificationEmailSessionState,
  markVerificationEmailSent
} from "../../lib/verificationEmail";

const sendVerificationEmail = vi.fn();
const refreshAccount = vi.fn();
const signOut = vi.fn();

vi.mock("../../lib/firebase", () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args)
}));

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "uid-1", email: "ada@example.com", emailVerified: false },
    signOut,
    refreshAccount
  })
}));

describe("VerifyEmailPage resend controls", () => {
  beforeEach(() => {
    clearVerificationEmailSessionState();
    sendVerificationEmail.mockReset();
    refreshAccount.mockReset();
    signOut.mockReset();
    sendVerificationEmail.mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
  });

  afterEach(() => {
    clearVerificationEmailSessionState();
    vi.useRealTimers();
  });

  it("shows verification sent copy and disables resend during cooldown", async () => {
    markVerificationEmailSent("uid-1");
    render(
      <MemoryRouter>
        <VerifyEmailPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("verify-email-page")).toHaveTextContent(
      /A verification email has been sent/i
    );
    const btn = screen.getByTestId("resend-verification");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/Resend available in/i);
  });

  it("sends via client SDK once when cooldown elapsed and arms cooldown again", async () => {
    render(
      <MemoryRouter>
        <VerifyEmailPage />
      </MemoryRouter>
    );
    const btn = screen.getByTestId("resend-verification");
    expect(btn).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("resend-verification")).toBeDisabled();
  });

  it("shows friendly copy for TOO_MANY_ATTEMPTS and still arms cooldown", async () => {
    sendVerificationEmail.mockRejectedValueOnce(
      new Error("Too many verification attempts. Please wait a few minutes, then try Resend again.")
    );
    render(
      <MemoryRouter>
        <VerifyEmailPage />
      </MemoryRouter>
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("resend-verification"));
    });
    expect(screen.getByTestId("verify-email-status")).toHaveTextContent(/Too many verification/i);
    expect(screen.getByTestId("resend-verification")).toBeDisabled();
  });

  it("does not auto-send on mount/reload", () => {
    render(
      <MemoryRouter>
        <VerifyEmailPage />
      </MemoryRouter>
    );
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});
