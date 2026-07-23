import { describe, expect, it, vi } from "vitest";
import { isPublicRegistrationEnabled, signUp } from "../lib/firebase";

vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({}))
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(() => {
    throw new Error("createUserWithEmailAndPassword must not be called");
  }),
  sendPasswordResetEmail: vi.fn(),
  signOut: vi.fn()
}));

describe("firebase registration lock", () => {
  it("disables public registration flag", () => {
    expect(isPublicRegistrationEnabled()).toBe(false);
  });

  it("signUp rejects without calling createUserWithEmailAndPassword", async () => {
    await expect(signUp("saviosyl@gmail.com", "password123")).rejects.toThrow(
      /Account registration is currently closed/i
    );
  });
});
