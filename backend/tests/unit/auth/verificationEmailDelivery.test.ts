import { describe, expect, it } from "vitest";
import { loadRegistrationConfig } from "../../../src/services/auth/registrationConfig";
import { readFileSync } from "fs";
import { join } from "path";

describe("verification email delivery contract", () => {
  it("defaults continue URL to production /login", () => {
    const cfg = loadRegistrationConfig({});
    expect(cfg.verificationContinueUrl).toBe(
      "https://goldmeta.metamechsolutions.com/login"
    );
  });

  it("registrationService source does not call generateEmailVerificationLink for delivery", () => {
    const src = readFileSync(
      join(__dirname, "../../../src/services/auth/registrationService.ts"),
      "utf8"
    );
    // Port still defines the method for tests/mocks, but registerUser must not invoke it.
    expect(src).toMatch(/emailVerificationDelivery:\s*"client_sdk"/);
    expect(src).toMatch(/Do not call it here/);
    expect(src).not.toMatch(/await auth\.generateEmailVerificationLink\(/);
  });

  it("authSession resend route does not call generateEmailVerificationLink", () => {
    const src = readFileSync(join(__dirname, "../../../src/routes/authSession.ts"), "utf8");
    expect(src).toMatch(/delivery:\s*"client_sdk"/);
    expect(src).not.toMatch(/generateEmailVerificationLink/);
  });
});
