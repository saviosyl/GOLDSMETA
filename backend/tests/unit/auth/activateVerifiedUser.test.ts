import { beforeEach, describe, expect, it } from "vitest";
import {
  isEligibleForAutoActivation,
  reportEligiblePendingActivations,
  tryActivateVerifiedPendingUser
} from "../../../src/services/auth/activateVerifiedUser";
import { buildPendingProfile } from "../../../src/services/auth/userProfile";
import {
  InMemoryUserProfileStore,
  resetInMemoryUserProfiles,
  setUserProfileStoreForTests
} from "../../../src/services/auth/userProfileStore";

describe("activateVerifiedUser", () => {
  let profiles: InMemoryUserProfileStore;

  beforeEach(() => {
    resetInMemoryUserProfiles();
    profiles = new InMemoryUserProfileStore();
    setUserProfileStoreForTests(profiles);
    delete process.env.REGISTRATION_APPROVAL_REQUIRED;
    process.env.GOLDMETA_OWNER_EMAIL = "saviosyl@gmail.com";
    process.env.GOLDMETA_PINNED_OWNER_UID = "IwlS1UKACOUoYhm9TkcoQk6Ow4C2";
  });

  it("activates verified pending users with broker flags false", async () => {
    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "u-activate",
        email: "activate@example.com",
        firstName: "Act",
        lastName: "Ivate",
        countryOfResidence: "IE",
        emailVerified: true
      })
    );

    const first = await tryActivateVerifiedPendingUser({
      uid: "u-activate",
      emailVerified: true,
      profiles
    });
    expect(first.activated).toBe(true);
    expect(first.role).toBe("USER_APPROVED");
    expect(first.profile?.brokerAccess).toBe(false);
    expect(first.profile?.autoTrade).toBe(false);
    expect(first.profile?.liveTrading).toBe(false);
    expect(first.profile?.demoOrderSubmission).toBe(false);

    const second = await tryActivateVerifiedPendingUser({
      uid: "u-activate",
      emailVerified: true,
      profiles
    });
    expect(second.activated).toBe(false);
    expect(second.alreadyApproved).toBe(true);
    expect(second.role).toBe("USER_APPROVED");
  });

  it("does not activate unverified or rejected users", async () => {
    const unverified = buildPendingProfile({
      uid: "u-unverified",
      email: "u@example.com",
      firstName: "U",
      lastName: "N",
      countryOfResidence: "IE",
      emailVerified: false
    });
    await profiles.upsertProfile(unverified);
    const a = await tryActivateVerifiedPendingUser({
      uid: "u-unverified",
      emailVerified: false,
      profiles
    });
    expect(a.activated).toBe(false);
    expect(a.reason).toBe("EMAIL_NOT_VERIFIED");

    const rejected = buildPendingProfile({
      uid: "u-rejected",
      email: "r@example.com",
      firstName: "R",
      lastName: "J",
      countryOfResidence: "IE",
      emailVerified: true
    });
    rejected.approvalStatus = "REJECTED";
    await profiles.upsertProfile(rejected);
    const b = await tryActivateVerifiedPendingUser({
      uid: "u-rejected",
      emailVerified: true,
      profiles
    });
    expect(b.activated).toBe(false);
    expect(b.reason).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("skips when approvalRequired=true", async () => {
    process.env.REGISTRATION_APPROVAL_REQUIRED = "true";
    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "u-manual",
        email: "manual@example.com",
        firstName: "Man",
        lastName: "Ual",
        countryOfResidence: "IE",
        emailVerified: true
      })
    );
    const r = await tryActivateVerifiedPendingUser({
      uid: "u-manual",
      emailVerified: true,
      profiles,
      env: process.env
    });
    expect(r.activated).toBe(false);
    expect(r.reason).toBe("APPROVAL_REQUIRED");
  });

  it("never marks pinned owner as eligible", () => {
    const ownerProfile = buildPendingProfile({
      uid: "IwlS1UKACOUoYhm9TkcoQk6Ow4C2",
      email: "saviosyl@gmail.com",
      firstName: "Owner",
      lastName: "Account",
      countryOfResidence: "IE",
      emailVerified: true
    });
    const eligibility = isEligibleForAutoActivation(ownerProfile, {
      emailVerified: true,
      approvalRequired: false,
      pinnedOwnerUid: "IwlS1UKACOUoYhm9TkcoQk6Ow4C2"
    });
    expect(eligibility.ok).toBe(false);
  });

  it("reports eligible pending count without mutating", async () => {
    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "elig-1",
        email: "elig1@example.com",
        firstName: "E",
        lastName: "One",
        countryOfResidence: "IE",
        emailVerified: true
      })
    );
    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "elig-2",
        email: "elig2@example.com",
        firstName: "E",
        lastName: "Two",
        countryOfResidence: "IE",
        emailVerified: false
      })
    );
    const report = await reportEligiblePendingActivations({ profiles });
    expect(report.migrationExecuted).toBe(false);
    expect(report.eligibleCount).toBe(1);
    expect(report.excluded.unverified).toBe(1);
    const still = await profiles.getProfile("elig-1");
    expect(still?.role).toBe("USER_PENDING");
  });
});
