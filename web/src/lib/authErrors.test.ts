import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "./authErrors";

describe("friendlyAuthError", () => {
  it("hides raw Firebase invalid-credential codes", () => {
    const msg = friendlyAuthError({ code: "auth/invalid-credential", message: "Firebase: Error (auth/invalid-credential)." });
    expect(msg).toMatch(/Email address or password is incorrect/i);
    expect(msg).not.toMatch(/invalid-credential/i);
  });

  it("preserves owner-exists messaging", () => {
    expect(friendlyAuthError(new Error("This account already exists. Please use Sign In or Forgot Password."))).toMatch(
      /already exists/i
    );
  });
});
