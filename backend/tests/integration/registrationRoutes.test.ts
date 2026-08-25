import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { OWNER_EXISTS_MESSAGE } from "../../src/services/auth/roles";
import * as registrationService from "../../src/services/auth/registrationService";

describe("registration + approval routes", () => {
  let app: ReturnType<typeof createApp>;
  let profiles: InMemoryUserProfileStore;

  beforeEach(() => {
    resetInMemoryUserProfiles();
    resetRegistrationRateLimits();
    profiles = new InMemoryUserProfileStore();
    setUserProfileStoreForTests(profiles);
    app = createApp({
      store: new InMemoryStore(),
      aiExplainer: new AiExplainer()
    });
    process.env.GOLDMETA_OWNER_EMAIL = "saviosyl@gmail.com";
    process.env.GOLDMETA_PINNED_OWNER_UID = "IwlS1UKACOUoYhm9TkcoQk6Ow4C2";
    process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  });

  it("exposes registration status", async () => {
    const res = await request(app).get("/v1/auth/registration-status").expect(200);
    expect(res.body.registrationEnabled).toBe(true);
    expect(res.body.emailVerificationRequired).toBe(true);
    expect(res.body.approvalRequired).toBe(false);
    expect(res.body.brokerEnabledByRegistration).toBe(false);
    expect(res.body.autoTradeDefault).toBe("OFF");
    expect(res.body.mode).toBe("OPEN");
  });

  it("preflight rejects owner email", async () => {
    const res = await request(app)
      .post("/v1/auth/register/preflight")
      .send({
        firstName: "Savio",
        lastName: "Owner",
        email: "saviosyl@gmail.com",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
        countryOfResidence: "IE",
        acceptTerms: true,
        acceptPrivacy: true,
        acceptRiskWarning: true
      })
      .expect(409);
    expect(res.body.error.message).toBe(OWNER_EXISTS_MESSAGE);
  });

  it("registers via service mock and keeps AutoTrade/broker off", async () => {
    vi.spyOn(registrationService, "registerUser").mockResolvedValue({
      ok: true,
      status: 201,
      body: {
        message: "Account created. Please verify your email. Your account will then be reviewed before full access is enabled.",
        uidMasked: "newU…ser1",
        role: "USER_PENDING",
        emailVerificationSent: true,
        brokerAccess: false,
        autoTrade: false,
        approvalRequired: false
      }
    });
    const res = await request(app)
      .post("/v1/auth/register")
      .send({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
        countryOfResidence: "IE",
        acceptTerms: true,
        acceptPrivacy: true,
        acceptRiskWarning: true
      })
      .expect(201);
    expect(res.body.role).toBe("USER_PENDING");
    expect(res.body.brokerAccess).toBe(false);
    vi.restoreAllMocks();
  });

  it("blocks unverified pending users from decisions and webhook creation", async () => {
    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "pending-user",
        email: "pending-user@example.com",
        firstName: "Pen",
        lastName: "Ding",
        countryOfResidence: "IE",
        emailVerified: false
      })
    );
    await request(app)
      .get("/v1/decisions/latest")
      .set("x-test-user-id", "pending-user")
      .set("x-test-role", "USER_PENDING")
      .set("x-test-email-verified", "false")
      .expect(403);

    await request(app)
      .post("/v1/tradingview/connections")
      .set("x-test-user-id", "pending-user")
      .set("x-test-role", "USER_PENDING")
      .set("x-test-email-verified", "false")
      .expect(403);
  });

  it("reports eligible pending activations without migrating", async () => {
    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "eligible-pending",
        email: "eligible@example.com",
        firstName: "Eli",
        lastName: "Gible",
        countryOfResidence: "IE",
        emailVerified: true
      })
    );
    const res = await request(app)
      .get("/v1/admin/users/pending-activation-report")
      .set("x-test-user-id", "admin-1")
      .set("x-test-role", "ADMIN")
      .set("x-test-admin", "true")
      .expect(200);
    expect(res.body.migrationExecuted).toBe(false);
    expect(res.body.eligibleCount).toBeGreaterThanOrEqual(1);
    const still = await profiles.getProfile("eligible-pending");
    expect(still?.role).toBe("USER_PENDING");
  });

  it("blocks unverified users", async () => {
    await request(app)
      .get("/v1/decisions/latest")
      .set("x-test-user-id", "unverified")
      .set("x-test-role", "USER_APPROVED")
      .set("x-test-email-verified", "false")
      .expect(403);
  });

  it("admin can list/approve users; cannot touch pinned owner", async () => {
    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "pending-1",
        email: "pending@example.com",
        firstName: "Pat",
        lastName: "Pending",
        countryOfResidence: "IE",
        emailVerified: true
      })
    );

    const listed = await request(app)
      .get("/v1/admin/users")
      .set("x-test-user-id", "admin-1")
      .set("x-test-role", "ADMIN")
      .set("x-test-admin", "true")
      .expect(200);
    expect(listed.body.users.length).toBeGreaterThanOrEqual(1);

    await request(app)
      .post("/v1/admin/users/pending-1/approve")
      .set("x-test-user-id", "admin-1")
      .set("x-test-role", "ADMIN")
      .set("x-test-admin", "true")
      .expect(200);

    await request(app)
      .post(`/v1/admin/users/${process.env.GOLDMETA_PINNED_OWNER_UID}/suspend`)
      .set("x-test-user-id", "admin-1")
      .set("x-test-role", "ADMIN")
      .set("x-test-admin", "true")
      .send({ role: "OWNER" })
      .expect(403);
  });

  it("rejects role escalation body on admin actions", async () => {
    await profiles.upsertProfile(
      buildPendingProfile({
        uid: "pending-2",
        email: "pending2@example.com",
        firstName: "Pat",
        lastName: "Two",
        countryOfResidence: "IE"
      })
    );
    await request(app)
      .post("/v1/admin/users/pending-2/approve")
      .set("x-test-user-id", "admin-1")
      .set("x-test-admin", "true")
      .send({ makeOwner: true })
      .expect(403);
  });
});
