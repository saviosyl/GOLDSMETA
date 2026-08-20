import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import {
  InMemoryUserProfileStore,
  resetInMemoryUserProfiles,
  setUserProfileStoreForTests
} from "../../src/services/auth/userProfileStore";
import { resetRegistrationRateLimits } from "../../src/services/auth/registrationRateLimit";
import { buildPendingProfile } from "../../src/services/auth/userProfile";

/**
 * Role × sensitive-area access matrix (API).
 */
describe("registration access matrix", () => {
  let app: ReturnType<typeof createApp>;
  let profiles: InMemoryUserProfileStore;

  beforeEach(async () => {
    resetInMemoryUserProfiles();
    resetRegistrationRateLimits();
    profiles = new InMemoryUserProfileStore();
    setUserProfileStoreForTests(profiles);
    process.env.GOLDMETA_OWNER_EMAIL = "saviosyl@gmail.com";
    process.env.GOLDMETA_PINNED_OWNER_UID = "IwlS1UKACOUoYhm9TkcoQk6Ow4C2";
    app = createApp({ store: new InMemoryStore(), aiExplainer: new AiExplainer() });

    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "pending-1",
        email: "pending@example.com",
        firstName: "P",
        lastName: "User",
        countryOfResidence: "IE",
        emailVerified: true
      })
    );
    const approved = buildPendingProfile({
      uid: "approved-1",
      email: "approved@example.com",
      firstName: "A",
      lastName: "User",
      countryOfResidence: "IE",
      emailVerified: true
    });
    approved.role = "USER_APPROVED";
    approved.approvalStatus = "APPROVED";
    approved.brokerAccess = false;
    await profiles.upsertProfile(approved);

    const suspended = buildPendingProfile({
      uid: "suspended-1",
      email: "suspended@example.com",
      firstName: "S",
      lastName: "User",
      countryOfResidence: "IE",
      emailVerified: true
    });
    suspended.role = "USER_SUSPENDED";
    suspended.approvalStatus = "SUSPENDED";
    await profiles.upsertProfile(suspended);
  });

  it("anonymous cannot access protected APIs", async () => {
    await request(app).get("/v1/decisions/latest").expect(401);
    await request(app).get("/v1/admin/users").expect(401);
    await request(app).post("/v1/tradingview/connections").expect(401);
  });

  it("unverified USER_PENDING cannot access Dashboard APIs", async () => {
    const h = {
      "x-test-user-id": "pending-1",
      "x-test-role": "USER_PENDING",
      "x-test-email-verified": "false"
    };
    await request(app).get("/v1/decisions/latest").set(h).expect(403);
    await request(app).get("/v1/signal-outcomes").set(h).expect(403);
    const me = await request(app).get("/v1/auth/me").set(h).expect(200);
    expect(me.body.access).toBe("VERIFY_EMAIL");
    expect(me.body.role).toBe("USER_PENDING");
  });

  it("verified USER_PENDING auto-activates analysis access but not broker/admin", async () => {
    const h = { "x-test-user-id": "pending-1", "x-test-role": "USER_PENDING" };
    const me = await request(app).get("/v1/auth/me").set(h).expect(200);
    expect(me.body.access).toBe("APP");
    expect(me.body.role).toBe("USER_APPROVED");
    expect(me.body.profile.brokerAccess).toBe(false);
    expect(me.body.profile.autoTrade).toBe(false);

    const d = await request(app).get("/v1/decisions/latest").set(h);
    expect([200, 404]).toContain(d.status);
    // Core AutoTrade routes are gone; Gold Hunter remains staff-only.
    const at = await request(app).get("/v1/autotrade/status").set(h);
    expect([403, 404]).toContain(at.status);
    await request(app).get("/v1/brokers/control-centre").set(h).expect(403);
    await request(app).post("/v1/tradingview/connections").set(h).expect(403);
    await request(app).post("/v1/ctrader/oauth/start").set(h).expect(403);
    await request(app).post("/v1/autotrade/connect").set(h).expect(404);
    await request(app).get("/v1/gold-hunter/status").set(h).expect(403);
    await request(app).get("/v1/admin/users").set(h).expect(403);
  });

  it("manual approval mode keeps verified pending awaiting approval", async () => {
    process.env.REGISTRATION_APPROVAL_REQUIRED = "true";
    const h = { "x-test-user-id": "pending-1", "x-test-role": "USER_PENDING" };
    await request(app).get("/v1/decisions/latest").set(h).expect(403);
    const me = await request(app).get("/v1/auth/me").set(h).expect(200);
    expect(me.body.access).toBe("AWAITING_APPROVAL");
    expect(me.body.role).toBe("USER_PENDING");
    delete process.env.REGISTRATION_APPROVAL_REQUIRED;
  });

  it("USER_APPROVED can configure AutoTrade/broker without brokerAccess flag", async () => {
    const h = { "x-test-user-id": "approved-1", "x-test-role": "USER_APPROVED" };
    // decisions may 404 empty but must not be 403
    const d = await request(app).get("/v1/decisions/latest").set(h);
    expect([200, 404]).toContain(d.status);
    // Verified active users may open broker configure surfaces (execution still hard-disabled).
    const demo = await request(app).get("/v1/ctrader/demonstration").set(h);
    expect(demo.status).toBe(200);
    expect(demo.body.autoTrade).toBe("OFF");
    expect(demo.body.orderSubmissionEnabled).toBe(false);
    const tv = await request(app).post("/v1/tradingview/connections").set(h).send({});
    expect([200, 201, 400]).toContain(tv.status);
    await request(app).get("/v1/admin/users").set(h).expect(403);
  });

  it("USER_SUSPENDED cannot use protected APIs", async () => {
    const h = { "x-test-user-id": "suspended-1", "x-test-role": "USER_SUSPENDED" };
    await request(app).get("/v1/decisions/latest").set(h).expect(403);
    const retired = await request(app).get("/v1/autotrade/status").set(h);
    expect([403, 404]).toContain(retired.status);
    const gh = await request(app).get("/v1/gold-hunter/status").set(h);
    expect([403, 404]).toContain(gh.status);
  });

  it("ADMIN can list users but cannot modify OWNER or peer ADMIN", async () => {
    const adminProfile = buildPendingProfile({
      uid: "admin-1",
      email: "admin@example.com",
      firstName: "Ad",
      lastName: "Min",
      countryOfResidence: "IE",
      emailVerified: true
    });
    adminProfile.role = "ADMIN";
    adminProfile.approvalStatus = "APPROVED";
    await profiles.upsertProfile(adminProfile);

    const peer = buildPendingProfile({
      uid: "admin-2",
      email: "admin2@example.com",
      firstName: "Ad",
      lastName: "Two",
      countryOfResidence: "IE",
      emailVerified: true
    });
    peer.role = "ADMIN";
    peer.approvalStatus = "APPROVED";
    await profiles.upsertProfile(peer);

    const h = {
      "x-test-user-id": "admin-1",
      "x-test-role": "ADMIN",
      "x-test-admin": "true"
    };
    await request(app).get("/v1/admin/users").set(h).expect(200);
    await request(app)
      .post(`/v1/admin/users/${process.env.GOLDMETA_PINNED_OWNER_UID}/suspend`)
      .set(h)
      .expect(403);
    await request(app).post("/v1/admin/users/admin-2/approve").set(h).expect(403);
    await request(app).post("/v1/admin/users/admin-1/suspend").set(h).expect(403);
  });

  it("OWNER can approve pending user", async () => {
    const h = {
      "x-test-user-id": process.env.GOLDMETA_PINNED_OWNER_UID!,
      "x-test-role": "OWNER",
      "x-test-admin": "true"
    };
    const res = await request(app).post("/v1/admin/users/pending-1/approve").set(h).expect(200);
    expect(res.body.user.role).toBe("USER_APPROVED");
  });

  it("legacy unclaimed user retains analysis access without registration profile", async () => {
    const h = { "x-test-user-id": "legacy-1", "x-test-legacy": "true" };
    const me = await request(app).get("/v1/auth/me").set(h).expect(200);
    expect(me.body.access).toBe("APP");
    expect(me.body.role).toBe("USER_APPROVED");
    const d = await request(app).get("/v1/decisions/latest").set(h);
    expect([200, 404]).toContain(d.status);
  });

  it("registration rejects non-JSON content type", async () => {
    await request(app)
      .post("/v1/auth/register")
      .set("Content-Type", "text/plain")
      .send("not-json")
      .expect(415);
  });
});
