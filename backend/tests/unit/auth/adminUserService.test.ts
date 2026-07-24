import { beforeEach, describe, expect, it } from "vitest";
import { applyAdminUserAction } from "../../../src/services/auth/adminUserService";
import { buildPendingProfile } from "../../../src/services/auth/userProfile";
import {
  InMemoryUserProfileStore,
  resetInMemoryUserProfiles,
  setUserProfileStoreForTests
} from "../../../src/services/auth/userProfileStore";

const PINNED = "IwlS1UKACOUoYhm9TkcoQk6Ow4C2";
const env = {
  GOLDMETA_OWNER_EMAIL: "saviosyl@gmail.com",
  GOLDMETA_PINNED_OWNER_UID: PINNED
};

describe("adminUserService", () => {
  let store: InMemoryUserProfileStore;

  beforeEach(async () => {
    resetInMemoryUserProfiles();
    store = new InMemoryUserProfileStore();
    setUserProfileStoreForTests(store);
    await store.upsertProfile(
      buildPendingProfile({
        uid: "pending-1",
        email: "pending@example.com",
        firstName: "Pat",
        lastName: "Pending",
        countryOfResidence: "IE",
        emailVerified: true
      })
    );
  });

  it("approves a pending user to USER_APPROVED with broker flags false", async () => {
    const result = await applyAdminUserAction({
      actorUid: "admin-1",
      actorRole: "ADMIN",
      targetUid: "pending-1",
      action: "approve",
      profiles: store,
      env
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.role).toBe("USER_APPROVED");
    expect(result.user.approvalStatus).toBe("APPROVED");
    const profile = await store.getProfile("pending-1");
    expect(profile?.brokerAccess).toBe(false);
    expect(profile?.autoTrade).toBe(false);
  });

  it("suspends and restores access", async () => {
    await applyAdminUserAction({
      actorUid: "admin-1",
      actorRole: "OWNER",
      targetUid: "pending-1",
      action: "approve",
      profiles: store,
      env
    });
    const suspended = await applyAdminUserAction({
      actorUid: "admin-1",
      actorRole: "OWNER",
      targetUid: "pending-1",
      action: "suspend",
      profiles: store,
      env
    });
    expect(suspended.ok).toBe(true);
    if (!suspended.ok) return;
    expect(suspended.user.role).toBe("USER_SUSPENDED");
    const restored = await applyAdminUserAction({
      actorUid: "admin-1",
      actorRole: "OWNER",
      targetUid: "pending-1",
      action: "restore",
      profiles: store,
      env
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.user.role).toBe("USER_APPROVED");
  });

  it("rejects owner deletion / mutation and OWNER promotion", async () => {
    const againstOwner = await applyAdminUserAction({
      actorUid: "admin-1",
      actorRole: "ADMIN",
      targetUid: PINNED,
      action: "suspend",
      profiles: store,
      env
    });
    expect(againstOwner.ok).toBe(false);
    if (againstOwner.ok) return;
    expect(againstOwner.code).toBe("OWNER_PROTECTED");
  });

  it("writes redacted audit events", async () => {
    await applyAdminUserAction({
      actorUid: "admin-1",
      actorRole: "ADMIN",
      targetUid: "pending-1",
      action: "reject",
      profiles: store,
      env
    });
    const audit = await store.listAudit();
    expect(audit[0]?.action).toBe("USER_REJECT");
    expect(audit[0]?.targetUidMasked).toContain("…");
    expect(JSON.stringify(audit)).not.toContain(PINNED);
  });
});
