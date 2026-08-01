import { beforeEach, describe, expect, it, vi } from "vitest";

const createUserWithEmailAndPassword = vi.fn();
const sendEmailVerification = vi.fn();
const signInWithEmailAndPassword = vi.fn();

vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({}))
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: (...args: unknown[]) => signInWithEmailAndPassword(...args),
  createUserWithEmailAndPassword: (...args: unknown[]) => createUserWithEmailAndPassword(...args),
  sendEmailVerification: (...args: unknown[]) => sendEmailVerification(...args),
  sendPasswordResetEmail: vi.fn(),
  signOut: vi.fn()
}));

describe("firebase registration", () => {
  beforeEach(() => {
    createUserWithEmailAndPassword.mockReset();
    sendEmailVerification.mockReset();
    signInWithEmailAndPassword.mockReset();
    vi.resetModules();
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "example.firebaseapp.com");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "example");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "app");
    vi.stubEnv("VITE_PUBLIC_REGISTRATION_ENABLED", "true");
  });

  it("enables public registration flag by default", async () => {
    const { isPublicRegistrationEnabled } = await import("./firebase");
    expect(isPublicRegistrationEnabled()).toBe(true);
  });

  it("rejects protected owner email before createUser", async () => {
    const { signUp } = await import("./firebase");
    await expect(signUp("saviosyl@gmail.com", "SecurePass1!")).rejects.toThrow(
      /This account already exists/i
    );
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(sendEmailVerification).not.toHaveBeenCalled();
  });

  it("creates user without sending verification (caller sends exactly once)", async () => {
    const user = { uid: "u1", email: "ada@example.com" };
    createUserWithEmailAndPassword.mockResolvedValue({ user });
    const { signUp } = await import("./firebase");
    await expect(signUp("ada@example.com", "SecurePass1!")).resolves.toBe(user);
    expect(createUserWithEmailAndPassword).toHaveBeenCalled();
    expect(sendEmailVerification).not.toHaveBeenCalled();
  });

  it("sendVerificationEmail uses approved continue URL", async () => {
    const user = { uid: "u1", email: "ada@example.com" };
    sendEmailVerification.mockResolvedValue(undefined);
    const { sendVerificationEmail, EMAIL_VERIFICATION_CONTINUE_URL } = await import("./firebase");
    await sendVerificationEmail(user as never);
    expect(EMAIL_VERIFICATION_CONTINUE_URL).toBe(
      "https://goldmeta.metamechsolutions.com/login"
    );
    expect(sendEmailVerification).toHaveBeenCalledWith(user, {
      url: EMAIL_VERIFICATION_CONTINUE_URL,
      handleCodeInApp: false
    });
  });
});
