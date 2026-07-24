import { describe, expect, it } from "vitest";
import {
  OWNER_EXISTS_MESSAGE,
  isStrongPassword,
  validateRegistrationForm
} from "./registrationValidation";

const base = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  password: "SecurePass1!",
  confirmPassword: "SecurePass1!",
  countryOfResidence: "Ireland",
  acceptTerms: true,
  acceptPrivacy: true,
  acceptRiskWarning: true
};

describe("registrationValidation (web)", () => {
  it("accepts valid form", () => {
    expect(validateRegistrationForm(base).ok).toBe(true);
  });

  it("rejects owner email", () => {
    const result = validateRegistrationForm({ ...base, email: "saviosyl@gmail.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe(OWNER_EXISTS_MESSAGE);
  });

  it("rejects weak password and mismatch and missing terms", () => {
    expect(isStrongPassword("weak")).toBe(false);
    expect(validateRegistrationForm({ ...base, password: "weak", confirmPassword: "weak" }).ok).toBe(
      false
    );
    expect(
      validateRegistrationForm({ ...base, confirmPassword: "SecurePass2!" }).ok
    ).toBe(false);
    expect(validateRegistrationForm({ ...base, acceptTerms: false }).ok).toBe(false);
  });
});
