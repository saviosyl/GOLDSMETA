/**
 * Owner Auth protection unit tests — no production Firebase calls.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateUserCreation
} from "../../../src/services/auth/registrationGuard";
import {
  checkOwnerAuthIntegrity,
  type AuthLookupPort
} from "../../../src/services/auth/authIntegrity";
import { loadOwnerAuthConfig, maskUid } from "../../../src/services/auth/ownerAuthConfig";

const PINNED = "IwlS1UKACOUoYhm9TkcoQk6Ow4C2";
const OWNER = "saviosyl@gmail.com";

describe("registrationGuard", () => {
  it("fails closed when pinned UID configuration is missing", () => {
    const decision = evaluateUserCreation({
      email: OWNER,
      uid: "random",
      config: { ownerEmail: OWNER, pinnedOwnerUid: null }
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.code).toBe("CONFIGURATION_MISSING");
  });

  it("rejects non-owner registration", () => {
    const decision = evaluateUserCreation({
      email: "other@example.com",
      uid: "abc",
      config: { ownerEmail: OWNER, pinnedOwnerUid: PINNED }
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.code).toBe("REGISTRATION_CLOSED");
  });

  it("rejects owner email with random UID", () => {
    const decision = evaluateUserCreation({
      email: OWNER,
      uid: "i5XxuO5q00MlqidzSaishveXTMj1",
      config: { ownerEmail: OWNER, pinnedOwnerUid: PINNED }
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.code).toBe("OWNER_UID_MISMATCH");
  });

  it("allows owner email only with pinned original UID", () => {
    const decision = evaluateUserCreation({
      email: OWNER,
      uid: PINNED,
      config: { ownerEmail: OWNER, pinnedOwnerUid: PINNED }
    });
    expect(decision).toEqual({ allow: true, reason: "PINNED_OWNER_RESTORE" });
  });
});

describe("authIntegrity monitor", () => {
  it("returns CONFIGURATION_MISSING without pinned uid", async () => {
    const result = await checkOwnerAuthIntegrity({
      config: { ownerEmail: OWNER, pinnedOwnerUid: null },
      auth: {
        getUserByEmail: async () => null,
        getUser: async () => null
      }
    });
    expect(result.status).toBe("CONFIGURATION_MISSING");
    expect(result.mutatedAuth).toBe(false);
  });

  it("returns HEALTHY when email maps to pinned UID", async () => {
    const auth: AuthLookupPort = {
      getUserByEmail: async () => ({ uid: PINNED, email: OWNER }),
      getUser: async () => ({ uid: PINNED, email: OWNER }),
      listWebhookConnectionsForUser: async () => [
        { webhookId: "Uho-1w-0uoxjFkJh85oewbuu", status: "ACTIVE" }
      ]
    };
    const result = await checkOwnerAuthIntegrity({
      config: { ownerEmail: OWNER, pinnedOwnerUid: PINNED },
      auth
    });
    expect(result.status).toBe("HEALTHY");
    expect(result.emailUidRedacted).toBe(maskUid(PINNED));
    expect(result.webhookOwnedByOriginal).toBe(true);
    expect(result.mutatedAuth).toBe(false);
  });

  it("returns OWNER_UID_MISMATCH when email maps elsewhere", async () => {
    const stray = "i5XxuO5q00MlqidzSaishveXTMj1";
    const result = await checkOwnerAuthIntegrity({
      config: { ownerEmail: OWNER, pinnedOwnerUid: PINNED },
      auth: {
        getUserByEmail: async () => ({ uid: stray, email: OWNER }),
        getUser: async () => ({ uid: PINNED, email: "saviosyl+parked@metamechsolutions.com" }),
        listWebhookConnectionsForUser: async () => [
          { webhookId: "Uho-1w-0uoxjFkJh85oewbuu", status: "ACTIVE" }
        ]
      }
    });
    expect(result.status).toBe("OWNER_UID_MISMATCH");
    expect(result.emailUidRedacted).toBe(maskUid(stray));
    expect(JSON.stringify(result)).not.toContain(PINNED);
    expect(JSON.stringify(result)).not.toContain(stray);
  });

  it("returns OWNER_AUTH_MISSING when pinned UID absent", async () => {
    const result = await checkOwnerAuthIntegrity({
      config: { ownerEmail: OWNER, pinnedOwnerUid: PINNED },
      auth: {
        getUserByEmail: async () => ({ uid: "other", email: OWNER }),
        getUser: async () => null
      }
    });
    expect(result.status).toBe("OWNER_AUTH_MISSING");
  });

  it("loads owner email default without exposing pinned uid from empty env", () => {
    const cfg = loadOwnerAuthConfig({});
    expect(cfg.ownerEmail).toBe(OWNER);
    expect(cfg.pinnedOwnerUid).toBeNull();
  });
});
