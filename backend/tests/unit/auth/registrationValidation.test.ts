import { describe, expect, it } from "vitest";
import {
  isStrongPassword,
  validateRegistrationInput
} from "../../../src/services/auth/registrationValidation";
import { OWNER_EXISTS_MESSAGE } from "../../../src/services/auth/roles";

const base = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  password: "SecurePass1!",
  confirmPassword: "SecurePass1!",
  countryOfResidence: "Ireland",
  acceptTerms: true as const,
  acceptPrivacy: true as const,
  acceptRiskWarning: true as const
};

describe("registrationValidation", () => {
  it("accepts a strong registration payload", () => {
    const result = validateRegistrationInput(base);
    expect(result.ok).toBe(true);
  });

  it("rejects protected owner email", () => {
    const result = validateRegistrationInput({
      ...base,
      email: "saviosyl@gmail.com"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ACCOUNT_EXISTS");
      expect(result.message).toBe(OWNER_EXISTS_MESSAGE);
    }
  });

  it("rejects invalid email", () => {
    const result = validateRegistrationInput({ ...base, email: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("rejects weak password", () => {
    expect(isStrongPassword("short")).toBe(false);
    const result = validateRegistrationInput({
      ...base,
      password: "weak",
      confirmPassword: "weak"
    });
    expect(result.ok).toBe(false);
  });

  it("rejects password mismatch", () => {
    const result = validateRegistrationInput({
      ...base,
      confirmPassword: "SecurePass2!"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.confirmPassword).toMatch(/do not match/i);
  });

  it("rejects missing Terms acceptance", () => {
    const result = validateRegistrationInput({
      ...base,
      acceptTerms: false
    });
    expect(result.ok).toBe(false);
  });
});
