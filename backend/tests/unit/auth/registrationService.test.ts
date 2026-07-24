import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "../../../src/services/auth/registrationService";
import {
  InMemoryUserProfileStore,
  resetInMemoryUserProfiles,
  setUserProfileStoreForTests
} from "../../../src/services/auth/userProfileStore";
import { resetRegistrationRateLimits } from "../../../src/services/auth/registrationRateLimit";
import { OWNER_EXISTS_MESSAGE } from "../../../src/services/auth/roles";

const PINNED = "IwlS1UKACOUoYhm9TkcoQk6Ow4C2";

const baseBody = {
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

describe("registrationService", () => {
  beforeEach(() => {
    resetInMemoryUserProfiles();
    resetRegistrationRateLimits();
    setUserProfileStoreForTests(new InMemoryUserProfileStore());
  });

  it("registers a USER_PENDING profile without broker flags or webhooks", async () => {
    const createUser = vi.fn(async () => ({ uid: "new-user-1" }));
    const setClaims = vi.fn(async () => undefined);
    const result = await registerUser({
      body: baseBody,
      ip: "1.2.3.4",
      env: {
        GOLDMETA_OWNER_EMAIL: "saviosyl@gmail.com",
        GOLDMETA_PINNED_OWNER_UID: PINNED
      },
      authPort: {
        getUserByEmail: async () => null,
        createUser,
        setCustomUserClaims: setClaims,
        generateEmailVerificationLink: async () => "https://example.test/verify"
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.role).toBe("USER_PENDING");
    expect(result.body.brokerAccess).toBe(false);
    expect(result.body.autoTrade).toBe(false);
    expect(createUser).toHaveBeenCalled();
    expect(setClaims).toHaveBeenCalledWith(
      "new-user-1",
      expect.objectContaining({ role: "USER_PENDING", admin: false, brokerAccess: false })
    );
  });

  it("rejects protected owner email", async () => {
    const result = await registerUser({
      body: { ...baseBody, email: "saviosyl@gmail.com" },
      env: {
        GOLDMETA_OWNER_EMAIL: "saviosyl@gmail.com",
        GOLDMETA_PINNED_OWNER_UID: PINNED
      },
      authPort: {
        getUserByEmail: async () => null,
        createUser: async () => ({ uid: "should-not" }),
        setCustomUserClaims: async () => undefined,
        generateEmailVerificationLink: async () => "x"
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error.message).toBe(OWNER_EXISTS_MESSAGE);
  });

  it("rejects duplicate email generically", async () => {
    const result = await registerUser({
      body: baseBody,
      env: {
        GOLDMETA_OWNER_EMAIL: "saviosyl@gmail.com",
        GOLDMETA_PINNED_OWNER_UID: PINNED
      },
      authPort: {
        getUserByEmail: async () => ({ uid: "existing" }),
        createUser: async () => ({ uid: "x" }),
        setCustomUserClaims: async () => undefined,
        generateEmailVerificationLink: async () => "x"
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error.code).toBe("REGISTRATION_FAILED");
    expect(result.body.error.message).not.toMatch(/already exists/i);
  });

  it("rate limits repeated registration attempts", async () => {
    const authPort = {
      getUserByEmail: async () => null,
      createUser: async () => ({ uid: `u-${Math.random()}` }),
      setCustomUserClaims: async () => undefined,
      generateEmailVerificationLink: async () => "https://example.test/verify"
    };
    const env = {
      GOLDMETA_OWNER_EMAIL: "saviosyl@gmail.com",
      GOLDMETA_PINNED_OWNER_UID: PINNED
    };
    let limited = false;
    for (let i = 0; i < 12; i += 1) {
      const result = await registerUser({
        body: { ...baseBody, email: `user${i}@example.com` },
        ip: "9.9.9.9",
        env,
        authPort
      });
      if (!result.ok && result.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
