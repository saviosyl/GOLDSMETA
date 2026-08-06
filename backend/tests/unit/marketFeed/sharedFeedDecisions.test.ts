import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import plan15Fixture from "../../fixtures/pine3Plan15mPayload.json";
import { createTestWebhookConnection, freshPayload } from "../../helpers";
import { createApp } from "../../../src";
import { AiExplainer } from "../../../src/services/ai/explainer";
import { resetRateLimits } from "../../../src/middleware/rateLimit";
import { __resetSharedFeedMemoryForTests } from "../../../src/services/marketFeed/sharedFeed";
import { InMemoryStore } from "../../../src/services/storage/inMemoryStore";
import { LIVE_EXECUTION_FEATURE_FLAG, DEMO_ORDER_SUBMISSION_ENABLED, BROKER_EXECUTION_ENABLED } from "../../../src/services/autoTrade/types";

const SHARED = "shared-market-feed";
const USER_A = "approved-user-a";

describe("shared feed decisions latest", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    process.env.GOLDMETA_SHARED_FEED_UID = SHARED;
    process.env.GOLDMETA_PINNED_OWNER_UID = "";
    __resetSharedFeedMemoryForTests();
    resetRateLimits();
    store = new InMemoryStore();
    await createTestWebhookConnection(store, SHARED, "shared-webhook-id");
    app = createApp({ store, aiExplainer: new AiExplainer() });
  });

  it("lets an approved user read the shared feed plan", async () => {
    const payload = freshPayload(plan15Fixture);
    await request(app).post("/webhooks/tradingview/shared-webhook-id").send(payload).expect(202);

    const res = await request(app)
      .get("/v1/decisions/latest")
      .set("x-test-user-id", USER_A)
      .set("x-test-role", "USER_APPROVED")
      .expect(200);

    expect(res.body.decision).toBeTruthy();
    expect(res.body.decision.userId).toBe(SHARED);
    expect(res.body.marketFeedHealth).toBeTruthy();
    expect(res.body.sessionPlan?.safety?.autoTrade).not.toBe("ON");
  });

  it("does not expose webhook identifiers to ordinary users via latest", async () => {
    const payload = freshPayload(plan15Fixture);
    await request(app).post("/webhooks/tradingview/shared-webhook-id").send(payload).expect(202);

    const res = await request(app)
      .get("/v1/decisions/latest")
      .set("x-test-user-id", USER_A)
      .set("x-test-role", "USER_APPROVED")
      .expect(200);

    const blob = JSON.stringify(res.body);
    expect(blob).not.toMatch(/shared-webhook-id/);
    expect(blob.toLowerCase()).not.toMatch(/webhooksecret/);
  });

  it("keeps AutoTrade / Demo / Live execution OFF", () => {
    expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    expect(DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(BROKER_EXECUTION_ENABLED).toBe(false);
  });
});
